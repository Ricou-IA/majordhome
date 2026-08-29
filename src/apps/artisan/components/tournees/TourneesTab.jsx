/**
 * TourneesTab.jsx - Majord'home Artisan
 * ============================================================================
 * Onglet "Tournées" du module Entretiens & SAV : sur une journée creuse d'un
 * technicien, propose les entretiens dus qui coûtent le moins de trajet à
 * insérer. Le critère n'est pas la zone géographique mais le coût marginal en
 * minutes (cf. src/lib/tournee/insertion.js).
 *
 * Structure :
 *   - AlertesTournees (montée en tête) : les trois filets (sous-remplies,
 *     retardataires, équipements à typer).
 *   - Bandeau : nombre de contrats dus, nombre de journées ouvertes,
 *     avertissement si le siège n'est pas configuré.
 *   - Liste des journées de l'horizon, groupées en 2 sections : horizon ferme
 *     (toutes) et au-delà (uniquement les journées déjà amorcées, spec §3.2).
 *   - Clic sur une carte → RemplirJourneePanel (proposition + pose des RDV).
 *
 * ⚠️ Les compteurs (bandeau) et les listes ne doivent JAMAIS afficher un
 * nombre/une liste quand la donnée est en erreur : `useContratsDus` comme
 * `useJourneesHorizon` sont consommés avec leur `isError`/`error`, jamais
 * juste `data` — un échec réel ne doit jamais se lire comme "0".
 *
 * `selectedJournee` n'est PAS stocké comme un objet capturé au clic : il est
 * DÉRIVÉ à chaque rendu de la liste vivante `journees` (par clé date+tech).
 * Ainsi, après une pose (les caches tournees/appointments/interventions sont
 * invalidés par RemplirJourneePanel), la journée rouverte pour un nouvel
 * essai reflète la charge à jour — jamais l'état capturé avant la pose.
 *
 * Spec : docs/superpowers/specs/2026-08-29-optimisation-tournees-entretiens-design.md
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Users, CalendarDays } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useContratsDus, useJourneesHorizon } from '@hooks/useTournees';
import { construireReglages } from '@services/tournees.service';
import { getOrgHeadquarters } from '@lib/territoire-config';
import { formatDateFR } from '@/lib/utils';
import { ContractModal } from '@apps/artisan/components/entretiens/ContractModal';
import { AlertesTournees } from './AlertesTournees';
import { RemplirJourneePanel } from './RemplirJourneePanel';

// Marge de recherche des journées déjà amorcées AU-DELÀ de l'horizon ferme
// (spec §3.2). La fenêtre chargée = horizon_ferme_jours + cette marge, JAMAIS
// une constante figée indépendante du réglage (Finding C, fix round 2) :
// avec un JOURS_HORIZON fixe à 45, une org qui aurait réglé horizon_ferme_jours
// au-delà de 45 aurait vu sa propre section "horizon ferme" silencieusement
// tronquée (journées au-delà de J+45 jamais chargées, donc jamais visibles,
// alors qu'elles font pourtant partie de l'horizon ferme promis).
const MARGE_AMORCEE_JOURS = 30;

// Seuil au-dessous duquel une journée ne peut rien accueillir, donc n'est pas
// affichée. Deux termes :
//   - 60 min : le plus court entretien du parc (poêle à bois, mono-split) ;
//   - 30 min : l'aller-retour minimal pour s'y rendre depuis le reste de la
//     tournée, en zone rurale.
// Le second terme n'est pas cosmétique. `chargeMinutes` ne compte QUE les durées
// d'intervention, alors que le moteur budgète aussi les trajets : sans cette
// marge, une journée annoncée « 60 min libres » ouvrait un panneau répondant
// « déjà en dépassement » — les deux chiffres ne mesuraient pas la même chose.
// Observé le 11/09 (3 RDV, 420 min d'intervention, budget 480).
const DUREE_MIN_ENTRETIEN_MINUTES = 60;
const TRAJET_MIN_ALLER_RETOUR_MINUTES = 30;
const SEUIL_JOURNEE_EXPLOITABLE_MINUTES = DUREE_MIN_ENTRETIEN_MINUTES + TRAJET_MIN_ALLER_RETOUR_MINUTES;

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/** Valeur du bandeau : chargement (…), erreur (— rouge) ou nombre — jamais un 0 sur échec. */
function StatValue({ isLoading, isError, value }) {
  if (isLoading) return <span className="text-xl font-semibold text-gray-900">…</span>;
  if (isError) return <span className="text-xl font-semibold text-red-600" title="Erreur de chargement">—</span>;
  return <span className="text-xl font-semibold text-gray-900">{value}</span>;
}

/**
 * Minutes encore disponibles sur une journée. Négatif = la journée déborde déjà
 * (typiquement une installation qui occupe 9 à 10 h).
 */
function minutesDisponibles(journee) {
  return (journee.budgetMinutes || 0) - (journee.chargeMinutes || 0);
}

