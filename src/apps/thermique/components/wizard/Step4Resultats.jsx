// src/apps/thermique/components/wizard/Step4Resultats.jsx
// Étape 4 du wizard Thermique : résultats (synthèse, plan coloré, postes), volet PAC et
// sauvegarde DB. buildEtudeModel = source de calcul unique (le PDF du plan 5 consommera le même
// modèle). Deux modes :
// — LIVE : modèle recalculé en continu depuis l'état du wizard ; pac-catalogue.json (~4,6 Mo)
//   lazy-loadé à l'ouverture du volet PAC (model.pac reste null tant qu'il n'est pas chargé).
// — ÉTUDE ROUVERTE (R7) : state.savedResults non null → les résultats FIGÉS sont affichés avec
//   les mêmes composants + bannière moteur (ambre si version ≠ ENGINE_VERSION) ; l'édition et la
//   sauvegarde ne reviennent qu'après « Recalculer avec le moteur actuel » (CLEAR_SAVED_RESULTS).
// Sauvegarde : createStudy si studyId null (l'id retourné est mémorisé via SET_STUDY_ID) sinon
// updateStudy — même payload camelCase (mapper toRow partagé du service). Le brouillon
// localStorage est purgé après TOUTE sauvegarde réussie (pas seulement « Terminer ») : une fois
// l'étude en DB, un draft restant (studyId null) recréerait un doublon à la prochaine visite.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, Info, Loader2, RefreshCw, Save,
} from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useThermalStudyMutations } from '@hooks/useThermalStudies';
import { logger } from '@lib/logger';
import { climat, uDefauts, coefficientsB, ventilation, loadPacCatalogue } from '../../data';
import { buildEtudeModel, resultsPersistables, ENGINE_VERSION } from '../../lib/etudeModel';
import { toStudyInput, clearDraft } from '../../lib/wizardState';
import { PLAGES_VRAISEMBLANCE } from '../../lib/thermiqueConfig';
import { resolvePeriode } from '../../lib/refDataResolvers';
import { pointsManuelsValides } from '../../lib/heatPumpEngine';
import PlanResultats from './PlanResultats';
import PacSection, { PacResultats } from './PacSection';

const fmtInt = (v) => Math.round(v).toLocaleString('fr-FR');

// Ordre et libellés FR des postes de bilan.parPoste (clés du moteur, cf. calculeBatiment).
const POSTES_LABELS = [
  ['murs', 'Murs'],
  ['menuiseries', 'Menuiseries'],
  ['plancherBas', 'Plancher bas'],
  ['plafondToiture', 'Plafond & toiture'],
  ['pontsThermiques', 'Ponts thermiques'],
  ['ventilation', 'Ventilation'],
  ['relance', 'Relance'],
];

/** Synthèse : 3 cartes (Φtotal / W/m² / θe) + décomposition par poste (barres Tailwind —
 * plus simple qu'un BarChart horizontal Recharts pour 7 lignes fixes, choix assumé du plan). */
