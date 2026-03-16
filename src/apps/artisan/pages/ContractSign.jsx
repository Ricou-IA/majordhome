/**
 * ContractSign.jsx - Majord'home Artisan
 * ============================================================================
 * Page plein écran dédiée à la signature du contrat d'entretien sur tablette.
 *
 * Route : /artisan/clients/:clientId/contrat/signer
 *
 * @version 1.0.0 - Signature contrat sur tablette
 * ============================================================================
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle, FileText, Download, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';

import { useClientContract, useContractEquipments } from '@hooks/useContracts';
import { usePricingData } from '@hooks/usePricing';
import { contractKeys } from '@/shared/hooks/cacheKeys';
import { contractsService } from '@services/contracts.service';
import { storageService } from '@services/storage.service';
import {
  calculateLineTotal,
  calculateContractTotal,
  detectZoneFromPostalCode,
} from '@services/pricing.service';
import { formatEuro, formatDateFR } from '@/lib/utils';
import { generateContractPdfBlob } from '../components/contrat/ContractPDF';
import { CertificatSignaturePad } from '../components/certificat/CertificatSignaturePad';
import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// MOIS FR
// ============================================================================

const MONTHS_FR = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

// ============================================================================
// HOOK : Charger le client
// ============================================================================

function useClient(clientId) {
  const [client, setClient] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!clientId) { setIsLoading(false); return; }

    async function load() {
      const { data } = await supabase
        .from('majordhome_clients')
        .select('*')
        .eq('id', clientId)
        .single();
      setClient(data || null);
      setIsLoading(false);
    }

    load();
  }, [clientId]);

  return { client, isLoading };
}

// ============================================================================
// PAGE
// ============================================================================

export default function ContractSign() {
  const { clientId } = useParams();
  const queryClient = useQueryClient();

  // -- Données --
  const { client, isLoading: loadingClient } = useClient(clientId);
  const { contract, isLoading: loadingContract } = useClientContract(clientId);
  const { equipments, isLoading: loadingEquipments } = useContractEquipments(contract?.id);
  const { zones, rates, discounts, equipmentTypes, isLoading: loadingPricing } = usePricingData();

  // -- State --
  const [signatureBase64, setSignatureBase64] = useState(null);
  const [signataireNom, setSignataireNom] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);

  // Pré-remplir le nom du client
  useEffect(() => {
    if (client && !signataireNom) {
      const name = client.display_name || [client.first_name, client.last_name].filter(Boolean).join(' ');
      if (name) setSignataireNom(name);
    }
  }, [client, signataireNom]);

  // -- Zone tarifaire --
  const activeZone = useMemo(() => {
    if (contract?.zone_id && zones?.length) {
      return zones.find((z) => z.id === contract.zone_id) || null;
    }
    if (client?.postal_code && zones?.length) {
      return detectZoneFromPostalCode(client.postal_code, zones);
    }
    return null;
  }, [contract?.zone_id, zones, client?.postal_code]);

  // -- Index tarifs --
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

  // -- Map equipment types --
  const equipTypeMap = useMemo(() => {
    const map = {};
    for (const et of equipmentTypes || []) map[et.id] = et;
    return map;
  }, [equipmentTypes]);

  // -- Calcul pricing --
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
        label: equipType?.label || 'Équipement',
        quantity: group.quantity,
        basePrice: rate ? parseFloat(rate.price) : 0,
        lineTotal,
      };
    });

    const totals = calculateContractTotal(items, discounts);
    return { items, ...totals };
  }, [equipments, activeZone, rateIndex, equipTypeMap, discounts]);

  // -- Signature callback --
  const handleSign = useCallback((dataUrl) => {
    setSignatureBase64(dataUrl);
  }, []);

  const handleClearSignature = useCallback(() => {
    setSignatureBase64(null);
  }, []);

  // -- Générer + uploader le PDF signé --
  const handleGeneratePdf = useCallback(async () => {
    if (!contract || !signatureBase64 || !signataireNom?.trim() || isSaving) return;

    setIsSaving(true);
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
        signatureBase64,
        signataireNom: signataireNom.trim(),
        signedAt: new Date().toISOString(),
      };

      // Générer le PDF
      const blob = await generateContractPdfBlob(pdfData);

      // Upload vers Storage
      const storagePath = `${contract.id}_signed.pdf`;
      const { path: uploadedPath, error: uploadError } = await storageService.uploadFile(
        'contracts',
        storagePath,
        blob,
        { upsert: true, contentType: 'application/pdf' }
      );

      if (uploadError) throw uploadError;

      // Update DB
      const { error: dbError } = await contractsService.signContract(
        contract.id,
        signatureBase64,
        signataireNom.trim(),
        uploadedPath || storagePath
      );

      if (dbError) throw dbError;

      // Obtenir URL signée pour affichage
      const { url } = await storageService.getSignedUrl('contracts', uploadedPath || storagePath);
      if (url) setPdfUrl(url);

      // Invalidation cache
      queryClient.invalidateQueries({ queryKey: contractKeys.all });

      toast.success('Contrat signé et PDF généré avec succès');
    } catch (err) {
      console.error('[ContractSign] Error:', err);
      toast.error('Erreur lors de la génération du contrat signé');
    } finally {
      setIsSaving(false);
    }
  }, [contract, signatureBase64, signataireNom, isSaving, client, computedPricing, activeZone, queryClient]);

  // -- Loading --
  const isLoading = loadingClient || loadingContract || loadingEquipments || loadingPricing;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin mx-auto" />
          <p className="mt-3 text-sm text-secondary-500">Chargement du contrat...</p>
        </div>
      </div>
    );
  }

  // -- Pas de contrat --
  if (!contract) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-6 bg-red-50 border border-red-200 rounded-lg text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
        <p className="text-sm text-red-700">Aucun contrat trouvé pour ce client.</p>
        <Link to={`/clients/${clientId}`} className="text-sm text-blue-600 hover:underline">
          Retour à la fiche client
        </Link>
      </div>
    );
  }

  // -- Déjà signé + PDF dans cette session --
  if (contract.signed_at && pdfUrl) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link to={`/clients/${clientId}`} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Contrat signé</h1>
            <p className="text-sm text-gray-500">{client?.display_name || client?.last_name}</p>
          </div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto" />
          <p className="text-lg font-semibold text-green-800">Contrat signé et PDF généré</p>
          <p className="text-sm text-green-700">
            Signé par {contract.signature_client_nom || signataireNom} le{' '}
            {formatDateFR(contract.signed_at || new Date().toISOString())}
          </p>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors min-h-[48px] text-base"
          >
            <Download className="w-5 h-5" />
            Télécharger le contrat signé
          </a>
        </div>
        <div className="text-center">
          <Link to={`/clients/${clientId}`} className="text-sm text-blue-600 hover:underline">
            Retour à la fiche client
          </Link>
        </div>
      </div>
    );
  }

  // -- PDF vient d'être généré --
  if (pdfUrl) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link to={`/clients/${clientId}`} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Contrat signé</h1>
            <p className="text-sm text-gray-500">{client?.display_name || client?.last_name}</p>
          </div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto" />
          <p className="text-lg font-semibold text-green-800">Contrat signé avec succès</p>
          <p className="text-sm text-green-700">Signé par {signataireNom}</p>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors min-h-[48px] text-base"
          >
            <Download className="w-5 h-5" />
            Télécharger le contrat signé
          </a>
        </div>
        <div className="text-center">
          <Link to={`/clients/${clientId}`} className="text-sm text-blue-600 hover:underline">
            Retour à la fiche client
          </Link>
        </div>
      </div>
    );
  }

  // -- Déjà signé (rechargement page) --
  if (contract.signed_at) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link to={`/clients/${clientId}`} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Contrat déjà signé</h1>
            <p className="text-sm text-gray-500">{client?.display_name || client?.last_name}</p>
          </div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
          <p className="font-semibold text-green-800">Ce contrat a déjà été signé</p>
          <p className="text-sm text-green-700">
            Signé par {contract.signature_client_nom || '-'} le{' '}
            {formatDateFR(contract.signed_at)}
          </p>
          {contract.signature_client_base64 && (
            <img
              src={contract.signature_client_base64}
              alt="Signature client"
              className="max-h-24 mx-auto mt-2"
            />
          )}
        </div>
        <div className="text-center">
          <Link to={`/clients/${clientId}`} className="text-sm text-blue-600 hover:underline">
            Retour à la fiche client
          </Link>
        </div>
      </div>
    );
  }

  // -- Formulaire de signature --
  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={`/clients/${clientId}`} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Signature du contrat</h1>
          <p className="text-sm text-gray-500">
            {client?.display_name || client?.last_name || 'Client'}
          </p>
        </div>
      </div>

      {/* Résumé du contrat */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {/* Titre contrat */}
        <div className="bg-[#1B4F72] text-white px-6 py-4">
          <h2 className="text-lg font-bold">Contrat d'entretien annuel</h2>
          <p className="text-sm text-blue-100">Mayer Énergie — Entretien & Maintenance CVC</p>
        </div>

        <div className="p-6 space-y-6">
          {/* Informations client */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Informations client</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-500">Nom : </span>
                <span className="font-medium">{client?.display_name || [client?.first_name, client?.last_name].filter(Boolean).join(' ') || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">Téléphone : </span>
                <span className="font-medium">{client?.phone || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">Adresse : </span>
                <span className="font-medium">{client?.address || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">Email : </span>
                <span className="font-medium">{client?.email || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">Ville : </span>
                <span className="font-medium">{client?.postal_code} {client?.city}</span>
              </div>
            </div>
          </div>

          {/* Conditions */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Conditions du contrat</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
              <div>
                <span className="text-gray-500">Date de début : </span>
                <span className="font-medium">{contract.start_date ? formatDateFR(contract.start_date) : '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">Mois d'entretien : </span>
                <span className="font-medium">{contract.maintenance_month ? MONTHS_FR[contract.maintenance_month] : '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">Zone tarifaire : </span>
                <span className="font-medium">{activeZone?.label || '-'}</span>
              </div>
            </div>
          </div>

          {/* Équipements */}
          {computedPricing && computedPricing.items.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Équipements sous contrat</h3>
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-[#1B4F72] text-white grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium">
                  <div className="col-span-7">Équipement</div>
                  <div className="col-span-2 text-center">Qté</div>
                  <div className="col-span-3 text-right">Prix</div>
                </div>
                {computedPricing.items.map((item) => (
                  <div key={item.equipmentTypeId} className="grid grid-cols-12 gap-2 px-4 py-2.5 text-sm border-t border-gray-100">
                    <div className="col-span-7 text-gray-800">{item.label}</div>
                    <div className="col-span-2 text-center text-gray-600">{item.quantity}</div>
                    <div className="col-span-3 text-right font-medium">{formatEuro(item.lineTotal)}</div>
                  </div>
                ))}
              </div>

              {/* Totaux */}
              <div className="mt-3 space-y-1">
                {computedPricing.discountPercent > 0 && (
                  <>
                    <div className="flex justify-between text-sm px-4">
                      <span className="text-gray-500">Sous-total</span>
                      <span className="tabular-nums">{formatEuro(computedPricing.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm px-4 text-green-700">
                      <span>Remise -{computedPricing.discountPercent}%</span>
                      <span className="tabular-nums">-{formatEuro(computedPricing.discountAmount)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between px-4 py-2 bg-blue-50 rounded-lg text-base font-bold text-[#1B4F72]">
                  <span>Total annuel TTC</span>
                  <span className="tabular-nums">{formatEuro(computedPricing.total)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          {contract.notes && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Observations</h3>
              <p className="text-sm text-gray-600">{contract.notes}</p>
            </div>
          )}

          {/* Conditions générales */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Conditions générales</h3>
            <div className="text-xs text-gray-500 space-y-2">
              <p>
                <strong className="text-gray-700">Objet :</strong> Entretien annuel des équipements listés ci-dessus,
                conformément aux réglementations en vigueur.
              </p>
              <p>
                <strong className="text-gray-700">Durée :</strong> Contrat d'un an, renouvelable par tacite reconduction,
                résiliable avec 30 jours de préavis.
              </p>
              <p>
                <strong className="text-gray-700">Obligations :</strong> Mayer Énergie s'engage à effectuer l'entretien dans les
                règles de l'art et à délivrer une attestation. Le client s'engage à permettre l'accès aux installations.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Zone de signature */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-[#1B4F72]" />
          Signature du client
        </h3>

        <CertificatSignaturePad
          onSign={handleSign}
          onClear={handleClearSignature}
          signataireNom={signataireNom}
          onSignataireNomChange={setSignataireNom}
          disabled={isSaving}
          isSaving={isSaving}
          existingSignature={signatureBase64}
        />
      </div>

      {/* Bouton Générer */}
      {signatureBase64 && (
        <div className="sticky bottom-4">
          <Button
            onClick={handleGeneratePdf}
            disabled={isSaving || !signataireNom?.trim()}
            className="w-full min-h-[56px] text-lg bg-[#1B4F72] hover:bg-[#154360] text-white shadow-lg"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Génération en cours...
              </>
            ) : (
              <>
                <FileText className="w-5 h-5 mr-2" />
                Générer le contrat signé
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