function JourneeCard({ journee, onClick }) {
  const pct = journee.budgetMinutes > 0
    ? Math.min(100, Math.round((journee.chargeMinutes / journee.budgetMinutes) * 100))
    : 0;
  // On affiche le temps LIBRE, pas la charge : « 150 min libres » se lit d'un
  // coup d'œil là où « 330 / 480 » demande une soustraction à chaque carte.
  const libre = minutesDisponibles(journee);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-gray-500">{formatDateFR(journee.date)}</span>
        {journee.estAmorcee && (
          <span className="inline-flex items-center rounded-full font-medium px-2 py-0.5 text-xs bg-emerald-100 text-emerald-800 flex-shrink-0">
            Amorcée
          </span>
        )}
      </div>
      {/* Le nom du technicien n'est pas répété ici : il titre la colonne. */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span
            className="font-semibold text-gray-900"
            title="Temps restant hors trajets. Le moteur, lui, budgete aussi les deplacements : une journee peut donc refuser un entretien qui tiendrait sur ce seul chiffre."
          >
            {libre} min libres
          </span>
          <span className="text-gray-500">{journee.rdvs.length} RDV · {journee.chargeMinutes} min</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </button>
  );
}

/**
 * Une colonne par technicien, journées en ordre chronologique à l'intérieur.
 * On lit ainsi la charge d'une personne d'un seul coup d'œil, comme sur un
 * planning — là où une grille triée par temps libre mélangeait les techniciens
 * et obligeait à relire le nom sur chaque carte.
 *
 * `techniciens` vient de l'ensemble des journées de l'onglet, pas de celles de
 * la section : une colonne reste affichée même vide, sinon les colonnes se
 * décaleraient d'une section à l'autre.
 */
