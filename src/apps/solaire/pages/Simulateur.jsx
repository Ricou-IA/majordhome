// src/apps/solaire/pages/Simulateur.jsx
// Orchestrateur du wizard 3 étapes (spec §3). State machine useReducer,
// brouillon localStorage, 1 seul appel PVGIS par simulation (linéarité 1 kWc).
import { useReducer, useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { History, RotateCcw, Loader2, Check } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { usePvSimulation } from '@hooks/usePvSimulations';
import { buildPvConfig } from '../lib/pvConfig';
import { initialWizardState, wizardReducer, loadDraft, saveDraft, clearDraft } from '../lib/wizardState';
import { fetchPvgis1kwc } from '../lib/pvgis';
import { percentToDegrees, orientationToAspect } from '../lib/pvEngine';

const STEPS = [
  { n: 1, label: 'Localisation' },
  { n: 2, label: 'Consommation' },
  { n: 3, label: 'Résultats' },
];

export default function Simulateur() {
  const { settings, isLoading } = useOrgSettings();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }
  return <SimulateurInner config={buildPvConfig(settings)} />;
}

function SimulateurInner({ config }) {
  const { user } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const simId = searchParams.get('sim');
  const { data: savedSim } = usePvSimulation(simId);

  const [state, dispatch] = useReducer(wizardReducer, config, initialWizardState);
  const restoredRef = useRef(false);
  const [pvgisLoading, setPvgisLoading] = useState(false);
  const [pvgisError, setPvgisError] = useState(null);

  // --- Brouillon : restauration au mount (sauf rechargement ?sim=) ---
  useEffect(() => {
    if (restoredRef.current || simId) return;
    restoredRef.current = true;
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
  }, [simId, userId, config]);

  // --- Rechargement à l'identique depuis l'historique (?sim=<id>) ---
  useEffect(() => {
    if (!simId || !savedSim) return;
    dispatch({
      type: 'LOAD',
      state: {
        ...initialWizardState(config),
        ...(savedSim.inputs ?? {}),
        pvgis: savedSim.pvgis_monthly, // persisté → AUCUN nouvel appel PVGIS (critère #8)
        selectedKwc: savedSim.inputs?.selectedKwc ?? null,
        step: 3,
      },
    });
    toast.success(`Simulation${savedSim.client_name ? ` « ${savedSim.client_name} »` : ''} rechargée`);
  }, [simId, savedSim, config]);

  // --- Autosave brouillon (debounce 1 s, pas en mode rechargement) ---
  useEffect(() => {
    if (simId || !restoredRef.current) return undefined;
    const t = setTimeout(() => saveDraft(userId, state), 1000);
    return () => clearTimeout(t);
  }, [state, userId, simId]);

  // --- PVGIS : 1 appel à 1 kWc à l'entrée du step 3 (si pas déjà en cache) ---
  const fetchPvgis = useCallback(async () => {
    setPvgisLoading(true);
    setPvgisError(null);
    const orientation = state.roof.orientation;
    const { data, error } = await fetchPvgis1kwc({
      lat: state.location.lat,
      lon: state.location.lon,
      loss: config.system_loss,
      angleDeg: Math.round(percentToDegrees(Number(state.roof.tiltPercent) || 0) * 10) / 10,
      aspect: orientationToAspect(orientation),
    });
    setPvgisLoading(false);
    if (error || !data) {
      setPvgisError(error?.message || 'Erreur PVGIS');
      return;
    }
    dispatch({ type: 'SET_PVGIS', pvgis: data });
  }, [state.location.lat, state.location.lon, state.roof.tiltPercent, state.roof.orientation, config.system_loss]);

  useEffect(() => {
    if (state.step === 3 && !state.pvgis && !pvgisLoading && !pvgisError && state.location.lat !== null) {
      fetchPvgis();
    }
  }, [state.step, state.pvgis, pvgisLoading, pvgisError, state.location.lat, fetchPvgis]);

  const handleNewSimulation = () => {
    clearDraft(userId);
    setPvgisError(null);
    if (simId) setSearchParams({}, { replace: true });
    dispatch({ type: 'RESET', config });
  };

  const goToStep = (n) => dispatch({ type: 'SET_STEP', step: n });

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Solaire</h1>
          <p className="text-secondary-600 text-sm">Simulation de rentabilité photovoltaïque</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleNewSimulation}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-secondary-600 hover:text-secondary-900 hover:bg-secondary-100 rounded-lg"
          >
            <RotateCcw className="w-4 h-4" /> Nouvelle
          </button>
          <button
            onClick={() => navigate('/solaire/historique')}
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
        <div className="card text-sm text-secondary-500">Étape 1 — en construction (Task G2)</div>
      )}
      {state.step === 2 && (
        <div className="card text-sm text-secondary-500">Étape 2 — en construction (Task G3)</div>
      )}
      {state.step === 3 && (
        <div className="card text-sm text-secondary-500">Étape 3 — en construction (Task G4)</div>
      )}
    </div>
  );
}
