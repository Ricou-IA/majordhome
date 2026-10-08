// src/apps/solaire/components/demarches/DemarchesSection.jsx
// Chapitre « Démarches administratives » de l'étape Résultats : saisies projet → moteur pur
// calculerDemarches → résultat FIGÉ dans pv_dossiers.demarches (relu tel quel, recalcul sur
// geste explicite). Aucune règle métier ici : assemblage (demarchesInputs.js) + moteur (lib/demarches).
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ClipboardList, Calculator, Loader2, RefreshCw, AlertTriangle, ListChecks, Receipt, CalendarRange, Route } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { usePvDossierMutations } from '@hooks/usePvDossier';
import { buildCompanyInfo } from '@lib/orgBranding';
import { formatDateShortFR } from '@lib/utils';
import { calculerDemarches, normaliserInputs, ENGINE_VERSION } from '../../lib/demarches/index';
import { buildDemarchesParams } from '../../lib/demarches/parametres';
import { assemblerInputsDemarches } from '../../lib/demarchesInputs';
import DemarchesInputs from './DemarchesInputs';
import ParcoursSynoptique from './ParcoursSynoptique';
import PlanningPrevisionnel from './PlanningPrevisionnel';
import ChecklistPieces from './ChecklistPieces';
import TableauFrais from './TableauFrais';
import AlertesDemarches from './AlertesDemarches';

const SAISIES = ['mode_valorisation', 'copropriete_ou_lotissement', 'compteur_linky', 'date_depart', 'prise_en_charge', 'devis'];
const todayIso = () => new Date().toISOString().slice(0, 10);

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj?.[k]]));
}

function SousTitre({ Icon, children }) {
  return (
    <h3 className="text-sm font-semibold text-secondary-900 flex items-center gap-1.5 mt-2">
      <Icon className="w-4 h-4 text-secondary-500" aria-hidden="true" /> {children}
    </h3>
  );
}

export default function DemarchesSection({ state, dossier, dossierSim, activeKwc }) {
  const { settings } = useOrgSettings();
  const { patchBlock } = usePvDossierMutations();
  const company = useMemo(() => buildCompanyInfo(settings), [settings]);
  const params = useMemo(() => buildDemarchesParams(settings), [settings]);

  // Entrées complètes = dérivés (toujours à jour) + saisies persistées (ou défauts).
  const assembled = useMemo(
    () => assemblerInputsDemarches({ state, dossier, activeKwc, company, aujourdhui: todayIso() }),
    [state, dossier, activeKwc, company],
  );
  const [form, setForm] = useState(() => pick(assembled, SAISIES));
  // Réaligne le formulaire sur les saisies persistées quand le dossier (re)charge.
  useEffect(() => { setForm(pick(assembled, SAISIES)); }, [dossier?.id, dossier?.demarches?.mis_a_jour_le]); // eslint-disable-line react-hooks/exhaustive-deps

  const inputs = useMemo(() => ({ ...assembled, ...form }), [assembled, form]);
  const demarches = dossier?.demarches ?? null;
  const resultat = demarches?.resultat ?? null;

  // Résultat figé à recalculer ? (moteur plus récent, dérivés ou saisies modifiés)
  const perime = useMemo(() => {
    if (!resultat) return false;
    if (resultat.engine_version !== ENGINE_VERSION) return true;
    const now = normaliserInputs(inputs, { aujourdhui: todayIso() });
    const old = resultat.inputs ?? {};
    const cles = ['puissance_kwc', 'batterie', 'perimetre_abf', 'installateur_rge', 'mode_valorisation', 'copropriete_ou_lotissement', 'compteur_linky', 'date_depart'];
    if (cles.some((k) => now[k] !== old[k])) return true;
    return JSON.stringify(now.prise_en_charge ?? {}) !== JSON.stringify(old.prise_en_charge ?? {});
  }, [resultat, inputs]);

  const persist = async (bloc) => patchBlock.mutateAsync({ id: dossier.id, patch: { demarches: bloc } });

  const calculer = async () => {
    try {
      const res = calculerDemarches(inputs, params, { aujourdhui: todayIso(), societe: company.name });
      await persist({
        inputs: { ...res.inputs, devis: form.devis },
        resultat: res,
        pieces_statut: demarches?.pieces_statut ?? {},
        mis_a_jour_le: new Date().toISOString(),
      });
      toast.success('Démarches calculées et enregistrées');
    } catch (err) {
      toast.error(`Échec : ${err.message}`);
    }
  };

  const setStatutPiece = async (code, statut) => {
    try {
      await persist({ ...demarches, pieces_statut: { ...(demarches?.pieces_statut ?? {}), [code]: statut }, mis_a_jour_le: new Date().toISOString() });
    } catch (err) {
      toast.error(`Échec : ${err.message}`);
    }
  };

  const busy = patchBlock.isPending;

  return (
    <div className="card space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <ClipboardList className="w-4 h-4 text-secondary-500" aria-hidden="true" />
        <h2 className="font-semibold text-secondary-900">Démarches administratives</h2>
        <span className="text-xs text-secondary-500">parcours, planning, pièces et frais — page de l’étude PDF</span>
      </div>

      {!dossierSim || !dossier ? (
        <p className="text-sm text-secondary-600 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#B45309]" aria-hidden="true" />
          Enregistrez d&apos;abord la simulation pour renseigner et figer les démarches du projet.
        </p>
      ) : (
        <>
          <DemarchesInputs value={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} prisesEnChargeDefaut={params.prise_en_charge_defaut} disabled={busy} />

          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={calculer} disabled={busy} className="btn-primary flex items-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : resultat ? <RefreshCw className="w-4 h-4" /> : <Calculator className="w-4 h-4" />}
              {resultat ? 'Recalculer et enregistrer' : 'Calculer et enregistrer'}
            </button>
            {resultat && (
              <span className="text-xs text-secondary-500">
                Calculé le {formatDateShortFR(resultat.calcule_le)} · {resultat.inputs.puissance_kwc} kWc · {resultat.inputs.perimetre_abf === 'oui' ? 'périmètre ABF' : resultat.inputs.perimetre_abf === 'non' ? 'hors ABF' : 'ABF inconnu'}
              </span>
            )}
            {perime && (
              <span className="text-xs text-[#7C4A03] inline-flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Les données ont changé depuis ce calcul : recalculez.
              </span>
            )}
          </div>

          {resultat && (
            <>
              <AlertesDemarches alertes={resultat.alertes} />

              <SousTitre Icon={Route}>Le parcours en {resultat.etapes.filter((e) => e.applicable).length} étapes</SousTitre>
              <ParcoursSynoptique etapes={resultat.etapes} />

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div>
                  <SousTitre Icon={CalendarRange}>Planning prévisionnel</SousTitre>
                  <PlanningPrevisionnel planning={resultat.planning} />
                </div>
                <div className="space-y-5">
                  <div>
                    <SousTitre Icon={ListChecks}>Pièces à collecter</SousTitre>
                    <ChecklistPieces pieces={resultat.pieces} statuts={demarches.pieces_statut} onToggle={setStatutPiece} busy={busy} />
                  </div>
                  <div>
                    <SousTitre Icon={Receipt}>Frais administratifs</SousTitre>
                    <TableauFrais frais={resultat.frais} />
                    {resultat.rachat.applicable && resultat.rachat.tarif && (
                      <p className="text-xs text-secondary-500 mt-2">
                        Rachat du surplus : {String(resultat.rachat.tarif.valeur).replace('.', ',')} {resultat.rachat.tarif.unite} (tarif en vigueur au {formatDateShortFR(resultat.rachat.tarif.date_effet)}).
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