function SectionJournees({ title, journees, techniciens, onOpen, emptyLabel }) {
  const parTechnicien = useMemo(() => {
    const m = new Map(techniciens.map((t) => [t.id, []]));
    for (const j of journees) {
      if (m.has(j.technicienId)) m.get(j.technicienId).push(j);
    }
    for (const liste of m.values()) liste.sort((a, b) => a.date.localeCompare(b.date));
    return m;
  }, [journees, techniciens]);

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
        {title} <span className="text-gray-400 font-normal normal-case">({journees.length})</span>
      </h3>
      {journees.length === 0 ? (
        <p className="text-sm text-gray-400 italic">{emptyLabel}</p>
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, techniciens.length)}, minmax(0, 1fr))` }}
        >
          {techniciens.map((tech) => {
            const siennes = parTechnicien.get(tech.id) || [];
            return (
              <div key={tech.id} className="min-w-0">
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-200">
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: tech.couleur || '#94A3B8' }}
                  />
                  <span className="font-semibold text-gray-900 truncate">{tech.nom}</span>
                  <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                    {siennes.length}
                  </span>
                </div>
                {siennes.length === 0 ? (
                  <p className="text-xs text-gray-400 italic py-2">Aucune journée exploitable</p>
                ) : (
                  <div className="space-y-3">
                    {siennes.map((j) => (
                      <JourneeCard key={`${j.date}-${j.technicienId}`} journee={j} onClick={() => onOpen(j)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function TourneesTab() {
  const { organization } = useAuth();
  const coreOrgId = organization?.id;
  const { settings, isLoading: settingsLoading } = useOrgSettings();

  const reglages = useMemo(() => construireReglages(settings), [settings]);
  const depot = useMemo(() => getOrgHeadquarters(settings), [settings]);

  const {
    data: candidats, isLoading: candidatsLoading, isError: candidatsIsError, error: candidatsError,
  } = useContratsDus(coreOrgId);
  const {
    data: journees, isLoading: journeesLoading, isError: journeesIsError, error: journeesError,
  } = useJourneesHorizon(coreOrgId, reglages.horizon_ferme_jours + MARGE_AMORCEE_JOURS);

  // Clé (date + technicienId), pas l'objet Journee lui-même : la journée
  // affichée est dérivée en direct de `journees` à chaque rendu (cf. bloc de
  // tête), pour ne jamais retenter sur une charge/RDV périmés après une pose.
  const [selectedJourneeKey, setSelectedJourneeKey] = useState(null);
  const [selectedContractId, setSelectedContractId] = useState(null);

  const selectedJournee = useMemo(() => {
    if (!selectedJourneeKey || !journees) return null;
    return journees.find(
      (j) => j.date === selectedJourneeKey.date && j.technicienId === selectedJourneeKey.technicienId,
    ) || null;
  }, [selectedJourneeKey, journees]);

  const ouvrirJournee = (j) => setSelectedJourneeKey({ date: j.date, technicienId: j.technicienId });

  // Filtrage impératif (spec §3.2) : au-delà de l'horizon ferme, seules les
  // journées déjà amorcées sont proposables — getJourneesHorizon ne filtre
  // pas lui-même, c'est à l'écran de le faire (cf. task-11-report.md).
  const { joursFermes, joursAmorces, totalVisibles, nbMasquees, techniciens } = useMemo(() => {
    if (!journees) {
      return { joursFermes: [], joursAmorces: [], totalVisibles: 0, nbMasquees: 0, techniciens: [] };
    }

    const limiteFerme = new Date();
    limiteFerme.setDate(limiteFerme.getDate() + reglages.horizon_ferme_jours);
    const limite = limiteFerme.toISOString().slice(0, 10);

    const dansHorizon = (journees || []).filter(
      (j) => j.date <= limite || j.estAmorcee,
    );

    // Une journée dont il reste moins que le plus court entretien du parc ne peut
    // rien accueillir : l'afficher obligerait à la parcourir pour rien. Les
    // journées en dépassement (disponible négatif, typiquement une installation
    // qui occupe 9 à 10 h) tombent dans le même cas.
    const exploitables = dansHorizon.filter(
      (j) => minutesDisponibles(j) >= SEUIL_JOURNEE_EXPLOITABLE_MINUTES,
    );

    // L'ordre à l'intérieur d'une colonne est chronologique, il est appliqué par
    // SectionJournees. Ici on ne fait que répartir entre les deux sections.
    // La liste des techniciens vient de TOUTES les journées de l'horizon (pas des
    // seules exploitables) : une colonne dont tout est plein doit rester visible
    // et le dire, sinon elle disparaîtrait sans explication.
    const techs = new Map();
    for (const j of dansHorizon) {
      if (!techs.has(j.technicienId)) {
        techs.set(j.technicienId, {
          id: j.technicienId, nom: j.technicienNom, couleur: j.couleur,
        });
      }
    }

    return {
      joursFermes: exploitables.filter((j) => j.date <= limite),
      joursAmorces: exploitables.filter((j) => j.date > limite),
      totalVisibles: exploitables.length,
      nbMasquees: dansHorizon.length - exploitables.length,
      techniciens: [...techs.values()].sort((a, b) => a.nom.localeCompare(b.nom)),
    };
  }, [journees, reglages.horizon_ferme_jours]);

  return (
    <div className="space-y-6">
      <AlertesTournees
        journees={journees}
        candidats={candidats}
        journeesError={journeesError}
        candidatsError={candidatsError}
        onOpenJournee={ouvrirJournee}
        onOpenContract={setSelectedContractId}
        toleranceAnniversaireMois={reglages.tolerance_anniversaire_mois}
      />

      {/* Bandeau de tête */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-gray-400" />
          <div>
            <StatValue isLoading={candidatsLoading} isError={candidatsIsError} value={candidats?.length ?? 0} />
            <span className="text-sm text-gray-500 ml-2">contrats dus</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-gray-400" />
          <div>
            <StatValue isLoading={journeesLoading} isError={journeesIsError} value={totalVisibles} />
            <span className="text-sm text-gray-500 ml-2">
              {totalVisibles > 1 ? 'journées exploitables' : 'journée exploitable'}
            </span>
            {/* Une troncature qu'on ne montre pas se lit comme un planning vide. */}
            {!journeesLoading && !journeesIsError && nbMasquees > 0 && (
              <span className="block text-xs text-gray-400">
                {nbMasquees} {nbMasquees > 1 ? 'journées complètes masquées' : 'journée complète masquée'}
              </span>
            )}
          </div>
        </div>
      </div>

      {!settingsLoading && !depot && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500 mt-0.5" />
          <p>
            Configurez le siège dans <strong>Réglages → Organisation → Territoire</strong> pour
            activer le calcul des trajets. Sans siège, aucune proposition de tournée n&apos;est possible.
          </p>
        </div>
      )}

      {candidatsIsError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
          Erreur de chargement des contrats dus : {candidatsError?.message || 'échec inconnu'}
        </div>
      )}

      {journeesLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Chargement des journées…</span>
        </div>
      ) : journeesIsError ? (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
          Erreur de chargement des journées : {journeesError?.message || 'échec inconnu'}
        </div>
      ) : (
        <div className="space-y-8">
          <SectionJournees
            title={`Horizon ferme (${reglages.horizon_ferme_jours} jours)`}
            journees={joursFermes}
            techniciens={techniciens}
            onOpen={ouvrirJournee}
            emptyLabel="Aucune journée dans l'horizon ferme."
          />
          {joursAmorces.length > 0 && (
            <SectionJournees
              title="Au-delà — journées déjà amorcées"
              journees={joursAmorces}
              techniciens={techniciens}
              onOpen={ouvrirJournee}
              emptyLabel=""
            />
          )}
        </div>
      )}

      {selectedJournee && (
        <RemplirJourneePanel
          journee={selectedJournee}
          candidats={candidats}
          candidatsError={candidatsError}
          onClose={() => setSelectedJourneeKey(null)}
        />
      )}

      <ContractModal
        contractId={selectedContractId}
        isOpen={!!selectedContractId}
        onClose={() => setSelectedContractId(null)}
      />
    </div>
  );
}

export default TourneesTab;
