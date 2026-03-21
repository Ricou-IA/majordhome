import { useState, useCallback } from 'react';
import { FileText, Download, Loader2, PenTool, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDateFR } from '@/lib/utils';
import { toast } from 'sonner';
import { storageService } from '@services/storage.service';

export function ContractPdfSection({ contract, clientId }) {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

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
      </div>
    </div>
  );
}
