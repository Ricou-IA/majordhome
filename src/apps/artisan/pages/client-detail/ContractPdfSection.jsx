import { useState, useCallback, useMemo, useRef } from 'react';
import { FileText, Download, Loader2, PenTool, Printer, Upload, CheckCircle2, Send, Mail, X } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateFR, formatEuro } from '@/lib/utils';
import { toast } from 'sonner';
import { storageService } from '@services/storage.service';
import { contractsService } from '@services/contracts.service';
import { contractKeys } from '@hooks/cacheKeys';
import { useContractEquipments } from '@hooks/useContracts';
import { usePricingData } from '@hooks/usePricing';
import {
  calculateLineTotal,
  calculateContractTotal,
  detectZoneFromPostalCode,
} from '@services/pricing.service';
import { generateContractPdfBlob } from '@apps/artisan/components/contrat/ContractPDF';

const ACCEPTED_FILE_TYPES = '.pdf,.jpg,.jpeg,.png';
const MAX_FILE_SIZE_MB = 10;
const N8N_WEBHOOK_URL = import.meta.env.VITE_N8N_WEBHOOK_MAILING;

export function ContractPdfSection({ contract, clientId, client }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const fileInputRef = useRef(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);

  // Données pour la génération PDF sans signature
  const { equipments } = useContractEquipments(contract?.id);
  const { zones, rates, discounts, equipmentTypes } = usePricingData();

  const activeZone = useMemo(() => {
    if (contract?.zone_id && zones?.length) {
      return zones.find((z) => z.id === contract.zone_id) || null;
    }
    if (client?.postal_code && zones?.length) {
      return detectZoneFromPostalCode(client.postal_code, zones);
    }
    return null;
  }, [contract?.zone_id, zones, client?.postal_code]);

  const rateIndex = useMemo(() => {
    if (!rates) return {};
    const idx = {};
    for (const r of rates) {
      const zId = r.zone_id || r.zone?.id;
      const etId = r.equipment_type_id || r.equipment_type?.id;
      if (zId && etId) idx[`${zId}_${etId}`] = r;
    }
    return idx;
  }, [rates]);

  const equipTypeMap = useMemo(() => {
    const map = {};
    for (const et of equipmentTypes || []) map[et.id] = et;
    return map;
  }, [equipmentTypes]);

  const computedPricing = useMemo(() => {
    if (!equipments?.length || !activeZone) return null;
    const items = equipments.map((eq) => {
      const etId = eq.equipment_type_id;
      const rate = etId ? rateIndex[`${activeZone.id}_${etId}`] || null : null;
      const equipType = etId ? equipTypeMap[etId] || null : null;
      const unitCount = eq.unit_count || 1;
      const lineTotal = calculateLineTotal(rate, equipType, unitCount);
      const refParts = [
        eq.brand,
        eq.model,
        eq.installation_year,
        eq.installation_type === 'ventouse' ? 'Pose ventouse' : eq.installation_type === 'verticale' ? 'Pose verticale' : null,
        unitCount > 1 && equipType?.unit_label ? `${unitCount} ${equipType.unit_label}s` : null,
      ].filter(Boolean);
      return {
        equipmentTypeId: etId,
        label: equipType?.label || 'Équipement',
        reference: refParts.length > 0 ? refParts.join(' · ') : null,
        quantity: unitCount,
        basePrice: rate ? parseFloat(rate.price) : 0,
        lineTotal,
      };
    });
    const totals = calculateContractTotal(items, discounts);
    return { items, ...totals };
  }, [equipments, activeZone, rateIndex, equipTypeMap, discounts]);

  // Télécharger le PDF signé existant
  const handleDownload = useCallback(async () => {
    if (!contract?.contract_pdf_path || isLoading) return;
    setIsLoading(true);
    try {
      const { url, error } = await storageService.getSignedUrl('contracts', contract.contract_pdf_path);
      if (url) {
        window.open(url, '_blank');
      } else {
        console.error('[ContractPdfSection] getSignedUrl error:', error);
        toast.error('Impossible de récupérer le PDF');
      }
    } catch (err) {
      console.error('[ContractPdfSection] download error:', err);
      toast.error('Erreur PDF');
    } finally {
      setIsLoading(false);
    }
  }, [contract, isLoading]);

  // Générer le PDF sans signature (pour impression papier)
  const handleGenerateUnsigned = useCallback(async () => {
    if (!contract || isGenerating) return;
    setIsGenerating(true);
    try {
      const blob = await generateContractPdfBlob(buildPdfData());
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.success('PDF généré — prêt pour impression');
    } catch (err) {
      console.error('[ContractPdfSection] generate unsigned error:', err);
      toast.error('Erreur lors de la génération du PDF');
    } finally {
      setIsGenerating(false);
    }
  }, [contract, isGenerating, buildPdfData]);

  // Upload du contrat signé papier (scan/photo)
  const handleUploadSigned = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !contract || isUploading) return;
    // Reset input pour permettre de re-sélectionner le même fichier
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Validation taille
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast.error(`Le fichier dépasse ${MAX_FILE_SIZE_MB} Mo`);
      return;
    }

    setIsUploading(true);
    try {
      const clientName = client?.display_name || [client?.last_name, client?.first_name].filter(Boolean).join(' ') || 'Client';
      const safeName = clientName.replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').replace(/\s+/g, '_');
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
      const storagePath = `Contrat_Signe_-_${safeName}.${ext}`;

      const { path: uploadedPath, error: uploadError } = await storageService.uploadFile(
        'contracts',
        storagePath,
        file,
        { upsert: true, contentType: file.type }
      );

      if (uploadError) throw uploadError;

      // Mettre à jour le contrat en DB (signed_at + pdf_path)
      const { error: dbError } = await contractsService.uploadSignedContract(
        contract.id,
        uploadedPath || storagePath
      );

      if (dbError) throw dbError;

      queryClient.invalidateQueries({ queryKey: contractKeys.all });
      toast.success('Contrat signé téléversé avec succès');
    } catch (err) {
      console.error('[ContractPdfSection] upload signed error:', err);
      toast.error('Erreur lors du téléversement');
    } finally {
      setIsUploading(false);
    }
  }, [contract, client, isUploading, queryClient]);

  // Helper : construire les données PDF (réutilisé par impression + envoi)
  const buildPdfData = useCallback(() => {
    return {
      contractNumber: contract.contract_number || `CTR-${contract.id?.slice(0, 8)?.toUpperCase()}`,
      startDate: new Date().toISOString(),
      maintenanceMonth: contract.maintenance_month,
      clientName: client?.display_name || [client?.first_name, client?.last_name].filter(Boolean).join(' ') || '-',
      clientAddress: client?.address || '-',
      clientPostalCode: client?.postal_code || '',
      clientCity: client?.city || '',
      clientPhone: client?.phone || '-',
      clientEmail: client?.email || '-',
      equipmentLines: computedPricing?.items || [],
      subtotal: computedPricing?.subtotal || 0,
      discountPercent: computedPricing?.discountPercent || 0,
      discountAmount: computedPricing?.discountAmount || 0,
      total: computedPricing?.total || parseFloat(contract.amount) || 0,
      zoneName: activeZone?.label || '-',
      notes: contract.notes || null,
      signatureBase64: null,
      signataireNom: null,
      signedAt: null,
    };
  }, [contract, client, computedPricing, activeZone]);

  // Envoyer la proposition par email via N8N/Resend
  const handleSendProposal = useCallback(async () => {
    if (!contract || !client?.email || isSending) return;
    setIsSending(true);
    setShowSendConfirm(false);
    try {
      // 1. Générer le PDF
      const pdfData = buildPdfData();
      const blob = await generateContractPdfBlob(pdfData);

      // 2. Upload vers Supabase Storage
      const contractNum = contract.contract_number || `CTR-${contract.id?.slice(0, 8)?.toUpperCase()}`;
      const safeName = (client.display_name || client.last_name || 'Client').replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').replace(/\s+/g, '_');
      const storagePath = `propositions/Proposition_${contractNum}_${safeName}.pdf`;

      const { path: uploadedPath, error: uploadError } = await storageService.uploadFile(
        'contracts',
        storagePath,
        blob,
        { upsert: true, contentType: 'application/pdf' }
      );
      if (uploadError) throw uploadError;

      // 3. URL signée 7 jours
      const { url: pdfUrl, error: urlError } = await storageService.getSignedUrl(
        'contracts',
        uploadedPath || storagePath,
        604800
      );
      if (urlError || !pdfUrl) throw urlError || new Error('Impossible de générer le lien PDF');

      // 4. Construire le récap équipements pour l'email
      const equipRecap = (computedPricing?.items || [])
        .map(item => `${item.label}${item.reference ? ` (${item.reference})` : ''}`)
        .join(', ') || 'Vos équipements';
      const totalStr = formatEuro(computedPricing?.total || parseFloat(contract.amount) || 0);

      // 5. Template HTML email
      const htmlBody = buildProposalEmailHtml(pdfUrl, equipRecap, totalStr);

      // 6. Appel webhook N8N
      if (!N8N_WEBHOOK_URL) throw new Error('Variable VITE_N8N_WEBHOOK_MAILING non configurée');

      const payload = {
        subject: `Votre proposition de contrat d'entretien — Mayer Énergie`,
        html_body: htmlBody,
        segment_sql: `SELECT id, first_name, last_name, display_name, email FROM majordhome.clients WHERE id = '${clientId}' AND email IS NOT NULL AND email_unsubscribed_at IS NULL LIMIT 1;`,
        campaign_name: 'Proposition Contrat',
        org_id: organization?.id,
        recipient_type: 'client',
        batch_size: 1,
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        await fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (err) {
        if (err.name !== 'AbortError') throw err;
        // Timeout = normal, N8N continue en arrière-plan
      } finally {
        clearTimeout(timeout);
      }

      toast.success(`Proposition envoyée à ${client.email}`);
    } catch (err) {
      console.error('[ContractPdfSection] send proposal error:', err);
      toast.error(`Erreur lors de l'envoi : ${err.message || 'Erreur inconnue'}`);
    } finally {
      setIsSending(false);
    }
  }, [contract, client, clientId, organization, computedPricing, isSending, buildPdfData]);

  const isSigned = !!contract.signed_at;
  const hasPdf = !!contract.contract_pdf_path;

  return (
    <div className="pt-6 border-t border-secondary-200">
      <h4 className="text-sm font-semibold text-secondary-900 mb-3 flex items-center gap-2">
        <FileText className="w-4 h-4 text-secondary-500" />
        Contrat PDF
        {isSigned && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 border border-green-200 rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            Signé le {formatDateFR(contract.signed_at)}
            {contract.signature_client_nom && ` par ${contract.signature_client_nom}`}
          </span>
        )}
      </h4>
      <div className="flex items-center gap-3 flex-wrap">
        {/* Si signé : bouton télécharger le PDF signé */}
        {isSigned && hasPdf && (
          <button
            onClick={handleDownload}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50
              border-primary-300 text-primary-700 hover:bg-primary-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Ouverture...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Télécharger le contrat signé
              </>
            )}
          </button>
        )}

        {/* Si pas signé : bouton signer le contrat */}
        {!isSigned && clientId && (
          <button
            onClick={() => navigate(`/clients/${clientId}/contrat/signer`)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors
              border-green-300 text-green-700 hover:bg-green-50 bg-green-50"
          >
            <PenTool className="w-4 h-4" />
            Signer le contrat
          </button>
        )}

        {/* Générer le PDF sans signature (impression papier) — masqué si déjà signé */}
        {!isSigned && clientId && (
          <button
            onClick={handleGenerateUnsigned}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50
              border-secondary-300 text-secondary-700 hover:bg-secondary-50"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Génération...
              </>
            ) : (
              <>
                <Printer className="w-4 h-4" />
                Imprimer le contrat
              </>
            )}
          </button>
        )}

        {/* Envoyer la proposition par email */}
        {!isSigned && clientId && client?.email && (
          <button
            onClick={() => setShowSendConfirm(true)}
            disabled={isSending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50
              border-blue-300 text-blue-700 hover:bg-blue-50 bg-blue-50"
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Envoi en cours...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Envoyer la proposition
              </>
            )}
          </button>
        )}

        {/* Upload contrat signé papier */}
        {!isSigned && clientId && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              onChange={handleUploadSigned}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50
                border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Téléversement...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Téléverser le contrat signé
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* Modale de confirmation envoi proposition */}
      {showSendConfirm && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowSendConfirm(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Mail className="w-5 h-5 text-blue-600" />
                  Envoyer la proposition
                </h3>
                <button onClick={() => setShowSendConfirm(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 mb-6">
                <div className="p-3 bg-gray-50 rounded-lg text-sm space-y-1">
                  <p className="text-gray-600">
                    <span className="font-medium text-gray-900">Destinataire :</span> {client?.email}
                  </p>
                  <p className="text-gray-600">
                    <span className="font-medium text-gray-900">Client :</span> {client?.display_name || [client?.first_name, client?.last_name].filter(Boolean).join(' ')}
                  </p>
                  <p className="text-gray-600">
                    <span className="font-medium text-gray-900">Montant :</span> {formatEuro(computedPricing?.total || parseFloat(contract.amount) || 0)} / an
                  </p>
                </div>
                <p className="text-sm text-gray-500">
                  Un email professionnel sera envoyé avec le contrat en PDF. Le client pourra le consulter directement depuis l'email.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setShowSendConfirm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSendProposal}
                  disabled={isSending}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Envoyer
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// TEMPLATE HTML EMAIL — PROPOSITION CONTRAT D'ENTRETIEN
// ============================================================================

function buildProposalEmailHtml(pdfUrl, equipRecap, totalStr) {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">

  <!-- Header orange -->
  <tr><td style="background:linear-gradient(135deg,#E8792B,#d4691e);padding:32px 40px;text-align:center;">
    <img src="https://www.mayer-energie.fr/wp-content/uploads/2024/11/logo-mayer-energie-blanc.png" alt="Mayer Énergie" width="180" style="display:block;margin:0 auto 12px;">
    <p style="color:rgba(255,255,255,0.9);font-size:14px;margin:0;">Chauffage, Climatisation & Énergies Renouvelables</p>
  </td></tr>

  <!-- Corps -->
  <tr><td style="padding:40px;">
    <p style="font-size:16px;color:#1a1a2e;margin:0 0 24px;">{{SALUTATION}}</p>

    <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 16px;">
      Nous avons le plaisir de vous transmettre <strong>votre proposition de contrat d'entretien</strong> pour vos équipements.
    </p>

    <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 24px;">
      En souscrivant à ce contrat, vous bénéficiez d'une <strong>visite annuelle complète</strong> par nos techniciens qualifiés.
      C'est l'assurance d'un fonctionnement optimal, d'économies d'énergie et de la conformité réglementaire de votre installation.
    </p>

    <!-- Récap -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef7f0;border:1px solid #fed7aa;border-radius:8px;margin:0 0 28px;">
      <tr><td style="padding:20px;">
        <p style="font-size:13px;color:#9a3412;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px;">Votre équipement</p>
        <p style="font-size:15px;color:#1a1a2e;font-weight:600;margin:0 0 12px;">${equipRecap}</p>
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="border-top:1px solid #fed7aa;padding-top:12px;">
            <p style="font-size:13px;color:#78716c;margin:0;">Montant annuel TTC</p>
            <p style="font-size:24px;font-weight:700;color:#E8792B;margin:4px 0 0;">${totalStr}</p>
          </td>
        </tr></table>
      </td></tr>
    </table>

    <!-- CTA -->
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 0 28px;">
      <a href="${pdfUrl}" target="_blank" style="display:inline-block;background:#E8792B;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;">
        Consulter ma proposition
      </a>
    </td></tr></table>

    <p style="font-size:14px;color:#6b7280;line-height:1.6;margin:0 0 8px;">
      Pour toute question ou pour souscrire, n'hésitez pas à nous contacter. Notre équipe se tient à votre disposition.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 40px;">
    <p style="font-size:13px;color:#6b7280;margin:0 0 4px;font-weight:600;">Mayer Énergie</p>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 2px;">26 Rue des Pyrénées — 81600 Gaillac</p>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 2px;">Tél : 05 63 33 23 14 — contact@mayer-energie.fr</p>
    <p style="font-size:11px;color:#d1d5db;margin:12px 0 0;">
      <a href="mailto:contact@mayer-energie.fr?subject=Désabonnement" style="color:#d1d5db;">Se désabonner</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
