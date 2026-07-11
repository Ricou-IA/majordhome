// src/apps/solaire/components/dossier/DossierDrawer.jsx
// Panneau Dossier PV d'une simulation (depuis l'Historique) : statut, checklist des blocs
// write-once (toiture, cadastre, ABF, matériel, déclarant), validation → génération
// CERFA 16702 pré-rempli + notice descriptive → Storage → documents → advance('dossier_valide').
// Fail-loud : tout échec d'étape stoppe la chaîne AVANT l'avancée de statut, avec toast précis.
import { useState } from 'react';
import { toast } from 'sonner';
import {
  X, FileCheck, Loader2, Check, Minus, AlertTriangle, ShieldAlert, ShieldCheck,
  FileDown, RefreshCw, FolderOpen,
} from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { usePvDossier, usePvDossierMutations } from '@hooks/usePvDossier';
import { pvService } from '@services/pv.service';
import { storageService } from '@services/storage.service';
import { buildCompanyInfo } from '@lib/orgBranding';
import { formatDateFR, formatDateShortFR } from '@lib/utils';
import { logger } from '@lib/logger';
import { buildPvConfig } from '../../lib/pvConfig';
import { downloadBlob } from '../../lib/etudeExport';
import { buildCerfaFields } from '../../lib/cerfa16702';
import { fillCerfa16702 } from '../../lib/fillCerfa';
import { buildNoticeModel, parseAddressFR } from '../../lib/dossierDocs';
import { PV_DOSSIER_STATUS_LABELS } from '../../lib/pvDossierStatus';
import { generateNoticePdfBlob } from './NoticePDF';
import ValidateDossierModal from './ValidateDossierModal';

const DOCS_BUCKET = 'product-documents';

function ChecklistRow({ ok, warn, label, detail }) {
  const Icon = ok ? Check : warn ? AlertTriangle : Minus;
  const color = ok ? 'text-[#1565C0]' : warn ? 'text-[#B45309]' : 'text-secondary-400';
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-secondary-100 last:border-0">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-secondary-900">{label}</p>
        {detail && <p className="text-xs text-secondary-500">{detail}</p>}
      </div>
    </div>
  );
}

