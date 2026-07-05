// src/apps/thermique/pages/ThermiqueWizard.jsx
// Orchestrateur du wizard d'étude de déperditions — 4 étapes (pattern Simulateur.jsx Solaire).
// State machine useReducer (wizardState.js, pur), brouillon localStorage debounce 1 s,
// rechargement ?etude=<id> (LOAD_STUDY), pré-remplissage ?client=<id>.
// Étape 4 (Step4Resultats) : résultats + PAC + sauvegarde DB (create/update via studyId).
import { useReducer, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { History, RotateCcw, Loader2, Check, SearchX, ArrowLeft, ArrowRight } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useThermalStudy } from '@hooks/useThermalStudies';
import { clientsService } from '@services/clients.service';
import { logger } from '@lib/logger';
import { buildThermiqueConfig } from '../lib/thermiqueConfig';
import { initialWizardState, wizardReducer, loadDraft, saveDraft, clearDraft } from '../lib/wizardState';
import { valideDessin } from '../lib/dessinOps';
import Step1Contexte from '../components/wizard/Step1Contexte';
import Step2Dessin from '../components/wizard/Step2Dessin';
import Step3OuverturesCompositions from '../components/wizard/Step3OuverturesCompositions';
import Step4Resultats from '../components/wizard/Step4Resultats';

const STEPS = [
  { n: 1, label: 'Contexte' },
  { n: 2, label: 'Dessin' },
  { n: 3, label: 'Ouvertures & compositions' },
  { n: 4, label: 'Résultats' },
];

export default function ThermiqueWizard() {
  const { settings, isLoading } = useOrgSettings();
  // Identité stable : sans useMemo, chaque re-render du wrapper fabriquerait une nouvelle
  // config et re-déclencherait les effects de l'inner qui en dépendent (LOAD_STUDY notamment).
  const config = useMemo(() => buildThermiqueConfig(settings), [settings]);
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }
  return <WizardInner config={config} />;
}

