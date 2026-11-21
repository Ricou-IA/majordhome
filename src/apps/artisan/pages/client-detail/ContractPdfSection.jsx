import { useState, useCallback, useRef } from 'react';
import { FileText, Download, Loader2, PenTool, Printer, Upload, CheckCircle2, Send, Mail, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateFR, formatEuro } from '@/lib/utils';
import { toast } from 'sonner';
import { storageService } from '@services/storage.service';
import { contractsService } from '@services/contracts.service';
import { contractKeys } from '@hooks/cacheKeys';
import { useContractProposal } from '@hooks/useContractProposal';
import { generateContractPdfBlob } from '@apps/artisan/components/contrat/ContractPDF';
import { logger } from '@lib/logger';

const ACCEPTED_FILE_TYPES = '.pdf,.jpg,.jpeg,.png';
const MAX_FILE_SIZE_MB = 10;

export function ContractPdfSection({ contract, clientId, client, orgId }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);

  // Chiffrage, données du PDF et envoi de la proposition : une seule définition, partagée avec
  // la fiche d'un chantier (useContractProposal).
  const { company, billableTotal, buildPdfData, envoyerProposition } = useContractProposal({ contract, client, clientId, orgId });

  // Télécharger le PDF signé existant
  const handleDownload = useCallback(async () => {
    if (!contract?.contract_pdf_path || isLoading) return;
    setIsLoading(true);
    try {
      const { url, error } = await storageService.getSignedUrl('contracts', contract.contract_pdf_path);
      if (url) {
        window.open(url, '_blank');
      } else {
        logger.error('[ContractPdfSection] getSignedUrl error:', error);
        toast.error('Impossible de récupérer le PDF');
      }
    } catch (err) {
      logger.error('[ContractPdfSection] download error:', err);
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
      const blob = await generateContractPdfBlob(buildPdfData(), company);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.success('PDF généré — prêt pour impression');
    } catch (err) {
      logger.error('[ContractPdfSection] generate unsigned error:', err);
      toast.error('Erreur lors de la génération du PDF');
    } finally {
      setIsGenerating(false);
    }
  }, [contract, isGenerating, buildPdfData, company]);

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
      // P0.0.7 : préfixe org_id obligatoire (storage RLS filtre sur foldername[1])
      const storagePath = `${orgId}/Contrat_Signe_-_${safeName}.${ext}`;

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

      queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
      toast.success('Contrat signé téléversé avec succès');
    } catch (err) {
      logger.error('[ContractPdfSection] upload signed error:', err);
      // Surfacer la cause : le bucket `contracts` filtre les mime types et la taille
      // (400 « mime type … is not supported » sinon invisible côté UI).
      toast.error(`Erreur lors du téléversement : ${err?.message || 'erreur inconnue'}`);
    } finally {
      setIsUploading(false);
    }
  }, [contract, client, orgId, isUploading, queryClient]);

  // Envoyer la proposition par e-mail (PDF, e-mail, passage en « Proposition envoyée »).
  const handleSendProposal = useCallback(async () => {
    if (!contract || !client?.email || isSending) return;
    setIsSending(true);
    setShowSendConfirm(false);
    try {
      const { envoyeA, marque } = await envoyerProposition();
      if (marque) toast.success(`Proposition envoyée à ${envoyeA}`);
      else toast.warning(`Proposition envoyée à ${envoyeA}, mais le contrat n’a pas pu être marqué « proposition envoyée »`);
    } catch (err) {
      logger.error('[ContractPdfSection] send proposal error:', err);
      toast.error(`Erreur lors de l'envoi : ${err.message || 'Erreur inconnue'}`);
    } finally {
      setIsSending(false);
    }
  }, [contract, client, isSending, envoyerProposition]);

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
                    <span className="font-medium text-gray-900">Montant :</span> {formatEuro(billableTotal)} / an
                  </p>
                </div>
                <p className="text-sm text-gray-500">
                  Un email professionnel sera envoyé avec le contrat en PDF. Le client pourra le consulter directement depuis l&apos;email.
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