export default function DossierDrawer({ open, onClose, simulation }) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { settings } = useOrgSettings();
  const { data: dossier, isLoading } = usePvDossier(open ? simulation?.id : null);
  const { patchBlock, advance } = usePvDossierMutations();
  const [showValidate, setShowValidate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(null);

  if (!open || !simulation) return null;

  const cadastreOk = (dossier?.cadastre?.parcelles?.length ?? 0) > 0;
  const roofOk = Boolean(dossier?.roof_geometry);
  const materialOk = Boolean(dossier?.material?.module_marque || dossier?.material?.module_modele);
  const declarantOk = Boolean(dossier?.declarant?.nom);
  const docs = dossier?.documents ?? null;
  const abf = dossier?.abf ?? null;

  // Génération complète — appelée à la validation (et à la régénération, déclarant déjà connu).
  const generate = async (declarant) => {
    setBusy(true);
    try {
      // 1. Persiste le déclarant (write-once : réutilisé aux régénérations)
      const patched = await patchBlock.mutateAsync({ id: dossier.id, patch: { declarant } });

      // 2. Simulation complète (inputs pas toujours présents dans la ligne de liste)
      const { data: sim, error: simErr } = await pvService.getById(orgId, simulation.id);
      if (simErr || !sim) throw simErr || new Error('Simulation introuvable');

      // 3. Modèle notice + champs CERFA (description partagée)
      const config = buildPvConfig(settings);
      const freshDossier = { ...dossier, ...patched, declarant };
      const noticeModel = buildNoticeModel({ dossier: freshDossier, simulation: sim, config });
      const fields = buildCerfaFields({
        declarant,
        terrain: parseAddressFR(sim.client_address ?? ''),
        parcelles: freshDossier.cadastre?.parcelles ?? [],
        abf: freshDossier.abf,
        description: noticeModel.projet.description,
        todayIso: new Date().toISOString().slice(0, 10),
      });

      // 4. CERFA rempli + notice brandée
      const { blob: cerfaBlob, missedFields } = await fillCerfa16702(fields);
      if (missedFields.length) {
        // Échec partiel surfacé, jamais silencieux — le PDF reste utilisable, à compléter à la main.
        toast.warning(`${missedFields.length} champ(s) CERFA non remplis automatiquement — à vérifier sur le PDF.`);
        logger.warn('[dossier] champs CERFA manqués', missedFields);
      }
      if (fields.overflowParcelles) {
        // 3 slots seulement sur le formulaire — les suivantes exigent la fiche complémentaire papier.
        toast.warning('Le CERFA ne porte que 3 références cadastrales — joindre la fiche complémentaire pour les parcelles restantes (toutes listées dans la notice).');
        logger.warn('[dossier] parcelles au-delà des 3 slots CERFA', freshDossier.cadastre?.parcelles?.length);
      }
      const company = buildCompanyInfo(settings);
      const noticeBlob = await generateNoticePdfBlob({
        model: noticeModel, company, dateLabel: formatDateFR(new Date()),
      });

      // 5. Upload Storage (préfixe orgId obligatoire — policies bucket)
      const base = `${orgId}/solaire/dossiers/${dossier.id}`;
      const up1 = await storageService.uploadFile(DOCS_BUCKET, `${base}/cerfa-dp.pdf`, cerfaBlob, {
        upsert: true, contentType: 'application/pdf',
      });
      if (up1.error) throw new Error(`Upload CERFA : ${up1.error.message}`);
      const up2 = await storageService.uploadFile(DOCS_BUCKET, `${base}/notice-descriptive.pdf`, noticeBlob, {
        upsert: true, contentType: 'application/pdf',
      });
      if (up2.error) throw new Error(`Upload notice : ${up2.error.message}`);

      // 6. Références documents + avancée de statut (idempotent, forward-only)
      await patchBlock.mutateAsync({
        id: dossier.id,
        patch: {
          documents: {
            cerfa_pdf_path: `${base}/cerfa-dp.pdf`,
            notice_pdf_path: `${base}/notice-descriptive.pdf`,
            generated_at: new Date().toISOString(),
          },
        },
      });
      if (dossier.status === 'offre') {
        await advance.mutateAsync({ id: dossier.id, targetStatus: 'dossier_valide' });
      }
      setShowValidate(false);
      toast.success('CERFA + notice générés — dossier validé');
    } catch (err) {
      toast.error(`Génération interrompue : ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const download = async (path, label) => {
    setDownloadBusy(path);
    try {
      const { url, error } = await storageService.getSignedUrl(DOCS_BUCKET, path);
      if (error || !url) throw error || new Error('URL signée introuvable');
      // Pas de window.open post-await : popup bloquée = échec silencieux (iPad terrain).
      // downloadBlob (ancre programmatique) est fiable et tout échec fetch throw → toast.
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      downloadBlob(await res.blob(), path.split('/').pop());
    } catch (err) {
      toast.error(`Téléchargement ${label} impossible : ${err.message}`);
    } finally {
      setDownloadBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-secondary-200 px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FolderOpen className="w-5 h-5 text-secondary-500 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="font-semibold text-secondary-900 truncate">
                Dossier PV — {simulation.client_name || 'Sans nom'}
              </h2>
              {dossier && (
                <span className="inline-flex items-center rounded-full bg-blue-50 text-[#1565C0] text-xs font-medium px-2 py-0.5">
                  {PV_DOSSIER_STATUS_LABELS[dossier.status] ?? dossier.status}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-secondary-400 hover:bg-secondary-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
            </div>
          ) : !dossier ? (
            <div className="text-sm text-secondary-600 bg-secondary-50 rounded-lg px-4 py-6 text-center space-y-1">
              <p className="font-medium text-secondary-800">Aucun dossier pour cette simulation.</p>
              <p className="text-xs">
                Le dossier naît avec l'offre : rechargez la simulation, capturez la parcelle
                cadastrale (étape Localisation) et ré-enregistrez.
              </p>
            </div>
          ) : (
            <>
              {/* Checklist des blocs write-once */}
              <div className="card">
                <h3 className="text-sm font-semibold text-secondary-900 mb-1">Pièces du dossier</h3>
                <ChecklistRow
                  ok={roofOk}
                  label="Géométrie de toiture"
                  detail={
                    dossier.roof_geometry?.pans?.length
                      ? `${dossier.roof_geometry.pans.length} pan(s) cartographié(s) (IGN)`
                      : roofOk ? 'Tracé enregistré' : 'Non capturée (étape Localisation)'
                  }
                />
                <ChecklistRow
                  ok={cadastreOk}
                  warn={!cadastreOk}
                  label="Références cadastrales"
                  detail={
                    cadastreOk
                      ? `${dossier.cadastre.parcelles.map((p) => `${p.section} ${p.numero}`).join(' · ')} — ${dossier.cadastre.nom_com ?? ''}`
                      : 'Requises pour le CERFA — à capturer à l\'étape Localisation'
                  }
                />
                <ChecklistRow
                  ok={Boolean(abf)}
                  warn={!abf}
                  label="Secteur protégé (ABF)"
                  detail={
                    abf
                      ? abf.secteur_protege
                        ? `Protégé : ${abf.protections.map((p) => p.nom).filter(Boolean).join(' · ')}`
                        : 'Aucune protection recensée au GPU'
                      : 'Non vérifié — à contrôler manuellement'
                  }
                />
                <ChecklistRow
                  ok={materialOk}
                  label="Matériel (marque/modèle)"
                  detail={
                    materialOk
                      ? [dossier.material.module_marque, dossier.material.module_modele].filter(Boolean).join(' ')
                      : 'Optionnel — enrichit la notice (étape Résultats)'
                  }
                />
                <ChecklistRow
                  ok={declarantOk}
                  label="État civil du déclarant"
                  detail={declarantOk ? `${dossier.declarant.prenom} ${dossier.declarant.nom}` : 'Complété à la validation'}
                />
              </div>

              {/* Bandeau ABF (rappel visuel) */}
              {abf?.secteur_protege && (
                <div className="flex items-start gap-2 text-sm text-[#B45309] bg-amber-50 border border-[#F5C542] rounded-lg px-3 py-2">
                  <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Secteur protégé — avis ABF probable, délai d'instruction porté à 2 mois.</span>
                </div>
              )}
              {abf && !abf.secteur_protege && (
                <div className="flex items-center gap-2 text-xs text-secondary-500">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  GPU consulté le {formatDateShortFR(abf.checked_at)} — aucune protection recensée.
                </div>
              )}

              {/* Documents générés */}
              {docs?.cerfa_pdf_path && (
                <div className="card space-y-2">
                  <h3 className="text-sm font-semibold text-secondary-900">
                    Documents générés
                    {docs.generated_at && (
                      <span className="font-normal text-xs text-secondary-500"> — {formatDateShortFR(docs.generated_at)}</span>
                    )}
                  </h3>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => download(docs.cerfa_pdf_path, 'CERFA')}
                      disabled={downloadBusy !== null}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-secondary-200 text-sm font-medium text-secondary-700 hover:bg-secondary-50 disabled:opacity-50"
                    >
                      {downloadBusy === docs.cerfa_pdf_path ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                      CERFA 16702
                    </button>
                    <button
                      onClick={() => download(docs.notice_pdf_path, 'notice')}
                      disabled={downloadBusy !== null}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-secondary-200 text-sm font-medium text-secondary-700 hover:bg-secondary-50 disabled:opacity-50"
                    >
                      {downloadBusy === docs.notice_pdf_path ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                      Notice descriptive
                    </button>
                  </div>
                </div>
              )}

              {/* CTA validation / régénération */}
              {!docs?.cerfa_pdf_path ? (
                <button
                  onClick={() => setShowValidate(true)}
                  disabled={!cadastreOk || busy}
                  className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />}
                  Valider le dossier (CERFA + notice)
                </button>
              ) : (
                <button
                  onClick={() => (declarantOk ? generate(dossier.declarant) : setShowValidate(true))}
                  disabled={busy}
                  className="w-full py-2.5 flex items-center justify-center gap-2 rounded-lg border border-secondary-200 text-sm font-medium text-secondary-700 hover:bg-secondary-50 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Régénérer les documents
                </button>
              )}
              {!cadastreOk && !docs?.cerfa_pdf_path && (
                <p className="text-xs text-secondary-500 text-center -mt-2">
                  Les références cadastrales sont requises avant validation.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <ValidateDossierModal
        open={showValidate}
        onClose={() => setShowValidate(false)}
        isSubmitting={busy}
        initialDeclarant={dossier?.declarant ?? null}
        clientName={simulation.client_name}
        terrainAdresse={parseAddressFR(simulation.client_address ?? '')}
        onSubmit={generate}
      />
    </div>
  );
}
