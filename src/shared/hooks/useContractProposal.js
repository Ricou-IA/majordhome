/**
 * useContractProposal.js — chiffrer, imprimer et ENVOYER la proposition d'un contrat d'entretien.
 * ============================================================================
 * Seule définition des données du PDF d'un contrat non signé et de l'envoi de la proposition
 * au client (PDF archivé, e-mail `proposition_contrat`, contrat passé en « Proposition
 * envoyée »). Utilisée par la fiche client (`ContractPdfSection`) et par la fiche d'un
 * chantier (`EnvoiPropositionContrat`, envoi dès la création). Ne jamais recopier l'envoi.
 *
 * `pret` : toutes les données du chiffrage sont chargées. Envoyer avant donnerait un PDF sans
 * lignes d'équipement ; un envoi automatique doit l'attendre.
 * ============================================================================
 */

import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { storageService } from '@services/storage.service';
import { contractsService } from '@services/contracts.service';
import { mailCampaignsService } from '@services/mailCampaigns.service';
import { calculateLineTotal, calculateContractTotal, buildContractPresentation } from '@services/pricing.service';
import { contractKeys } from '@hooks/cacheKeys';
import { useContractEquipments } from '@hooks/useContracts';
import { usePricingData, useContractLineOverrides } from '@hooks/usePricing';
import { useContractZone } from '@hooks/useContractZone';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { formatEuro } from '@/lib/utils';
import { logger } from '@lib/logger';

/**
 * @param {{ contract: Object|null|undefined, client: Object|null|undefined, clientId: string, orgId: string }} p
 * @returns {{
 *   company: Object, computedPricing: Object|null, billableTotal: number, buildPdfData: () => Object,
 *   pret: boolean, envoyerProposition: () => Promise<{ envoyeA: string, marque: boolean }>,
 * }}
 */
