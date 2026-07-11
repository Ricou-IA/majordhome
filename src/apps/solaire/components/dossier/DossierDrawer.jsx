// src/apps/solaire/components/dossier/DossierDrawer.jsx
// Panneau Dossier PV d'une simulation (depuis l'Historique) : statut, checklist des blocs
// write-once (toiture, cadastre, ABF, matériel, déclarant), validation → génération
// CERFA 16702 pré-rempli + notice descriptive → Storage → documents → advance('dossier_valide').
// Fail-loud : tout échec d'étape stoppe la chaîne AVANT l'avancée de statut, avec toast précis.
import { useState } from 'react';
import { toast } from 'sonner';
import {
  X, FileCheck, FileSignature, Loader2, Check, Minus, AlertTriangle, ShieldAlert, ShieldCheck,
  FileDown, RefreshCw, FolderOpen,
} from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { usePvDossier, usePvDossierMutations } from '@hooks/usePvDossier';
import { pvService } from '@services/pv.service';
import { pvDossierService } from '@services/pvDossier.service';
import { storageService } from '@services/storage.service';
import { buildCompanyInfo } from '@lib/orgBranding';
import { formatDateFR, formatDateShortFR } from '@lib/utils';
import { logger } from '@lib/logger';
import { buildPvConfig } from '../../lib/pvConfig';
import { downloadBlob } from '../../lib/etudeExport';
import { buildConsentItems } from '../../lib/consentItems';
import { buildCerfaFields } from '../../lib/cerfa16702';
import { fillCerfa16702 } from '../../lib/fillCerfa';
import { buildNoticeModel, parseAddressFR } from '../../lib/dossierDocs';
import { PV_DOSSIER_STATUS_LABELS } from '../../lib/pvDossierStatus';
import { generateNoticePdfBlob } from './NoticePDF';
import ValidateDossierModal from './ValidateDossierModal';
import ConsentSignatureModal from './ConsentSignatureModal';

const DOCS_BUCKET = 'product-documents';

