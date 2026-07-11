// src/apps/solaire/pages/Simulateur.jsx
// Orchestrateur du wizard 3 étapes (spec §3). State machine useReducer,
// brouillon localStorage, 1 seul appel PVGIS par simulation (linéarité 1 kWc).
import { useReducer, useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { History, RotateCcw, Loader2, Check } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { usePvSimulation, usePvSimulationMutations } from '@hooks/usePvSimulations';
import { usePvDossierMutations } from '@hooks/usePvDossier';
import { logger } from '@lib/logger';
import { buildCompanyInfo } from '@lib/orgBranding';
import { formatDateFR } from '@lib/utils';
import { buildPvConfig } from '../lib/pvConfig';
import { initialWizardState, wizardReducer, loadDraft, saveDraft, clearDraft } from '../lib/wizardState';
import { toDbCadastre } from '../lib/cadastre';
import { fetchPvgis1kwc } from '../lib/pvgis';
import { percentToDegrees, orientationToAspect } from '../lib/pvEngine';
import { buildEtudeModel } from '../lib/etudeModel';
import { consoProfileHourly, pvgisExample } from '../data';
import { selectAnnexDocs, attachAnnexes, buildEtudeFilename, downloadBlob } from '../lib/etudeExport';
import { generateEtudePdfBlob } from '../components/EtudePDF';
import Step1Localisation from '../components/Step1Localisation';
import Step2Consommation from '../components/Step2Consommation';
import Step3Resultats from '../components/Step3Resultats';
import DossierDrawer from '../components/dossier/DossierDrawer';

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
  return <SimulateurInner config={buildPvConfig(settings)} settings={settings} />;
}

