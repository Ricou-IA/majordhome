import { useState, useMemo, useCallback } from 'react';
import { FileText, Download, Loader2, PenTool, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDateFR } from '@/lib/utils';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { contractKeys } from '@/shared/hooks/cacheKeys';
import { useContractEquipments } from '@hooks/useContracts';
import { usePricingData } from '@hooks/usePricing';
import {
  calculateLineTotal,
  calculateContractTotal,
  detectZoneFromPostalCode,
} from '@services/pricing.service';
import { storageService } from '@services/storage.service';
import { supabase } from '@/lib/supabaseClient';
import { generateContractPdfBlob } from '@apps/artisan/components/contrat/ContractPDF';

export function ContractPdfSection({ contract, clientId, client }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  // Charger équipements + pricing pour la génération PDF
  const { equipments } = useContractEquipments(contract?.id);
  const { zones, rates, discounts, equipmentTypes } = usePricingData();

  // Zone tarifaire
  const activeZone = useMemo(() => {
    if (contract?.zone_id && zones?.length) {
      return zones.find((z) => z.id === contract.zone_id) || null;
    }
    if (client?.postal_code && zones?.length) {
      return detectZoneFromPostalCode(client.postal_code, zones);
    }
    return null;
  }, [contract?.zone_id, zones, client?.postal_code]);

  // Index tarifs
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

  // Map equipment types
  const equipTypeMap = useMemo(() => {
    const map = {};
    for (const et of equipmentTypes || []) map[et.id] = et;
    return map;
  }, [equipmentTypes]);

  // Calcul pricing
  const computedPricing = useMemo(() => {
    if (!equipments?.length || !activeZone) return null;
    const grouped = {};
    for (const eq of equipments) {
      const etId = eq.equipment_type_id;
      if (!etId) continue;
      if (!grouped[etId]) grouped[etId] = { equipmentTypeId: etId, quantity: 0 };
      grouped[etId].quantity += 1;
    }
    const items = Object.values(grouped).map((group) => {
      const rate = rateIndex[`${activeZone.id}_${group.equipmentTypeId}`] || null;
      const equipType = equipTypeMap[group.equipmentTypeId] || null;
      const lineTotal = calculateLineTotal(rate, equipType, group.quantity);
      return {
        equipmentTypeId: group.equipmentTypeId,
        label: equipType?.label || '\u00c9quipement',
        quantity: group.quantity,
        basePrice: rate ? parseFloat(rate.price) : 0,
        lineTotal,
      };
    });
    return { items, ...calculateContractTotal(items, discounts) };
  }, [equipments, activeZone, rateIndex, equipTypeMap, discounts]);

  // Générer le PDF (sans signature) et uploader dans Storage
  const handleGenerate = useCallback(async () => {
    if (!contract || isLoading) return;
    setIsLoading(true);
    try {
      const pdfData = {
        contractNumber: contract.contract_number || `CTR-${contract.id?.slice(0, 8)?.toUpperCase()}`,
        startDate: contract.start_date,
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

      const blob = await generateContractPdfBlob(pdfData);
      const storagePath = `${contract.id}.pdf`;
      const { path: uploadedPath, error: uploadError } = await storageService.uploadFile(
        'contracts', storagePath, blob, { upsert: true, contentType: 'application/pdf' }
      );
      if (uploadError) throw uploadError;

      // Update contract_pdf_path en DB
      await supabase
        .from('majordhome_contracts_write')
        .update({ contract_pdf_path: uploadedPath || storagePath, updated_at: new Date().toISOString() })
        .eq('id', contract.id);

      queryClient.invalidateQueries({ queryKey: contractKeys.all });
      toast.success('Contrat PDF généré');
    } catch (err) {
      console.error('[ContractPdfSection] generate error:', err);
      toast.error('Erreur lors de la génération du PDF');
    } finally {
      setIsLoading(false);
    }
  }, [contract, isLoading, client, computedPricing, activeZone, queryClient]);

  // Télécharger le PDF existant
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
        <button
          onClick={hasPdf ? handleDownload : handleGenerate}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50
            border-primary-300 text-primary-700 hover:bg-primary-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {hasPdf ? 'Ouverture...' : 'Génération...'}
            </>
          ) : hasPdf ? (
            <>
              <Download className="w-4 h-4" />
              Télécharger le contrat PDF
            </>
          ) : (
            <>
              <FileText className="w-4 h-4" />
              Générer le contrat PDF
            </>
          )}
        </button>

        {/* Bouton Signer : visible si PDF existe et pas encore signé */}
        {hasPdf && !isSigned && clientId && (
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