/** data:image/png;base64,… → Blob (upload signature). */
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/:(.*?);/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

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
  const [showConsent, setShowConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(null);

  if (!open || !simulation) return null;

  const cadastreOk = (dossier?.cadastre?.parcelles?.length ?? 0) > 0;
  const roofOk = Boolean(dossier?.roof_geometry);
  const materialOk = Boolean(dossier?.material?.module_marque || dossier?.material?.module_modele);
  // Déclarant COMPLET (pas juste le nom) : le CERFA cadre 1 exige nom+prénom+date+commune de
  // naissance. Sinon la régénération réutiliserait un déclarant partiel (date vide → CERFA incomplet).
  const d = dossier?.declarant;
  const declarantOk = Boolean(d?.nom && d?.prenom && d?.date_naissance && d?.naissance_commune);
  const consent = dossier?.consent ?? null;
  const consentItems = buildConsentItems(buildCompanyInfo(settings).name);
  const consentOk = Boolean(
    consent?.signature_path
    && consentItems.filter((c) => c.required).every((c) => consent.items?.[c.key]?.accepted),
  );
  const docs = dossier?.documents ?? null;
  const abf = dossier?.abf ?? null;

  // Étape 1 — persiste l'état civil du déclarant (sans générer).
  const saveDeclarant = async (declarant) => {
    setBusy(true);
    try {
      await patchBlock.mutateAsync({ id: dossier.id, patch: { declarant } });
      setShowValidate(false);
      toast.success('État civil enregistré');
    } catch (err) {
      toast.error(`Échec : ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Étape 2 — upload de la signature (Storage org-scopé) + persistance du consentement.
  const saveConsent = async (block, dataUrl) => {
    setBusy(true);
    try {
      const path = `${orgId}/solaire/dossiers/${dossier.id}/signature.png`;
      const up = await storageService.uploadFile(DOCS_BUCKET, path, dataUrlToBlob(dataUrl), {
        upsert: true, contentType: 'image/png',
      });
      if (up.error) throw new Error(`Upload signature : ${up.error.message}`);
      await patchBlock.mutateAsync({ id: dossier.id, patch: { consent: { ...block, signature_path: path } } });
      setShowConsent(false);
      toast.success('Consentement & signature enregistrés');
    } catch (err) {
      toast.error(`Échec : ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Étape 3 — génère CERFA + notice depuis les blocs déjà persistés (relit le dossier frais).
  const generate = async () => {
    setBusy(true);
    try {
      const { data: fresh, error: dErr } = await pvDossierService.getBySimulation(orgId, simulation.id);
      if (dErr || !fresh) throw dErr || new Error('Dossier introuvable');
      const { data: sim, error: simErr } = await pvService.getById(orgId, simulation.id);
      if (simErr || !sim) throw simErr || new Error('Simulation introuvable');

      const config = buildPvConfig(settings);
      const declarant = fresh.declarant;
      const cons = fresh.consent;
      const noticeModel = buildNoticeModel({ dossier: fresh, simulation: sim, config });
      // Adresse du terrain : l'adresse saisie ; sinon (GPS) on retombe sur l'adresse du déclarant.
      const terrainParsed = parseAddressFR(sim.client_address ?? '');
      const terrain = terrainParsed.localite ? terrainParsed : (declarant?.adresse ?? terrainParsed);
      const fields = buildCerfaFields({
        declarant,
        terrain,
        parcelles: fresh.cadastre?.parcelles ?? [],
        abf: fresh.abf,
        description: noticeModel.projet.description,
        todayIso: new Date().toISOString().slice(0, 10),
        signedAtIso: cons?.signed_at,
        signatureLieu: cons?.lieu,
      });

      // Octets PNG de la signature (URL signée → fetch), apposés dans le cadre 7.
      // Fail-loud : une signature attendue mais illisible NE DOIT PAS produire un CERFA « validé »
      // sans le tracé manuscrit (document légal défectueux, échec silencieux interdit — Posture #6).
      let signaturePngBytes = null;
      if (cons?.signature_path) {
        const { url, error: sigErr } = await storageService.getSignedUrl(DOCS_BUCKET, cons.signature_path);
        if (sigErr || !url) throw new Error(`Signature illisible : ${sigErr?.message ?? 'URL signée introuvable'}`);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Signature illisible (HTTP ${r.status})`);
        signaturePngBytes = new Uint8Array(await r.arrayBuffer());
      }

      const { blob: cerfaBlob, missedFields } = await fillCerfa16702(fields, { signaturePngBytes });
      if (missedFields.length) {
        toast.warning(`${missedFields.length} champ(s) CERFA non remplis automatiquement — à vérifier sur le PDF.`);
        logger.warn('[dossier] champs CERFA manqués', missedFields);
      }
      if (fields.overflowParcelles) {
        toast.warning('Le CERFA ne porte que 3 références cadastrales — joindre la fiche complémentaire pour les parcelles restantes (toutes listées dans la notice).');
        logger.warn('[dossier] parcelles au-delà des 3 slots CERFA', fresh.cadastre?.parcelles?.length);
      }
      const company = buildCompanyInfo(settings);
      const noticeBlob = await generateNoticePdfBlob({ model: noticeModel, company, dateLabel: formatDateFR(new Date()) });

      const base = `${orgId}/solaire/dossiers/${dossier.id}`;
      const up1 = await storageService.uploadFile(DOCS_BUCKET, `${base}/cerfa-dp.pdf`, cerfaBlob, { upsert: true, contentType: 'application/pdf' });
      if (up1.error) throw new Error(`Upload CERFA : ${up1.error.message}`);
      const up2 = await storageService.uploadFile(DOCS_BUCKET, `${base}/notice-descriptive.pdf`, noticeBlob, { upsert: true, contentType: 'application/pdf' });
      if (up2.error) throw new Error(`Upload notice : ${up2.error.message}`);

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
                <ChecklistRow
                  ok={consentOk}
                  label="Consentement & signature"
                  detail={consentOk
                    ? `Signé par ${consent.signataire_nom} — ${formatDateShortFR(consent.signed_at)}`
                    : 'Recueilli sur la tablette avec le client'}
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

              {/* Étapes séquentielles : état civil → consentement+signature → génération */}
              {!docs?.cerfa_pdf_path ? (
                <div className="space-y-2">
                  {!declarantOk && (
                    <button
                      onClick={() => setShowValidate(true)}
                      disabled={!cadastreOk || busy}
                      className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <FileCheck className="w-4 h-4" /> Compléter l'état civil du déclarant
                    </button>
                  )}
                  {declarantOk && !consentOk && (
                    <button
                      onClick={() => setShowConsent(true)}
                      disabled={busy}
                      className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <FileSignature className="w-4 h-4" /> Recueillir le consentement & la signature
                    </button>
                  )}
                  {declarantOk && consentOk && (
                    <button
                      onClick={generate}
                      disabled={!cadastreOk || busy}
                      className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />}
                      Générer le CERFA + la notice
                    </button>
                  )}
                  {!cadastreOk && (
                    <p className="text-xs text-secondary-500 text-center">
                      Les références cadastrales sont requises (étape Localisation).
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => {
                    // Route vers l'étape manquante (déclarant → consentement → génération), même
                    // quand des documents existent déjà (rows legacy ou nouvel item de consentement).
                    if (!declarantOk) setShowValidate(true);
                    else if (!consentOk) setShowConsent(true);
                    else generate();
                  }}
                  disabled={busy}
                  className="w-full py-2.5 flex items-center justify-center gap-2 rounded-lg border border-secondary-200 text-sm font-medium text-secondary-700 hover:bg-secondary-50 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Régénérer les documents
                </button>
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
        onSubmit={saveDeclarant}
      />

      <ConsentSignatureModal
        open={showConsent}
        onClose={() => setShowConsent(false)}
        isSubmitting={busy}
        consentItems={consentItems}
        initialConsent={consent}
        signataireDefaut={dossier?.declarant ? `${dossier.declarant.prenom} ${dossier.declarant.nom}` : (simulation.client_name || '')}
        lieuDefaut={parseAddressFR(simulation.client_address ?? '').localite}
        onSubmit={saveConsent}
      />
    </div>
  );
}