function Synthese({ bilan, thetaE, dept, periode, plage }) {
  const postes = POSTES_LABELS
    .map(([cle, label]) => ({ cle, label, valeur: bilan.parPoste?.[cle] ?? 0 }))
    .filter((p) => p.valeur > 0);
  const maxPoste = Math.max(...postes.map((p) => p.valeur), 1);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card">
          <p className="text-xs text-secondary-500">Déperditions totales</p>
          <p className="text-2xl font-bold text-secondary-900">
            {(bilan.total / 1000).toFixed(1).replace('.', ',')} kW
          </p>
          {/* Lecture défensive (même défense que parPoste?.[cle]) : un bilan figé d'un futur
              moteur au shape différent doit afficher la bannière R7, pas jeter au rendu. */}
          <p className="text-xs text-secondary-500">
            fourchette {bilan.fourchette?.min != null ? fmtInt(bilan.fourchette.min) : '—'}
            –{bilan.fourchette?.max != null ? fmtInt(bilan.fourchette.max) : '—'} W
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-secondary-500">Ratio surfacique</p>
          <p className="text-2xl font-bold text-secondary-900">{Math.round(bilan.ratioWm2)} W/m²</p>
          {bilan.alerteVraisemblance && plage && (
            <p className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 mt-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              hors plage {plage.min}–{plage.max} W/m² pour {periode} — vérifier la saisie
            </p>
          )}
        </div>
        <div className="card">
          <p className="text-xs text-secondary-500">Température extérieure de base</p>
          <p className="text-2xl font-bold text-secondary-900">{thetaE} °C</p>
          <p className="text-xs text-secondary-500">département {dept}</p>
        </div>
      </div>

      <div className="card space-y-2">
        <h3 className="font-semibold text-secondary-900 text-sm">Décomposition par poste</h3>
        {postes.map((p) => (
          <div key={p.cle} className="flex items-center gap-2 text-sm">
            <span className="w-36 flex-shrink-0 text-secondary-700">{p.label}</span>
            <span className="flex-1 h-3 bg-secondary-100 rounded-full overflow-hidden">
              <span
                className="block h-full bg-primary-500 rounded-full"
                style={{ width: `${Math.max(2, (p.valeur / maxPoste) * 100)}%` }}
              />
            </span>
            <span className="w-20 text-right text-secondary-900 font-medium flex-shrink-0">
              {fmtInt(p.valeur)} W
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Step4Resultats({
  state, config, onPatchPac, onClearSavedResults, onStudyId, onBackToDessin,
}) {
  const { contexte, dessin, compositions, pac, savedResults, studyId } = state;
  const { user } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const { createStudy, updateStudy } = useThermalStudyMutations();

  // --- Catalogue PAC (lazy, ~4,6 Mo) — chargé à l'ouverture du volet PAC ---
  const [pacCatalogue, setPacCatalogue] = useState(null);
  const [pacLoading, setPacLoading] = useState(false);
  const [catalogueErreur, setCatalogueErreur] = useState(false);
  const [pacOpen, setPacOpen] = useState(() => pac.mode != null); // PAC déjà configurée → ouvert
  useEffect(() => {
    // savedResults : résultats figés (R7), aucun calcul live → ne pas télécharger 4,6 Mo pour
    // rien ; « Recalculer » vide savedResults et cet effect se déclenche alors.
    if (savedResults || !pacOpen || pacCatalogue || pacLoading || catalogueErreur) return undefined;
    let cancelled = false;
    setPacLoading(true);
    loadPacCatalogue()
      .then((c) => { if (!cancelled) setPacCatalogue(c); })
      .catch((e) => {
        logger.error('[thermique] chargement du catalogue PAC échoué', e);
        if (!cancelled) {
          setCatalogueErreur(true); // garde anti-boucle : pas de re-tentative automatique
          toast.error('Chargement du catalogue PAC impossible');
        }
      })
      .finally(() => { if (!cancelled) setPacLoading(false); });
    return () => { cancelled = true; };
  }, [savedResults, pacOpen, pacCatalogue, pacLoading, catalogueErreur]);

  // --- Modèle live (source de calcul unique) ---
  const model = useMemo(() => {
    // = toStudyInput(state) avec un volet PAC assaini : pointBivalence LÈVE sur un point manuel
    // incomplet (saisie en cours dans PacSection) — seuls les points valides passent au moteur,
    // l'état (donc l'input persisté) garde la saisie brute. < 2 points valides → model.pac null.
    const input = { contexte, dessin, compositions, pac: { ...pac, points: pointsManuelsValides(pac.points) } };
    try {
      return buildEtudeModel(input, {
        config,
        data: { climat, uDefauts, coefficientsB, ventilation, pacCatalogue },
      });
    } catch (e) {
      // Défense en profondeur : incohérence non couverte par assemblage.erreurs → panneau
      // erreurs plutôt qu'un écran blanc (échouer fort, mais proprement).
      logger.error('[thermique] buildEtudeModel a levé', e);
      return {
        ok: false, erreurs: [e.message], avertissements: [],
        thetaE: null, bilan: null, parois: [], pac: null, engineVersion: ENGINE_VERSION,
      };
    }
  }, [contexte, dessin, compositions, pac, pacCatalogue, config]);

  const periode = resolvePeriode(contexte.annee);
  const plage = PLAGES_VRAISEMBLANCE[periode] ?? null;

  // --- Sauvegarde ---
  const [saving, setSaving] = useState(null); // null | 'draft' | 'completed'
  // Garde (revue globale plan 4) : une PAC catalogue configurée mais non calculable (catalogue
  // 4,6 Mo en cours de chargement, ou en erreur) persisterait results.pac = null en silence —
  // l'étude rouverte n'aurait aucun volet PAC, sans message. On bloque la sauvegarde le temps
  // du chargement ; pac.mode null (pas de PAC) ou 'manuelle' ne sont pas concernés.
  const pacIncomplet = pac.mode === 'catalogue' && !model?.pac;
  const raisonPacIncomplet = pacIncomplet
    ? (catalogueErreur
      ? 'Catalogue PAC indisponible — réessayez ou passez la PAC en saisie manuelle'
      : 'Chargement du catalogue PAC en cours…')
    : null;
  const handleSave = async (status) => {
    const payload = {
      title: contexte.titre,
      clientId: contexte.clientId,
      leadId: contexte.leadId,
      input: toStudyInput(state),
      results: resultsPersistables(model),
      engineVersion: ENGINE_VERSION,
      status,
    };
    setSaving(status);
    try {
      // mutateAsync rejette si le service renvoie { error } — le catch couvre les deux voies.
      if (studyId == null) {
        const created = await createStudy.mutateAsync(payload);
        onStudyId(created.id);
      } else {
        await updateStudy.mutateAsync({ id: studyId, patch: payload });
      }
      clearDraft(userId); // l'étude vit en DB : un draft résiduel (studyId null) ferait doublon
      if (status === 'completed') {
        toast.success('Étude terminée et enregistrée');
        navigate('/thermique/historique');
      } else {
        toast.success('Brouillon enregistré');
      }
    } catch (e) {
      logger.error('[thermique] sauvegarde de l’étude échouée', e);
      toast.error(`Sauvegarde impossible : ${e?.message ?? 'erreur inconnue'}`);
    } finally {
      setSaving(null);
    }
  };

  // ====== Mode « étude rouverte » (R7) : résultats figés + bannière moteur ======
  if (savedResults) {
    const figes = savedResults.results ?? {};
    const memeVersion = savedResults.engineVersion === ENGINE_VERSION;
    return (
      <div className="space-y-4">
        <div className={`flex items-center gap-3 flex-wrap rounded-lg border px-3 py-2.5 text-sm ${
          memeVersion ? 'bg-blue-50 border-blue-100 text-blue-800' : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}
        >
          {memeVersion
            ? <Info className="w-4 h-4 flex-shrink-0" />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          <span className="flex-1 min-w-0">
            Étude enregistrée avec le moteur v{savedResults.engineVersion ?? '?'}
            {!memeVersion && ` — moteur actuel v${ENGINE_VERSION}`}
          </span>
          <button
            type="button"
            onClick={onClearSavedResults}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-white border border-secondary-300 text-secondary-700 hover:bg-secondary-50 rounded-lg"
          >
            <RefreshCw className="w-4 h-4" /> Recalculer avec le moteur actuel
          </button>
        </div>

        {figes.bilan ? (
          <>
            <Synthese bilan={figes.bilan} thetaE={figes.thetaE} dept={contexte.dept} periode={periode} plage={plage} />
            <PlanResultats dessin={dessin} bilan={figes.bilan} />
            {figes.pac && (
              <div className="card space-y-3">
                <h3 className="font-semibold text-secondary-900 text-sm">Pompe à chaleur</h3>
                <PacResultats pacModel={figes.pac} />
              </div>
            )}
          </>
        ) : (
          <p className="card text-sm text-secondary-500">
            Cette étude ne porte pas de résultats exploitables — recalculez avec le moteur actuel.
          </p>
        )}
      </div>
    );
  }

  // ====== Mode live : erreurs bloquantes → panneau + retour au dessin ======
  if (!model.ok) {
    return (
      <div className="card space-y-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-secondary-900">Calcul impossible en l’état</h3>
            <p className="text-sm text-secondary-600">Corrigez les points suivants puis revenez sur cette étape.</p>
          </div>
        </div>
        <ul className="space-y-1.5">
          {model.erreurs.map((e, i) => (
            <li key={`err-${i}`} className="flex items-start gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{e}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onBackToDessin} className="btn-primary inline-flex items-center gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Retourner au dessin
        </button>
      </div>
    );
  }

  // ====== Mode live : résultats ======
  return (
    <div className="space-y-4">
      <Synthese bilan={model.bilan} thetaE={model.thetaE} dept={contexte.dept} periode={periode} plage={plage} />

      {model.avertissements.length > 0 && (
        <ul className="card space-y-1.5">
          {model.avertissements.map((a, i) => (
            <li key={`warn-${i}`} className="flex items-start gap-2 text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{a}</span>
            </li>
          ))}
        </ul>
      )}

      <PlanResultats dessin={dessin} bilan={model.bilan} />

      {/* Volet PAC — le catalogue (~4,6 Mo) ne se charge qu'à l'ouverture */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-secondary-900 text-sm">Pompe à chaleur</h3>
          {!pacOpen && (
            <button type="button" onClick={() => setPacOpen(true)} className="btn-primary text-sm">
              Dimensionner une PAC
            </button>
          )}
        </div>
        {pacOpen && (
          <>
            {catalogueErreur && (
              <p className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                Catalogue PAC indisponible.
                <button
                  type="button"
                  onClick={() => setCatalogueErreur(false)}
                  className="underline font-medium"
                >
                  Réessayer
                </button>
              </p>
            )}
            <PacSection
              pac={pac}
              onPatchPac={onPatchPac}
              model={model}
              config={config}
              pacCatalogue={pacCatalogue}
              pacLoading={pacLoading}
            />
          </>
        )}
      </div>

      {/* Sauvegarde */}
      <div className="card flex items-center justify-end gap-2 flex-wrap">
        {raisonPacIncomplet && (
          <p className="text-xs text-amber-700 mr-auto">{raisonPacIncomplet}</p>
        )}
        <button
          type="button"
          onClick={() => handleSave('draft')}
          disabled={saving != null || pacIncomplet}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-secondary-300 text-secondary-700 hover:bg-secondary-50 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving === 'draft' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Enregistrer (brouillon)
        </button>
        <button
          type="button"
          onClick={() => handleSave('completed')}
          disabled={saving != null || pacIncomplet}
          className="btn-primary flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving === 'completed' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Terminer l’étude
        </button>
      </div>
    </div>
  );
}
