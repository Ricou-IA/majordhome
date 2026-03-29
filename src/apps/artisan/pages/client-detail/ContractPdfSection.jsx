import { useState, useCallback, useMemo, useRef } from 'react';
import { FileText, Download, Loader2, PenTool, Printer, Upload, CheckCircle2 } from 'lucide-react';
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

export function ContractPdfSection({ contract, clientId, client }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

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
      const lineTotal = calculateLineTotal(rate, equipType, 1);
      const refParts = [eq.brand, eq.model, eq.serial_number].filter(Boolean);
      return {
        equipmentTypeId: etId,
        label: equipType?.label || 'Équipement',
        reference: refParts.length > 0 ? refParts.join(' · ') : null,
        quantity: 1,
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
      const MONTHS_FR = [
        '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
        'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
      ];

      const pdfData = {
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
        // Pas de signature
        signatureBase64: null,
        signataireNom: null,
        signedAt: null,
      };

      const blob = await generateContractPdfBlob(pdfData);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Libérer l'URL après un délai (le navigateur a le temps de charger)
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.success('PDF généré — prêt pour impression');
    } catch (err) {
      console.error('[ContractPdfSection] generate unsigned error:', err);
      toast.error('Erreur lors de la génération du PDF');
    } finally {
      setIsGenerating(false);
    }
  }, [contract, client, computedPricing, activeZone, isGenerating]);

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
    </div>
  );
}