function WizardInner({ config }) {
  const { user } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const etudeId = searchParams.get('etude');
  const clientId = searchParams.get('client');
  const { data: savedStudy, isPending: studyPending } = useThermalStudy(etudeId);

  const [state, dispatch] = useReducer(wizardReducer, config, initialWizardState);
  const restoredRef = useRef(false);
  const clientPrefillRef = useRef(false);
  const loadedStudyIdRef = useRef(null);
  // Ville du client pré-rempli → valeur initiale du champ de recherche commune
  const [communeInitialQuery, setCommuneInitialQuery] = useState('');

  // --- Brouillon : restauration au mount (pas en mode ?etude= ni ?client=) ---
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (etudeId || clientId) return;
    const draft = loadDraft(userId);
    if (draft) {
      dispatch({ type: 'LOAD', state: { ...initialWizardState(config), ...draft } });
      toast.info('Brouillon restauré', {
        action: {
          label: 'Repartir de zéro',
          onClick: () => {
            clearDraft(userId);
            dispatch({ type: 'RESET', config });
          },
        },
      });
    }
  }, [etudeId, clientId, userId, config]);

  // --- Rechargement à l'identique depuis l'historique (?etude=<id>) ---
  useEffect(() => {
    if (!etudeId || !savedStudy) return;
    // Une étude ne se charge qu'UNE fois : après une sauvegarde (Task 14), l'invalidation
    // React Query refetch et change l'identité de savedStudy — sans cette garde, chaque save
    // re-dispatcherait LOAD_STUDY et écraserait les modifications en cours.
    if (loadedStudyIdRef.current === savedStudy.id) return;
    loadedStudyIdRef.current = savedStudy.id;
    dispatch({ type: 'LOAD_STUDY', study: savedStudy, config });
    toast.success(`Étude${savedStudy.title ? ` « ${savedStudy.title} »` : ''} rechargée`);
  }, [etudeId, savedStudy, config]);

  // --- Pré-remplissage ?client=<id> : titre + clientId + ville (échec silencieux) ---
  useEffect(() => {
    if (!clientId || etudeId || clientPrefillRef.current) return;
    clientPrefillRef.current = true;
    (async () => {
      const { data, error } = await clientsService.getClientById(clientId);
      if (error || !data) {
        logger.warn('[thermique] pré-remplissage client impossible', error);
        return;
      }
      const nom = data.display_name || data.name
        || `${data.last_name || ''} ${data.first_name || ''}`.trim();
      dispatch({
        type: 'PATCH_CONTEXTE',
        patch: { clientId, ...(nom ? { titre: `Étude thermique — ${nom}` } : {}) },
      });
      if (data.city) setCommuneInitialQuery(data.city);
    })();
  }, [clientId, etudeId]);

  // --- Autosave brouillon (debounce 1 s — jamais pour une étude chargée) ---
  useEffect(() => {
    // state.studyId en plus de etudeId : naviguer de ?etude=<id> vers /thermique nu ne
    // remonte pas le composant — sans ce garde, l'étude chargée fuirait dans le brouillon
    // personnel (« Brouillon restauré » trompeur + risque d'UPDATE involontaire en Task 14).
    if (etudeId || state.studyId || !restoredRef.current) return undefined;
    const t = setTimeout(() => saveDraft(userId, state), 1000);
    return () => clearTimeout(t);
  }, [state, userId, etudeId]);

  // --- Gating navigation ---
  const dessinCheck = useMemo(() => valideDessin(state.dessin), [state.dessin]);
  const hasPieceChauffee = state.dessin.pieces.some((p) => p.chauffee);

  const blockedReason = (targetStep) => {
    if (targetStep >= 2 && state.contexte.dept == null) {
      return 'Sélectionnez une commune pour continuer';
    }
    if (targetStep >= 4) {
      if (dessinCheck.erreurs.length > 0) {
        return `Corrigez le dessin (${dessinCheck.erreurs.length} erreur${dessinCheck.erreurs.length > 1 ? 's' : ''})`;
      }
      if (!hasPieceChauffee) return 'Ajoutez au moins une pièce chauffée au dessin';
    }
    return null;
  };

  const goToStep = (n) => dispatch({ type: 'SET_STEP', step: n });
  const nextBlocked = state.step < 4 ? blockedReason(state.step + 1) : null;

  const handleNew = () => {
    clearDraft(userId);
    if (etudeId || clientId) setSearchParams({}, { replace: true });
    // Autorise le rechargement de l'étude si on y revient (bouton précédent du navigateur
    // après « Nouvelle » : sans ce reset, la garde one-shot de LOAD_STUDY bloquerait).
    loadedStudyIdRef.current = null;
    setCommuneInitialQuery('');
    dispatch({ type: 'RESET', config });
  };

  // --- ?etude= : chargement / introuvable (étude supprimée ou inaccessible — maybeSingle) ---
  if (etudeId && studyPending) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }
  if (etudeId && !studyPending && savedStudy == null) {
    return (
      <div className="max-w-xl mx-auto card text-center space-y-4 mt-10">
        <SearchX className="w-10 h-10 text-secondary-400 mx-auto" />
        <div>
          <h1 className="text-lg font-semibold text-secondary-900">Étude introuvable</h1>
          <p className="text-sm text-secondary-600 mt-1">
            Cette étude a peut-être été supprimée, ou vous n’y avez pas accès.
          </p>
        </div>
        <button
          onClick={() => navigate('/thermique/historique')}
          className="btn-primary inline-flex items-center gap-2"
        >
          <History className="w-4 h-4" /> Voir l’historique des études
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Étude thermique</h1>
          <p className="text-secondary-600 text-sm">Déperditions, dimensionnement PAC et consommation</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleNew}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-secondary-600 hover:text-secondary-900 hover:bg-secondary-100 rounded-lg"
          >
            <RotateCcw className="w-4 h-4" /> Nouvelle
          </button>
          <button
            onClick={() => navigate('/thermique/historique')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-secondary-600 hover:text-secondary-900 hover:bg-secondary-100 rounded-lg"
          >
            <History className="w-4 h-4" /> Historique
          </button>
        </div>
      </div>

      {/* Stepper — numéro + libellé (jamais la couleur seule) */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => {
          const isActive = state.step === s.n;
          const isDone = state.step > s.n;
          return (
            <div key={s.n} className="flex items-center flex-1 min-w-0">
              <button
                onClick={() => isDone && goToStep(s.n)}
                disabled={!isDone}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-medium w-full min-w-0 ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : isDone
                      ? 'text-secondary-700 hover:bg-secondary-50 cursor-pointer'
                      : 'text-secondary-400 cursor-default'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                  isActive ? 'bg-primary-600 text-white' : isDone ? 'bg-secondary-200 text-secondary-700' : 'bg-secondary-100 text-secondary-400'
                }`}
                >
                  {isDone ? <Check className="w-3.5 h-3.5" /> : s.n}
                </span>
                <span className="truncate">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <div className="h-px bg-secondary-200 w-4 flex-shrink-0" />}
            </div>
          );
        })}
      </div>

      {/* Étape courante */}
      {state.step === 1 && (
        <Step1Contexte
          contexte={state.contexte}
          dessin={state.dessin}
          communeInitialQuery={communeInitialQuery}
          onPatchContexte={(patch) => dispatch({ type: 'PATCH_CONTEXTE', patch })}
          onSetDessin={(dessin) => dispatch({ type: 'SET_DESSIN', dessin })}
          onCommune={({ commune, dju, djuFallback }) => dispatch({ type: 'SET_COMMUNE', commune, dju, djuFallback })}
        />
      )}
      {state.step === 2 && (
        <Step2Dessin
          dessin={state.dessin}
          config={config}
          onDessinChange={(dessin) => dispatch({ type: 'SET_DESSIN', dessin })}
        />
      )}
      {state.step === 3 && (
        <Step3OuverturesCompositions
          dessin={state.dessin}
          compositions={state.compositions}
          annee={state.contexte.annee}
          dessinCheck={dessinCheck}
          onDessinChange={(dessin) => dispatch({ type: 'SET_DESSIN', dessin })}
          onPatchCompositions={(patch) => dispatch({ type: 'PATCH_COMPOSITIONS', patch })}
          onExceptionParoi={(cle, u) => dispatch({ type: 'SET_EXCEPTION_PAROI', cle, u })}
          onExceptionOuverture={(ouvertureId, u) => dispatch({ type: 'SET_EXCEPTION_OUVERTURE', ouvertureId, u })}
        />
      )}
      {state.step === 4 && (
        <Step4Resultats
          state={state}
          config={config}
          onPatchPac={(patch) => dispatch({ type: 'PATCH_PAC', patch })}
          onClearSavedResults={() => dispatch({ type: 'CLEAR_SAVED_RESULTS' })}
          onStudyId={(studyId) => dispatch({ type: 'SET_STUDY_ID', studyId })}
          onBackToDessin={() => goToStep(2)}
        />
      )}

      {/* Navigation Précédent / Suivant */}
      <div className="flex items-center justify-between gap-3">
        <div>
          {state.step > 1 && (
            <button
              onClick={() => goToStep(state.step - 1)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-secondary-700 hover:bg-secondary-100 rounded-lg"
            >
              <ArrowLeft className="w-4 h-4" /> Précédent
            </button>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {state.step < 4 && (
            <button
              onClick={() => goToStep(state.step + 1)}
              disabled={!!nextBlocked}
              className="btn-primary flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Suivant <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {nextBlocked && <p className="text-xs text-secondary-500">{nextBlocked}</p>}
        </div>
      </div>
    </div>
  );
}