function SimulateurInner({ config, settings }) {
  const { user } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const simId = searchParams.get('sim');
  const { data: savedSim } = usePvSimulation(simId);
  const { createSimulation } = usePvSimulationMutations();
  const { ensureDossier, patchBlock } = usePvDossierMutations();

  const [state, dispatch] = useReducer(wizardReducer, config, initialWizardState);
  const restoredRef = useRef(false);
  const [pvgisLoading, setPvgisLoading] = useState(false);
  const [pvgisError, setPvgisError] = useState(null);
  // Simulation dont le dossier réglementaire est ouvrable depuis les Résultats (après save
  // OU rechargement ?sim=) — le wizard ne connaît sinon pas d'id de simulation.
  const [savedDossierSim, setSavedDossierSim] = useState(null);
  const [dossierOpen, setDossierOpen] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

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
    setSavedDossierSim(savedSim); // dossier ouvrable depuis les Résultats sur une simu rechargée
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

  const handleSave = async ({ clientName, comment, results }) => {
    try {
      const sim = await createSimulation.mutateAsync({
        clientName,
        comment,
        clientAddress: state.location.address || null,
        lat: state.location.lat,
        lon: state.location.lon,
        inputs: {
          location: state.location,
          roof: state.roof,
          conso: state.conso,
          ev: state.ev,
          financing: state.financing,
          selectedKwc: results.selectedKwc,
          // Snapshot wizard (restauration au rechargement ?sim=) — le dossier reste canonique pour les documents.
          cadastre: state.cadastre,
          abf: state.abf,
          material: state.material,
        },
        pvgisMonthly: state.pvgis,
        results,
      });
      // Dossier PV write-once : chaque bloc renseigné dans le wizard rejoint le dossier (création LAZY).
      // Patch non-null only : ne clobber JAMAIS un bloc dossier existant quand le wizard ne le porte pas
      // (ex. simulation rechargée sans re-capture cadastre) — patchBlock remplace le bloc entier.
      const roofGeometryPatch = state.pans?.length
        ? { source: 'drawn_pans', pans: state.pans }
        : state.roofGeometry;
      // Persisté dès qu'un champ diffère du défaut (un aspect non-défaut choisi sans marque
      // doit atteindre le dossier, sinon la notice affirmerait « full black » à tort).
      const materialFilled = state.material && (
        state.material.module_marque
        || state.material.module_modele
        || (state.material.module_aspect && state.material.module_aspect !== 'full_black')
      );
      const dossierPatch = {
        ...(roofGeometryPatch ? { roof_geometry: roofGeometryPatch } : {}),
        ...(state.cadastre?.length ? { cadastre: toDbCadastre(state.cadastre) } : {}),
        ...(state.abf ? { abf: state.abf } : {}),
        ...(materialFilled ? { material: state.material } : {}),
      };
      if (Object.keys(dossierPatch).length > 0 && sim?.id) {
        try {
          const dossier = await ensureDossier.mutateAsync({ simulationId: sim.id });
          if (dossier?.id) {
            await patchBlock.mutateAsync({ id: dossier.id, patch: dossierPatch });
          }
        } catch (dossierErr) {
          // Non bloquant pour la sauvegarde, mais JAMAIS silencieux (logger.warn est no-op en prod) :
          // le commercial doit savoir que la parcelle n'est pas au dossier + le geste de récupération.
          logger.error('[solaire] blocs dossier non persistés', dossierErr);
          toast.warning("Simulation enregistrée, mais le dossier PV (cadastre/ABF/matériel) n'a pas pu être mis à jour — rechargez-la depuis l'historique et ré-enregistrez.");
        }
      }
      clearDraft(userId);
      // Débloque le module réglementaire dans les Résultats (CERFA + notice) sans détour Historique.
      if (sim?.id) {
        setSavedDossierSim({ id: sim.id, client_name: clientName, client_address: state.location.address || null });
      }
      toast.success(`Simulation « ${clientName} » enregistrée`);
    } catch (err) {
      toast.error(`Échec de l'enregistrement : ${err.message}`);
      throw err;
    }
  };

  const handleGeneratePdf = async ({ clientName }) => {
    setIsGeneratingPdf(true);
    try {
      const model = buildEtudeModel({
        roof: state.roof, conso: state.conso, ev: state.ev,
        financing: state.financing, selectedKwc: state.selectedKwc,
        pvgis: state.pvgis, config,
        prodShape: pvgisExample.hourly, baseShape: consoProfileHourly(state.conso.profile),
      });
      if (!model) throw new Error('Données incomplètes');
      const inputs = { roof: state.roof, conso: state.conso, ev: state.ev };
      const annexes = selectAnnexDocs(config, inputs);
      const company = buildCompanyInfo(settings);
      const studyBlob = await generateEtudePdfBlob({
        model, config, company, inputs,
        meta: {
          clientName,
          clientAddress: state.location.address || '',
          dateLabel: formatDateFR(new Date()),
        },
        annexLabels: annexes.map((d) => d.label),
      });
      const finalBlob = await attachAnnexes(studyBlob, annexes);
      downloadBlob(finalBlob, buildEtudeFilename(clientName));
      toast.success('Étude PDF générée');
    } catch (err) {
      toast.error(`Échec de la génération : ${err.message}`);
      throw err;
    } finally {
      setIsGeneratingPdf(false);
    }
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
        <Step1Localisation
          location={state.location}
          roof={state.roof}
          config={config}
          roofGeometry={state.roofGeometry}
          pans={state.pans}
          cadastre={state.cadastre}
          abf={state.abf}
          onLocation={(patch) => dispatch({ type: 'SET_LOCATION', patch })}
          onRoof={(patch) => dispatch({ type: 'SET_ROOF', patch })}
          onRoofGeometry={(value) => dispatch({ type: 'SET_ROOF_GEOMETRY', value })}
          onAddPan={(pan) => dispatch({ type: 'ADD_PAN', pan })}
          onRemovePan={(id) => dispatch({ type: 'REMOVE_PAN', id })}
          onUpdatePan={(id, patch) => dispatch({ type: 'UPDATE_PAN', id, patch })}
          onCadastre={(parcelles) => dispatch({ type: 'SET_CADASTRE', parcelles })}
          onAbf={(abf) => dispatch({ type: 'SET_ABF', abf })}
          onNext={() => goToStep(2)}
        />
      )}
      {state.step === 2 && (
        <Step2Consommation
          conso={state.conso}
          ev={state.ev}
          config={config}
          onConso={(patch) => dispatch({ type: 'SET_CONSO', patch })}
          onEv={(patch) => dispatch({ type: 'SET_EV', patch })}
          onBack={() => goToStep(1)}
          onNext={() => goToStep(3)}
        />
      )}
      {state.step === 3 && (
        <Step3Resultats
          state={state}
          config={config}
          pvgisLoading={pvgisLoading}
          pvgisError={pvgisError}
          onRetryPvgis={fetchPvgis}
          onSelectKwc={(kwc) => {
            dispatch({ type: 'SELECT_KWC', kwc });
            // Changer de scénario invalide le coût saisi à la main (repart de la grille)
            dispatch({ type: 'SET_FINANCING', patch: { manualCost: null } });
          }}
          onFinancing={(patch) => dispatch({ type: 'SET_FINANCING', patch })}
          onMaterial={(patch) => dispatch({ type: 'SET_MATERIAL', patch })}
          onBack={() => goToStep(2)}
          onSave={handleSave}
          isSaving={createSimulation.isPending}
          onGeneratePdf={handleGeneratePdf}
          isGeneratingPdf={isGeneratingPdf}
          defaultClientName={savedSim?.client_name ?? ''}
          dossierSim={savedDossierSim}
          onOpenDossier={() => setDossierOpen(true)}
        />
      )}

      <DossierDrawer
        open={dossierOpen}
        onClose={() => setDossierOpen(false)}
        simulation={savedDossierSim}
      />
    </div>
  );
}
