/**
 * ContractSign.jsx - Majord'home Artisan
 * ============================================================================
 * Page plein écran dédiée à la signature du contrat d'entretien sur tablette.
 * Flow : le client valide le résumé + signe → le PDF est généré avec signature.
 *
 * Route : /artisan/clients/:clientId/contrat/signer
 *
 * @version 2.0.0 - Signature d'abord, PDF ensuite + couleurs orange + références
 * ============================================================================
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';

import { useClientContract, useContractEquipments } from '@hooks/useContracts';
import { usePricingData } from '@hooks/usePricing';
import { contractKeys } from '@hooks/cacheKeys';
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

// ============================================================================
// WEBHOOK : Envoi contrat signé par email (fire-and-forget)
// ============================================================================

async function sendContractEmail(contract, client, pdfPath) {
  const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_CONTRACT_PDF;
  if (!webhookUrl) {
    console.warn('[ContractSign] VITE_N8N_WEBHOOK_CONTRACT_PDF non configuré');
    return;
  }
  try {
    const clientName = client?.display_name || [client?.first_name, client?.last_name].filter(Boolean).join(' ') || '';
    const nameParts = clientName.trim().split(/\s+/);

    const payload = {
      contract_id: contract.id,
      pdf_path: pdfPath,
      nom: nameParts.length > 0 ? nameParts[nameParts.length - 1] : '',
      prenom: nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '',
      email: client?.email || '',
      telephone: client?.phone || '',
      adresse: client?.address || '',
      codePostal: client?.postal_code || '',
      ville: client?.city || '',
      estimationTTC: parseFloat(contract.amount) || 0,
      requestType: 'contrat_signe',
      source: 'app',
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Fire-and-forget : on ne bloque pas le flow
    console.error('[ContractSign] sendContractEmail error:', err);
  }
}

// ============================================================================
// COMPOSANT
export default function ContractSign() {
  const { clientId } = useParams();
  const navigate = useNavigate();
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

  // -- Calcul pricing — lignes individuelles par équipement (avec références) --
  const computedPricing = useMemo(() => {
    if (!equipments?.length || !activeZone) return null;

    const items = equipments.map((eq) => {
      const etId = eq.equipment_type_id;
      const rate = etId ? rateIndex[`${activeZone.id}_${etId}`] || null : null;
      const equipType = etId ? equipTypeMap[etId] || null : null;
      const unitCount = eq.unit_count || 1;
      const lineTotal = calculateLineTotal(rate, equipType, unitCount);
      // Référence : "Marque · Modèle · Année · Pose · N splits"
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
        signatureBase64,
        signataireNom: signataireNom.trim(),
        signedAt: new Date().toISOString(),
      };

      // Générer le PDF
      const blob = await generateContractPdfBlob(pdfData);

      // Nom du fichier : "Contrat Entretien - Nom_Prenom.pdf"
      const clientName = client?.display_name || [client?.last_name, client?.first_name].filter(Boolean).join(' ') || 'Client';
      const safeName = clientName.replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').replace(/\s+/g, '_');
      const storagePath = `Contrat_Entretien_-_${safeName}.pdf`;
      const { path: uploadedPath, error: uploadError } = await storageService.uploadFile(
        'contracts',
        storagePath,
        blob,
        { upsert: true, contentType: 'application/pdf' }
      );

      if (uploadError) throw uploadError;

      // Update DB : signature + PDF path
      const { error: dbError } = await contractsService.signContract(
        contract.id,
        signatureBase64,
        signataireNom.trim(),
        uploadedPath || storagePath
      );

      if (dbError) throw dbError;

      // Invalidation cache
      queryClient.invalidateQueries({ queryKey: contractKeys.all });

      toast.success('Contrat signé et PDF généré avec succès');

      // Envoi du contrat par email via webhook N8N (fire-and-forget)
      sendContractEmail(contract, client, uploadedPath || storagePath);

      // Redirection directe vers la fiche client (onglet contrat)
      navigate(`/clients/${clientId}`, { state: { tab: 'contract' } });
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
        <Link to={`/clients/${clientId}`} className="text-sm text-orange-600 hover:underline">
          Retour à la fiche client
        </Link>
      </div>
    );
  }

  // -- Déjà signé → redirection directe vers fiche client --
  if (contract.signed_at) {
    navigate(`/clients/${clientId}`, { replace: true, state: { tab: 'contract' } });
    return null;
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
        {/* Titre contrat — orange Mayer */}
        <div className="bg-[#F97316] text-white px-6 py-4">
          <h2 className="text-lg font-bold">Contrat d’entretien annuel</h2>
          <p className="text-sm text-orange-100">Mayer Énergie — Entretien & Maintenance CVC</p>
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
                <span className="font-medium">{formatDateFR(new Date().toISOString())}</span>
              </div>
              <div>
                <span className="text-gray-500">Mois d’entretien : </span>
                <span className="font-medium">{contract.maintenance_month ? MONTHS_FR[contract.maintenance_month] : '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">Zone tarifaire : </span>
                <span className="font-medium">{activeZone?.label || '-'}</span>
              </div>
            </div>
          </div>

          {/* Équipements — lignes individuelles avec références */}
          {computedPricing && computedPricing.items.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Équipements sous contrat</h3>
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-[#F97316] text-white grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium">
                  <div className="col-span-9">Équipement</div>
                  <div className="col-span-3 text-right">Prix</div>
                </div>
                {computedPricing.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 px-4 py-2.5 text-sm border-t border-gray-100">
                    <div className="col-span-9">
                      <div className="text-gray-800">{item.label}</div>
                      {item.reference && (
                        <div className="text-xs text-gray-400 mt-0.5">{item.reference}</div>
                      )}
                    </div>
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
                <div className="flex justify-between px-4 py-2 bg-orange-50 rounded-lg text-base font-bold text-[#EA580C]">
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
                <strong className="text-gray-700">Durée :</strong> Contrat d’un an, renouvelable par tacite reconduction,
                résiliable avec 30 jours de préavis.
              </p>
              <p>
                <strong className="text-gray-700">Obligations :</strong> Mayer Énergie s’engage à effectuer l’entretien dans les
                règles de l’art et à délivrer une attestation. Le client s’engage à permettre l’accès aux installations.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Zone de signature */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-[#F97316]" />
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
          disclaimerText="En signant, le client accepte les conditions du contrat d’entretien annuel ci-dessus et s’engage au règlement de la prestation selon les modalités convenues."
        />
      </div>

      {/* Bouton Générer */}
      {signatureBase64 && (
        <div className="sticky bottom-4">
          <Button
            onClick={handleGeneratePdf}
            disabled={isSaving || !signataireNom?.trim()}
            className="w-full min-h-[56px] text-lg bg-[#F97316] hover:bg-[#EA580C] text-white shadow-lg"
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