export function useContractProposal({ contract, client, clientId, orgId }) {
  const queryClient = useQueryClient();
  const { settings } = useOrgSettings();
  const company = useMemo(() => buildCompanyInfo(settings), [settings]);

  const { equipments, isLoading: equipementsEnChargement } = useContractEquipments(contract?.id);
  const { zones, rates, discounts, equipmentTypes, isLoading: tarifsEnChargement } = usePricingData();
  const { overrides, isLoading: forcagesEnChargement } = useContractLineOverrides(contract?.id);

  // Zone tarifaire : stockée → Mapbox (temps trajet) → fallback CP dept → défaut
  const { activeZone, isDetecting } = useContractZone(client, contract, zones);

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

  const zoneSupplement = parseFloat(activeZone?.supplement || 0);

  const computedPricing = useMemo(() => {
    if (!equipments?.length || !activeZone) return null;
    const items = equipments.map((eq) => {
      const etId = eq.equipment_type_id;
      const rate = etId ? rateIndex[`${activeZone.id}_${etId}`] || null : null;
      const equipType = etId ? equipTypeMap[etId] || null : null;
      const unitCount = eq.unit_count || 1;
      // Prix forcé par ligne (override) → substitue le prix grille ; dégressivité appliquée en aval.
      const ov = overrides?.[eq.id];
      const lineTotal = ov != null ? ov : calculateLineTotal(rate, equipType, unitCount, zoneSupplement);
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
    const totals = calculateContractTotal(items, discounts, contract?.exceptional_discount);
    return { items, ...totals };
  }, [equipments, activeZone, rateIndex, equipTypeMap, discounts, zoneSupplement, overrides, contract?.exceptional_discount]);

  // Montant facturable : priorité au montant forcé (admin), sinon calculé, sinon DB
  const billableTotal = useMemo(() => {
    const forcedAmount = contract?.amount_forced ? parseFloat(contract.amount) : null;
    if (forcedAmount != null && !isNaN(forcedAmount)) return forcedAmount;
    return computedPricing?.total || parseFloat(contract?.amount) || 0;
  }, [contract, computedPricing]);

  // Données du PDF (impression + envoi). La présentation tarifaire (lignes + remises) est
  // dérivée du montant facturé via buildContractPresentation : montant forcé (à la baisse comme
  // à la hausse) → prix d'articles ramenés au prorata, aucune remise affichée (le montant forcé
  // est le prix, Eric 2026-11-16). La somme des lignes retombe toujours sur le total.
  const buildPdfData = useCallback(() => {
    const forcedAmount = contract?.amount_forced ? parseFloat(contract.amount) : null;
    const computedTotal = computedPricing?.total || 0;
    const billable = forcedAmount != null && !isNaN(forcedAmount)
      ? forcedAmount
      : (computedTotal || parseFloat(contract?.amount) || 0);

    const presentation = buildContractPresentation(computedPricing, billable);

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
      equipmentLines: presentation.equipmentLines,
      subtotal: presentation.subtotal,
      discountPercent: presentation.discountPercent,
      discountAmount: presentation.discountAmount,
      exceptionalDiscountAmount: presentation.exceptionalDiscountAmount,
      total: presentation.total,
      zoneName: activeZone?.label || '-',
      notes: contract.notes || null,
      signatureBase64: null,
      signataireNom: null,
      signedAt: null,
    };
  }, [contract, client, computedPricing, activeZone]);

  const pret = Boolean(contract && client)
    && !equipementsEnChargement && !tarifsEnChargement && !forcagesEnChargement && !isDetecting;

  /**
   * Envoie la proposition au client. Lève une erreur si rien n'est parti ; une fois l'e-mail
   * parti, ne lève plus : `marque = false` dit seulement que le contrat n'a pas pu être passé en
   * « Proposition envoyée » (le dire sans inciter à renvoyer).
   */
  const envoyerProposition = useCallback(async () => {
    if (!contract) throw new Error('Proposition introuvable');
    if (!client?.email) throw new Error('Ce client n’a pas d’adresse e-mail');

    // 1. Générer le PDF (react-pdf est lourd : chargé à la demande)
    const { generateContractPdfBlob } = await import('@apps/artisan/components/contrat/ContractPDF');
    const blob = await generateContractPdfBlob(buildPdfData(), company);

    // 2. Upload vers Supabase Storage — préfixe org_id obligatoire (P0.0.7 storage RLS)
    const contractNum = contract.contract_number || `CTR-${contract.id?.slice(0, 8)?.toUpperCase()}`;
    const storagePath = `${orgId}/Proposition_${contractNum}.pdf`;
    const { path: uploadedPath, error: uploadError } = await storageService.uploadFile(
      'contracts', storagePath, blob, { upsert: true, contentType: 'application/pdf' },
    );
    if (uploadError) throw uploadError;

    // 3. URL signée 7 jours
    const { url: pdfUrl, error: urlError } = await storageService.getSignedUrl('contracts', uploadedPath || storagePath, 604800);
    if (urlError || !pdfUrl) throw urlError || new Error('Impossible de générer le lien PDF');

    // 4. Récap équipements pour l'e-mail
    const equipRecap = (computedPricing?.items || [])
      .map((item) => `${item.label}${item.reference ? ` (${item.reference})` : ''}`)
      .join(', ') || 'Vos équipements';
    const totalStr = formatEuro(billableTotal);

    // 5. Texte de l'e-mail : mail_campaigns (éditable via l'onglet Éditeur)
    const { data: template, error: templateError } = await mailCampaignsService.getByKey(orgId, 'proposition_contrat');
    if (templateError || !template) {
      throw new Error("Template 'proposition_contrat' introuvable — vérifie l'onglet Mailing > Éditeur");
    }
    const requiredPlaceholders = ['{{EQUIP_RECAP}}', '{{TOTAL_AMOUNT}}', '{{PDF_URL}}'];
    const missing = requiredPlaceholders.filter((p) => !template.html_body?.includes(p));
    if (missing.length > 0) logger.warn('[useContractProposal] Placeholders manquants dans le template:', missing);

    const htmlBody = (template.html_body || '')
      .replaceAll('{{EQUIP_RECAP}}', equipRecap)
      .replaceAll('{{TOTAL_AMOUNT}}', totalStr)
      .replaceAll('{{PDF_URL}}', pdfUrl);
    const subject = template.subject || `Votre proposition de contrat d'entretien — ${company.name}`;

    // 6. Envoi via l'edge mailing-send (P0.8 V2) : le SQL n'est plus accepté du client, l'edge
    // appelle la RPC `mail_fetch_recipients(client_id)` qui vérifie l'appartenance à l'org.
    const { data: sendData, error: sendError } = await supabase.functions.invoke('mailing-send', {
      body: { mode: 'single', client_id: clientId, subject, html_body: htmlBody, campaign_name: 'Proposition Contrat' },
    });
    if (sendError) throw sendError;
    if (sendData?.success === false) throw new Error(sendData?.error || 'Envoi proposition échoué');

    // 7. Marquer workflow_status = proposal_sent (le statut contractuel reste inchangé).
    // L'e-mail est parti : un refus ici n'est PAS une erreur d'envoi (elle inciterait à renvoyer
    // la proposition au client). Le service renvoie `{ data, error }` sans throw.
    let marque = true;
    if (!contract.workflow_status || contract.workflow_status === 'nouveau') {
      const { error: statusError } = await contractsService.updateContract(contract.id, { workflow_status: 'proposal_sent' });
      if (statusError) {
        logger.error('[useContractProposal] workflow_status proposal_sent refusé:', statusError);
        marque = false;
      } else {
        queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
      }
    }
    return { envoyeA: client.email, marque };
  }, [contract, client, clientId, orgId, computedPricing, billableTotal, buildPdfData, queryClient, company]);

  return { company, computedPricing, billableTotal, buildPdfData, pret, envoyerProposition };
}
