import { useState, useCallback, useMemo, useRef } from 'react';
import { FileText, Download, Loader2, PenTool, Printer, Upload, CheckCircle2, Send, Mail, X } from 'lucide-react';
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

export function ContractPdfSection({ contract, clientId, client, orgId }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  // Envoyer la proposition par email via N8N/Resend
  const handleSendProposal = useCallback(async () => {
    if (!contract || !client?.email || isSending) return;
    setIsSending(true);
    setShowSendConfirm(false);
    try {
      // 1. Générer le PDF
      const pdfData = buildPdfData();
      const blob = await generateContractPdfBlob(pdfData);

      // 2. Upload vers Supabase Storage (nom simple = contract number only)
      const contractNum = contract.contract_number || `CTR-${contract.id?.slice(0, 8)?.toUpperCase()}`;
      const storagePath = `Proposition_${contractNum}.pdf`;

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
        org_id: orgId,
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

      // 7. Passer le contrat en "proposal_sent" si encore pending
      if (contract.status === 'pending') {
        await contractsService.updateContract(contract.id, { status: 'proposal_sent' });
        queryClient.invalidateQueries({ queryKey: contractKeys.all });
      }

      toast.success(`Proposition envoyée à ${client.email}`);
    } catch (err) {
      console.error('[ContractPdfSection] send proposal error:', err);
      toast.error(`Erreur lors de l'envoi : ${err.message || 'Erreur inconnue'}`);
    } finally {
      setIsSending(false);
    }
  }, [contract, client, clientId, orgId, computedPricing, isSending, buildPdfData, queryClient]);

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
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
<!-- HEADER : logo Mayer -->
<tr><td style="background-color:#ffffff;padding:30px 40px 0 40px;text-align:center;">
<img src="https://www.mayer-energie.fr/images/logo-email.png" alt="Mayer Energie" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;" />
</td></tr>
<!-- Bande bleue -->
<tr><td style="background-color:#1E4D8C;padding:12px 40px;text-align:center;">
<p style="color:#ffffff;margin:0;font-size:14px;">Votre confort, toute l'ann\u00e9e</p>
</td></tr>
<!-- Corps -->
<tr><td style="padding:30px 40px;color:#333333;font-size:15px;line-height:1.7;text-align:justify;">
<p style="margin:0 0 20px 0;">{{SALUTATION}}</p>
<p style="margin:0 0 20px 0;font-size:17px;"><strong>Prenez soin de vos \u00e9quipements, on s'occupe du reste.</strong></p>
<p style="margin:0 0 20px 0;">Nous vous avons pr\u00e9par\u00e9 une proposition de contrat d'entretien adapt\u00e9e \u00e0 votre installation. En quelques mots, voici ce que cela vous apporte\u00a0:</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udd27 Un entretien annuel par nos techniciens</strong></p>
<p style="margin:0 0 20px 0;">Ludovic et Antoine, plus de 15 ans d'exp\u00e9rience chacun, se d\u00e9placent chez vous pour v\u00e9rifier, nettoyer et optimiser vos \u00e9quipements. Un rendez-vous simple, planifi\u00e9 avec vous.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\u2705 La tranquillit\u00e9 toute l'ann\u00e9e</strong></p>
<p style="margin:0 0 20px 0;">Un \u00e9quipement bien entretenu, c'est moins de pannes, une meilleure performance \u00e9nerg\u00e9tique et une dur\u00e9e de vie prolong\u00e9e. C'est aussi la conformit\u00e9 r\u00e9glementaire de votre installation.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83c\udfe0 Un interlocuteur de proximit\u00e9 pour tous vos besoins</strong></p>
<p style="margin:0 0 20px 0;">Bas\u00e9s \u00e0 Gaillac, nous intervenons rapidement sur votre secteur. Au-del\u00e0 de l'entretien, notre \u00e9quipe est \u00e0 votre \u00e9coute pour tous vos projets\u00a0: chauffage, climatisation, \u00e9lectricit\u00e9, \u00e9nergies renouvelables. Un seul num\u00e9ro, une \u00e9quipe qui vous conna\u00eet.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83c\udf81 Des avantages r\u00e9serv\u00e9s \u00e0 nos clients</strong></p>
<p style="margin:0 0 20px 0;">En rejoignant Mayer Energie, vous acc\u00e9dez \u00e0 des <strong>offres sp\u00e9ciales et tarifs pr\u00e9f\u00e9rentiels</strong> sur nos prestations et \u00e9quipements. Nos clients sont notre priorit\u00e9\u00a0: nous vous accompagnons dans la dur\u00e9e.</p>
<!-- Récap équipement -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px 0;">
<tr><td style="background-color:#f0f7ff;border:1px solid #d0e3f7;border-radius:6px;padding:16px 20px;">
<p style="font-size:12px;color:#1E4D8C;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px 0;">Votre \u00e9quipement</p>
<p style="font-size:15px;color:#333333;font-weight:600;margin:0 0 10px 0;">${equipRecap}</p>
<p style="border-top:1px solid #d0e3f7;padding-top:10px;margin:0;">
<span style="font-size:13px;color:#666666;">Montant annuel TTC</span><br/>
<span style="font-size:22px;font-weight:bold;color:#1E4D8C;">${totalStr}</span>
</p>
</td></tr>
</table>
<!-- CTA -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:10px 0 25px 0;">
<a href="${pdfUrl}" target="_blank" style="display:inline-block;background-color:#f97316;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:6px;">Consulter ma proposition</a>
</td></tr></table>
<p style="margin:0 0 20px 0;">Pour toute question ou pour souscrire, n'h\u00e9sitez pas \u00e0 nous appeler ou \u00e0 r\u00e9pondre directement \u00e0 cet email. Nous serons ravis d'\u00e9changer avec vous.</p>
<p style="margin:25px 0 5px 0;">\u00c0 tr\u00e8s bient\u00f4t,</p>
<p style="margin:0 0 5px 0;"><strong>L'\u00e9quipe Mayer Energie</strong></p>
</td></tr>
<!-- Footer -->
<tr><td style="background-color:#f8f9fa;padding:20px 40px;text-align:center;font-size:13px;color:#666666;border-top:1px solid #e9ecef;">
<p style="margin:0 0 5px 0;">\ud83d\udcde <a href="tel:+33563332314" style="color:#1E4D8C;text-decoration:none;">05 63 33 23 14</a></p>
<p style="margin:0 0 5px 0;">\ud83d\udce7 <a href="mailto:contact@mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">contact@mayer-energie.fr</a></p>
<p style="margin:0 0 5px 0;">\ud83c\udf10 <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">www.mayer-energie.fr</a></p>
<p style="margin:10px 0 0 0;color:#999999;font-size:11px;">26 Route des Pyr\u00e9n\u00e9es \u2013 81600 Gaillac</p>
<p style="margin:12px 0 0 0;color:#bbbbbb;font-size:10px;">Si vous ne souhaitez plus recevoir nos communications, <a href="mailto:contact@mayer-energie.fr?subject=D\u00e9sabonnement" style="color:#bbbbbb;text-decoration:underline;">cliquez ici pour vous d\u00e9sabonner</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
