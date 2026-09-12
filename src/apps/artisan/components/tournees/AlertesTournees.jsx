/**
 * AlertesTournees.jsx - Majord'home Artisan
 * ============================================================================
 * Les quatre filets du module Tournées (spec §3.7 et §10) : sans eux, des
 * échecs deviennent des silences.
 *   - Journées sous-remplies qui approchent (J-7) : une graine isolée qui
 *     reste isolée jusqu'au jour J fait un aller-retour pour un seul client.
 *   - Retardataires : contrats en fin de fenêtre sans RDV — la SEULE garantie
 *     que tout le monde ait son entretien (le mail n'en est pas une).
 *   - Équipements non typés : sans type, la durée est un fallback ; le
 *     compteur rend visible ce que le fallback masque.
 *   - Clients non géolocalisés : `filtreProximite` (geo.js) écarte tout candidat
 *     sans coordonnées — aucun trajet n'est calculable, donc aucune proposition
 *     possible. Ces contrats sont dus, ils n'apparaissent NULLE PART dans
 *     l'onglet, et rien ne le disait : un client peut ainsi passer une saison
 *     entière sans être proposé. Le géocodage tourne côté serveur (edge
 *     `geocode-sweep`, 3 tentatives max), donc un client qui reste ici est un
 *     client dont l'adresse est à corriger à la main.
 *
 * ⚠️ `journees`/`candidats` peuvent valoir `undefined` pendant que le parent
 * (TourneesTab) charge ses deux requêtes, ou en cas d'échec de l'une d'elles.
 * Dans ce cas on affiche un état de chargement — JAMAIS un zéro, qui serait
 * exactement le mensonge que ces alertes existent pour empêcher (« 0
 * retardataire » sur une requête qui a échoué). Les deux cas (chargement en
 * cours vs échec) sont eux-mêmes distingués via `journeesError`/`candidatsError`
 * (passés par TourneesTab) : sans eux, un échec réel de `useContratsDus`
 * ferait tourner le spinner « Calcul des alertes… » indéfiniment, sans jamais
 * dire qu'il s'agit d'un échec.
 *
 * ⚠️ Le test d'erreur ne doit JAMAIS être imbriqué DANS le test de chargement
 * (fix round 2, Finding A) : React Query v5 conserve les `data` d'un
 * chargement réussi quand un refetch ultérieur échoue — `isError` est alors
 * vrai mais `journees`/`candidats` restent définis (données PÉRIMÉES, pas
 * absentes). `chargement` (qui teste `=== undefined`) vaut donc `false` dans
 * ce cas précis, et un test d'erreur qui ne vivrait que sous `if (chargement)`
 * serait sauté — les alertes s'afficheraient sur des données obsolètes sans
 * le moindre signal. Scénario réel, pas théorique : TourneesTab invalide ces
 * caches après CHAQUE pose de RDV, donc un refetch a lieu à ce moment précis ;
 * un aléa réseau juste après une pose reproduit exactement ce trou. D'où le
 * bandeau « périmé » rendu indépendamment de `chargement` ci-dessous.
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Clock, Tag, Loader2, ChevronDown, MapPinOff,
} from 'lucide-react';
import { retardStatus } from '@/lib/tournee/eligibilite.js';
import { verdictJournee } from '@/lib/tournee/plein.js';
import { trajetLocal } from '@/lib/tournee/matrice.js';
import { formatDateFR } from '@/lib/utils';
import { formatDuree } from './tourneesPanelUtils';

/** Nombre de jours calendaires entre deux dates "YYYY-MM-DD". */
function joursEntre(dateA, dateB) {
  const a = new Date(`${dateA}T00:00:00`);
  const b = new Date(`${dateB}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// ============================================================================
// SOUS-COMPOSANT
// ============================================================================

function AlerteCard({
  icon: Icon, color, title, count, children,
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xl font-semibold text-gray-900">{count}</p>
          <p className="text-xs text-gray-500 truncate">{title}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-3 flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? 'Masquer le détail' : 'Voir le détail'}
      </button>
      {open && (
        <div className="mt-2 space-y-1 max-h-52 overflow-y-auto border-t border-gray-100 pt-2">
          {children}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

/**
 * @param {object} props
 * @param {Array|undefined} props.journees   `data` de useJourneesHorizon (brut, non filtré horizon)
 * @param {Array|undefined} props.candidats  `data` de useContratsDus (brut, TOUS les contrats dus)
 * @param {Error|null} [props.journeesError]   error de useJourneesHorizon
 * @param {Error|null} [props.candidatsError]  error de useContratsDus — sans elle, un échec de ce
 *   hook laisse `candidats` à `undefined` indéfiniment et ce composant ne pourrait jamais
 *   distinguer "encore en chargement" de "a échoué" (spinner sans fin sur un échec réel).
 * @param {Function} [props.onOpenJournee]   (journee) => void — ouvre RemplirJourneePanel
 * @param {Function} [props.onOpenContract]  (contractId) => void — ouvre ContractModal
 * @param {number} [props.toleranceAnniversaireMois]  reglages.tolerance_anniversaire_mois
 *   (I1, revue finale) — jamais une constante en dur ici.
 * @param {object} [props.reglages]  construireReglages(settings) — journées « à arbitrer »
 * @param {{lat:number,lng:number}|null} [props.depot]
 */
export function AlertesTournees({
  journees, candidats, journeesError, candidatsError, onOpenJournee, onOpenContract,
  toleranceAnniversaireMois, reglages = null, depot = null,
}) {
  const chargement = journees === undefined || candidats === undefined;
  const erreurChargement = journeesError || candidatsError;
  const aujourdhui = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const moisCourant = useMemo(() => new Date().getMonth() + 1, []);

  // Journées sous-remplies qui approchent : une graine isolée qui reste isolée
  // jusqu'au jour J fait un aller-retour pour un seul client.
  const sousRemplies = useMemo(() => {
    if (!journees) return [];
    return journees.filter((j) => {
      const dansSeptJours = joursEntre(aujourdhui, j.date) <= 7;
      return dansSeptJours && j.estAmorcee && j.chargeMinutes < j.budgetMinutes * 0.5;
    });
  }, [journees, aujourdhui]);

  // Journées PLEINES que l'ordonnanceur ne sait pas tenir (spec 2026-09-12,
  // R3) : le figeage automatique les laisse de côté, il faut un humain. Même
  // verdict que l'edge tournees-figer, avec des trajets estimés à vol d'oiseau
  // (le navigateur n'a pas la matrice de chaque journée) — d'où « estimé ».
  const aArbitrer = useMemo(() => {
    if (!journees || !reglages || !depot) return [];
    return journees
      .filter((j) => j.date > aujourdhui && (j.rdvs || []).length > 0)
      .map((j) => ({ journee: j, ...verdictJournee({ journee: j, depot, reglages, trajet: trajetLocal }) }))
      .filter((v) => v.verdict === 'a_arbitrer');
  }, [journees, reglages, depot, aujourdhui]);

  // Retardataires : contrats dont la fenêtre est en train de se refermer ou
  // déjà refermée, PLUS les contrats sans date anniversaire connue (ceux-là
  // n'ont structurellement aucune fenêtre à surveiller — les plus exposés à
  // l'oubli, cf. retardStatus). C'est la SEULE garantie que tout le monde ait
  // son entretien — le mail n'en est pas une. Règle écrite dans le moteur pur
  // (eligibilite.js::retardStatus, testée là-bas) : ORIENTÉE dans le temps,
  // jamais une distance symétrique (I1 — l'ancien `ecartMois(...) >= 2`
  // comptait un anniversaire à VENIR comme un retard).
  const retardataires = useMemo(() => {
    if (!candidats) return [];
    return candidats
      .map((c) => ({ ...c, retard: retardStatus(c.moisAnniversaire, moisCourant, toleranceAnniversaireMois) }))
      .filter((c) => c.retard != null);
  }, [candidats, moisCourant, toleranceAnniversaireMois]);

  // Équipements non typés : sans type, la durée est un fallback. Le compteur
  // rend visible ce que le fallback masque. Porte sur les CONTRATS DUS
  // uniquement (candidats), pas sur le parc complet de l'org.
  const contratsATyper = useMemo(
    () => (candidats || []).filter((c) => c.typesNonRenseignes > 0),
    [candidats],
  );
  const aTyper = useMemo(
    () => (candidats || []).reduce((n, c) => n + c.typesNonRenseignes, 0),
    [candidats],
  );

  // Contrats dus dont le client n'a pas de coordonnées : invisibles dans tout
  // l'onglet, sans le moindre signal jusqu'ici.
  const sansPosition = useMemo(
    () => (candidats || []).filter((c) => c.lat == null || c.lng == null),
    [candidats],
  );

  // Pas encore de données du tout (1er chargement, ou échec avant tout succès) :
  // ces deux cas sont mutuellement exclusifs avec la suite (rien à afficher en
  // dessous puisque journees/candidats sont `undefined`), donc un retour
  // anticipé est correct ICI — contrairement au test d'erreur général
  // ci-dessous, qui doit lui rester atteignable même quand `chargement` est
  // faux (cf. Finding A, bloc de tête).
  if (chargement) {
    if (erreurChargement) {
      return (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Erreur de chargement des alertes : {erreurChargement?.message || 'échec inconnu'}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 bg-white rounded-lg border border-gray-200 p-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Calcul des alertes…
      </div>
    );
  }

  // À partir d'ici, journees/candidats sont définis — mais PAS forcément frais :
  // un refetch qui a échoué APRÈS un chargement initial réussi laisse
  // `erreurChargement` vrai alors que `chargement` est faux (React Query garde
  // les anciennes données). Une alerte "propre" (rien à signaler) calculée sur
  // des données dont on sait qu'elles n'ont pas pu être rafraîchies ne peut pas
  // se taire comme si de rien n'était — d'où le `&& !erreurChargement` : sans
  // lui, un refetch en échec après une pose ferait disparaître silencieusement
  // toute alerte devenue entre-temps vraie.
  const rien = sousRemplies.length === 0 && retardataires.length === 0 && aTyper === 0
    && sansPosition.length === 0 && aArbitrer.length === 0;
  if (rien && !erreurChargement) return null;

  return (
    <div className="space-y-3">
      {erreurChargement && (
        <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          Dernière actualisation des alertes en échec — les informations ci-dessous peuvent être
          périmées ({erreurChargement?.message || 'échec inconnu'}).
        </div>
      )}
      {!rien && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {aArbitrer.length > 0 && (
            <AlerteCard
              icon={AlertTriangle}
              color="bg-red-100 text-red-600"
              title="journée(s) pleine(s) à arbitrer"
              count={aArbitrer.length}
            >
              {aArbitrer.map(({ journee: j, sequence }) => {
                const d = sequence?.diagnostic;
                return (
                  <button
                    key={`${j.date}-${j.technicienId}`}
                    type="button"
                    onClick={() => onOpenJournee?.(j)}
                    className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{formatDateFR(j.date)} — {j.technicienNom}</span>
                      {d && <span className="text-xs text-gray-400 flex-shrink-0">{formatDuree(d.chargeMinutes)} / {formatDuree(j.budgetMinutes)}</span>}
                    </div>
                    <div className="text-xs text-gray-500">
                      Pleine, mais impossible à ordonnancer{d?.conflits?.length ? ` : ${d.conflits.length} trajet(s) qui ne tiennent pas` : ''}{d?.depasseBudget ? ', budget dépassé' : ''} (estimé). Le figeage automatique l’a laissée de côté.
                    </div>
                  </button>
                );
              })}
            </AlerteCard>
          )}

          {sousRemplies.length > 0 && (
            <AlerteCard
              icon={AlertTriangle}
              color="bg-amber-100 text-amber-600"
              title="journée(s) sous-remplie(s) à J-7"
              count={sousRemplies.length}
            >
              {sousRemplies.map((j) => (
                <button
                  key={`${j.date}-${j.technicienId}`}
                  type="button"
                  onClick={() => onOpenJournee?.(j)}
                  className="w-full flex items-center justify-between gap-2 text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50"
                >
                  <span className="truncate">{formatDateFR(j.date)} — {j.technicienNom}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{j.chargeMinutes}/{j.budgetMinutes} min</span>
                </button>
              ))}
            </AlerteCard>
          )}

          {retardataires.length > 0 && (
            <AlerteCard
              icon={Clock}
              color="bg-red-100 text-red-600"
              title="contrat(s) retardataire(s)"
              count={retardataires.length}
            >
              {retardataires.map((c) => (
                <button
                  key={c.contractId}
                  type="button"
                  onClick={() => onOpenContract?.(c.contractId)}
                  className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50 truncate"
                >
                  {c.clientName} — {c.ville || '—'}
                  {/* I1.4 — mention DISTINCTE, jamais confondue avec un vrai retard */}
                  {c.retard === 'sans_date' && (
                    <span className="ml-1.5 text-xs text-amber-600 font-medium">(date inconnue)</span>
                  )}
                </button>
              ))}
            </AlerteCard>
          )}

          {sansPosition.length > 0 && (
            <AlerteCard
              icon={MapPinOff}
              color="bg-orange-100 text-orange-600"
              title="client(s) sans adresse localisée"
              count={sansPosition.length}
            >
              <p className="px-2 pb-1 text-xs text-gray-500">
                Sans coordonnées, aucun trajet n&apos;est calculable : ces contrats ne sont
                jamais proposés. Corrigez l&apos;adresse sur la fiche client.
              </p>
              {sansPosition.map((c) => (
                <button
                  key={c.contractId}
                  type="button"
                  onClick={() => onOpenContract?.(c.contractId)}
                  className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50 truncate"
                >
                  {c.clientName} — {c.ville || 'ville inconnue'}
                </button>
              ))}
            </AlerteCard>
          )}

          {aTyper > 0 && (
            <AlerteCard
              icon={Tag}
              color="bg-slate-100 text-slate-600"
              title="équipement(s) sans type"
              count={aTyper}
            >
              {contratsATyper.map((c) => (
                <div key={c.contractId} className="flex items-center justify-between gap-2 text-sm px-2 py-1.5">
                  <span className="truncate">{c.clientName}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{c.typesNonRenseignes} à typer</span>
                </div>
              ))}
              <Link
                to="/settings/pricing"
                className="mt-1 inline-block text-xs font-medium text-blue-600 hover:underline"
              >
                Configurer les types d&apos;équipement →
              </Link>
            </AlerteCard>
          )}
        </div>
      )}
    </div>
  );
}

export default AlertesTournees;
