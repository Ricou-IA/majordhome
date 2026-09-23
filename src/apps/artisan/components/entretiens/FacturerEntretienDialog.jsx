/**
 * FacturerEntretienDialog.jsx — Majord'home Artisan
 * ============================================================================
 * Aperçu puis création de la facture Pennylane d'un entretien réalisé, depuis
 * sa carte (spec 2026-09-21-facturation-entretien-pennylane-push-design.md).
 *
 * Les lignes sont celles du CONTRAT SIGNÉ : mêmes entrées que l'écran de
 * signature (équipements du contrat, grille × zone enregistrée, prix forcés par
 * ligne, dégressivité) passées au calcul pur `computeContractLines`, puis au
 * modèle pur `buildEntretienInvoice` (remise, TVA, pièces, objet). Ce composant
 * ne calcule rien : il charge et affiche. Un avertissement s'affiche, une erreur
 * bloque : on ne crée jamais une facture qu'on n'a pas su calculer.
 *
 * Édition manuelle (2026-09-23, Eric : « on paramètre 99 % des cas et on garde
 * la main sur les edge cases ») : `model` reste le calcul automatique intouché ;
 * `effectiveModel` (= `applyLineEdits(model, edits)` si l'utilisateur a ouvert
 * l'éditeur, sinon `model` tel quel) est ce qui s'affiche et part en facture —
 * ce composant ne calcule toujours rien, `applyLineEdits` fait le recalcul.
 * ============================================================================
 */

import { useMemo, useState, useEffect } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, XCircle, ExternalLink, Pencil, RotateCcw } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { usePricingData, useContractLineOverrides } from '@hooks/usePricing';
import { useContract, useContractEquipments } from '@hooks/useContracts';
import { useContractZone } from '@hooks/useContractZone';
import { useOrgSettings, pennylaneInvoiceSettings } from '@hooks/useOrgSettings';
import { useCreateEntretienInvoice, useLedgerAccounts } from '@hooks/usePennylane';
import { useIssueEntretienInvoice } from '@hooks/useInvoices';
import { buildInvoiceDraft, invoicingSettings, invoiceErrorMessage } from '@/lib/invoiceDocumentModel';
import { buildCompanyInfo, formatFullAddress } from '@/lib/orgBranding';
import { generateInvoicePdfBlob } from '@/apps/artisan/components/facturation/InvoicePDF';
import InvoiceLinesEditor from '@/apps/artisan/components/facturation/InvoiceLinesEditor';
import { computeContractLines } from '@/lib/contractPricing';
import { buildEntretienInvoice, toPennylaneInvoicePayload, lineEditsFromModel, applyLineEdits } from '@/lib/entretienInvoiceModel';
import { formatEuro, formatDateForInput, formatDateShortFR, downloadBlob } from '@/lib/utils';

/**
 * @param {object} p
 * @param {object} p.item   carte de `majordhome_entretien_sav`
 * @param {string} p.orgId  org core
 * @param {boolean} p.open
 * @param {(open: boolean) => void} p.onOpenChange
 * @param {() => void} [p.onCreated]
 */
export default function FacturerEntretienDialog({ item, orgId, open, onOpenChange, onCreated }) {
  const contractId = item.effective_contract_id || item.contract_id || null;
  const { contract, isLoading: loadingContract } = useContract(contractId);
  const { equipments, isLoading: loadingEquipments } = useContractEquipments(contractId);
  const { zones, rates, discounts, equipmentTypes, categories, isLoading: loadingPricing } = usePricingData();
  const { overrides, isLoading: loadingOverrides } = useContractLineOverrides(contractId);
  const { settings, isLoading: loadingSettings } = useOrgSettings();
  const invoiceSettings = pennylaneInvoiceSettings(settings);
  const isDraft = invoiceSettings.mode === 'draft';
  const isHub = invoiceSettings.mode === 'hub';
  const invoicing = invoicingSettings(settings);
  // Dérivé de `settings` (pas un hook dédié) : en mode hub, Majord'home émet lui-même et
  // l'intégration Pennylane n'est pas requise — ne pas déclencher `useLedgerAccounts` inutilement.
  const pennylaneEnabled = Boolean(settings?.pennylane?.enabled);
  const ledgerEnabled = !loadingSettings && pennylaneEnabled;
  // Catalogue des comptes (déclinés par TVA) pour résoudre l'id du compte paramétré par numéro.
  // Indisponible (PL injoignable) → lignes sans compte + avertissement, jamais bloquant.
  const { accounts: ledgerCatalog, isLoading: loadingLedger } = useLedgerAccounts({ enabled: ledgerEnabled });
  const createInvoice = useCreateEntretienInvoice(orgId);
  const issueInvoice = useIssueEntretienInvoice(orgId);

  // Zone : celle ENREGISTRÉE sur le contrat (figée à la configuration, cf. Module
  // Contrats) ; détection de secours partagée seulement si le contrat n'en a jamais reçu.
  const clientLite = useMemo(
    () => ({ address: item.client_address, postal_code: item.client_postal_code, city: item.client_city }),
    [item.client_address, item.client_postal_code, item.client_city],
  );
  const { activeZone: detectedZone } = useContractZone(clientLite, contract, zones);
  const activeZone = useMemo(() => {
    if (contract?.zone_id && zones?.length) {
      const stored = zones.find((z) => z.id === contract.zone_id);
      if (stored) return stored;
    }
    return detectedZone;
  }, [contract?.zone_id, zones, detectedZone]);

  const referentiel = useMemo(
    () => ({
      typesById: new Map((equipmentTypes || []).map((t) => [t.id, t])),
      categoriesById: new Map((categories || []).map((c) => [c.id, c])),
    }),
    [equipmentTypes, categories],
  );

  const isLoading = loadingContract || loadingEquipments || loadingPricing || loadingOverrides || loadingSettings || (ledgerEnabled && loadingLedger);
  // Identité légale de l'émetteur (finding F2, revue finale 2026-09-22) : buildCompanyInfo
  // retombe sur des défauts neutres ("Votre entreprise", champs vides) si settings.legal_name /
  // .siret / .address ne sont pas renseignés — sans cette garde, une org non paramétrée émet
  // une facture légalement invalide (mentions obligatoires manquantes). Mémoïsé pour être
  // réutilisé tel quel dans handleConfirm (mode hub).
  const company = useMemo(() => buildCompanyInfo(settings), [settings]);

  const model = useMemo(() => {
    if (isLoading || !contract) return null;
    const pricing = computeContractLines({
      equipments: equipments || [],
      rates: rates || [],
      equipmentTypes: equipmentTypes || [],
      zone: activeZone,
      overrides: overrides || {},
      discounts: discounts || [],
      exceptionalDiscount: contract.exceptional_discount || 0,
    });
    return buildEntretienInvoice({
      intervention: { id: item.id },
      contract: { id: contract.id, contract_number: contract.contract_number, amount: contract.amount },
      pricing,
      parts: Array.isArray(item.parts_detail) ? item.parts_detail : [],
      referentiel,
      ledgerAccounts: { ...invoiceSettings.ledgerAccounts, catalog: ledgerCatalog || [] },
      templates: invoiceSettings.templates,
      deadlineDays: invoiceSettings.deadlineDays,
      today: formatDateForInput(new Date()),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- invoiceSettings est dérivé de `settings` (objet stable de React Query)
  }, [isLoading, contract, equipments, rates, equipmentTypes, activeZone, overrides, discounts, item, referentiel, settings, ledgerCatalog]);

  // Édition manuelle des lignes (facultative) : `edits === null` ⇒ pas d'édition en cours,
  // `effectiveModel` = `model` tel quel. Réinitialisée seulement à la réouverture de la
  // modale ou au changement de carte — PAS sur `[model]` : `model` peut être recalculé à
  // chaque render (ex. `ledgerCatalog` retombant sur un tableau vide non stable côté hook)
  // sans que rien n'ait réellement changé, et un reset sur ce useMemo effaçait l'édition en
  // cours juste après avoir cliqué « Modifier les lignes » (vague finale 2026-09-23, C1).
  const [edits, setEdits] = useState(null);
  useEffect(() => { setEdits(null); }, [open, item.id]);
  const effectiveModel = useMemo(
    () => (model && edits ? applyLineEdits(model, edits, { catalog: ledgerCatalog || [] }) : model),
    [model, edits, ledgerCatalog],
  );

  // Détail de la remise (dégressivité / exceptionnelle / commerciale) : calculé une seule
  // fois, réutilisé par le tableau lecture seule ET par le bloc sous l'éditeur (mêmes chiffres).
  const discountDetail = effectiveModel?.discount
    ? [
        effectiveModel.discount.degressivitePercent > 0 ? `dégressivité ${effectiveModel.discount.degressivitePercent} %` : null,
        effectiveModel.discount.exceptionalAmount > 0 ? `remise exceptionnelle ${formatEuro(effectiveModel.discount.exceptionalAmount)}` : null,
        effectiveModel.discount.commercialAmount > 0 ? `remise commerciale ${formatEuro(effectiveModel.discount.commercialAmount)}` : null,
      ].filter(Boolean).join(' + ') || 'montant du contrat'
    : null;

  const missingAddress = isHub && !(item.client_address && item.client_postal_code && item.client_city);
  const missingIssuer = isHub && !(company.legalName && company.siret && formatFullAddress(company));
  const blocked = !effectiveModel || effectiveModel.errors.length > 0 || effectiveModel.lines.length === 0 || !item.client_id || missingAddress || missingIssuer || !!item.invoice_id;

  const handleConfirm = async () => {
    if (blocked || createInvoice.isPending || issueInvoice.isPending) return;
    if (isHub) {
      try {
        const draft = buildInvoiceDraft({
          model: effectiveModel,
          orgId,
          context: 'contrat',
          client: {
            id: item.client_id,
            display_name: item.client_name,
            first_name: item.client_first_name,
            last_name: item.client_last_name,
            address: item.client_address,
            postal_code: item.client_postal_code,
            city: item.client_city,
            email: item.client_email,
            phone: item.client_phone,
            client_number: item.client_number ?? null,
          },
          contractId: contract?.id || null,
          interventionId: item.id,
          dueDays: invoiceSettings.deadlineDays,
        });
        const issued = await issueInvoice.mutateAsync({
          draft,
          numberPrefix: invoicing.numberPrefix,
          company,
          invoicing,
          renderPdf: generateInvoicePdfBlob,
          interventionId: item.id,
          invoicedAt: item.invoiced_at || null,
          pennylane: pennylaneEnabled ? { enabled: true } : null,
        });
        if (issued.blob) downloadBlob(issued.blob, `${issued.number}.pdf`);
        toast.success(
          issued.pennylaneInvoiceId
            ? `Facture ${issued.number} émise, archivée et importée dans Pennylane`
            : `Facture ${issued.number} émise et archivée`,
          { action: issued.blob ? { label: 'Télécharger', onClick: () => downloadBlob(issued.blob, `${issued.number}.pdf`) } : undefined },
        );
        if (issued.importWarning) toast.warning(issued.importWarning, { duration: 15000 });
        onOpenChange(false);
        onCreated?.();
      } catch (err) {
        toast.error(invoiceErrorMessage(err), { duration: 15000 });
        // Le numéro a déjà été consommé (facture existante, carte marquée ou en cours de
        // marquage) : ne pas laisser la modale proposer une seconde émission (review round 1).
        if (err?.issued) {
          onOpenChange(false);
          onCreated?.();
        }
      }
      return;
    }
    try {
      const created = await createInvoice.mutateAsync({
        interventionId: item.id,
        clientId: item.client_id,
        invoicedAt: item.invoiced_at || null,
        // `external_reference` devient la référence de paiement PL et doit être UNIQUE, même
        // face à un brouillon supprimé (422 « Custom payment reference has already been
        // taken », 2026-09-22) : intervention + suffixe d'essai. L'idempotence, elle, est
        // portée par le mapping pennylane_sync relu avant tout POST, pas par ce champ.
        buildPayload: (customerId) =>
          toPennylaneInvoicePayload(effectiveModel, { customerId, draft: isDraft, externalReference: `${item.id}-${Date.now().toString(36)}` }),
        journalId: invoiceSettings.journalId,
      });
      if (created.journalWarning) {
        toast.warning(created.journalWarning, { duration: 12000 });
      }
      const ref = created.invoiceNumber || (created.draft ? 'brouillon' : `#${created.invoiceId}`);
      toast.success(
        created.alreadyExisted
          ? `Facture déjà créée sur Pennylane (${ref}) — carte marquée facturée`
          : `${created.draft ? 'Brouillon de facture créé' : 'Facture créée'} sur Pennylane (${ref})`,
        created.publicFileUrl
          ? { action: { label: 'Ouvrir', onClick: () => window.open(created.publicFileUrl, '_blank', 'noopener') } }
          : undefined,
      );
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      toast.error(err?.message || 'La facture n’a pas pu être créée');
    }
  };

  const clientLabel = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim();
  const contractNumber = contract?.contract_number || item.contract_number;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isHub ? 'Émettre la facture' : isDraft ? 'Créer le brouillon de facture' : 'Créer la facture'}
      description={
        isHub
          ? `${clientLabel}${contractNumber ? ` · ${contractNumber}` : ''} — Majord'home attribue le numéro (${invoicing.numberPrefix}-${new Date().getFullYear()}-…), génère le PDF et l'archive. ${pennylaneEnabled ? 'La facture est ensuite importée telle quelle dans Pennylane (journal de ventes).' : 'Pennylane n’est pas activé : pas d’import.'}`
          : `${clientLabel}${contractNumber ? ` · ${contractNumber}` : ''} — la facture sera créée sur Pennylane${isDraft ? ' en brouillon, à finaliser et envoyer depuis Pennylane' : ' et numérotée immédiatement'}.`
      }
      confirmLabel={isHub ? 'Émettre la facture' : isDraft ? 'Créer le brouillon' : 'Créer la facture'}
      variant="default"
      size="xl"
      onConfirm={handleConfirm}
      loading={createInvoice.isPending || issueInvoice.isPending}
      confirmDisabled={isLoading || blocked}
    >
      <div className="mt-4 space-y-3 text-sm">
        {isLoading && <p className="text-gray-500">Préparation de la facture…</p>}

        {!isLoading && !contract && (
          <p className="flex items-start gap-2 text-red-700"><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />Cette carte n’a pas de contrat rattaché : rien à facturer.</p>
        )}
        {!isLoading && !item.client_id && (
          <p className="flex items-start gap-2 text-red-700"><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />Cette carte n’a pas de client rattaché.</p>
        )}
        {!isLoading && missingAddress && (
          <p className="flex items-start gap-2 text-red-700"><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />Adresse du client incomplète : une facture doit porter l’adresse de facturation (fiche client).</p>
        )}
        {!isLoading && missingIssuer && (
          <p className="flex items-start gap-2 text-red-700"><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />Identité de l’émetteur incomplète (raison sociale, SIRET, adresse) : Paramètres → Organisation.</p>
        )}

        {effectiveModel && effectiveModel.errors.map((e, i) => (
          <p key={`${e.code}-${i}`} className="flex items-start gap-2 text-red-700"><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{e.message}</p>
        ))}

        {model && model.lines.length > 0 && (
          <>
            <div className="flex justify-end">
              {edits === null ? (
                <button type="button" onClick={() => setEdits(lineEditsFromModel(model))} className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
                  <Pencil className="w-3.5 h-3.5" /> Modifier les lignes
                </button>
              ) : (
                <button type="button" onClick={() => setEdits(null)} className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
                  <RotateCcw className="w-3.5 h-3.5" /> Revenir aux lignes calculées
                </button>
              )}
            </div>

            {edits === null ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-200">
                    <th className="text-left font-medium py-1">Ligne</th>
                    <th className="text-right font-medium py-1 w-10">Qté</th>
                    <th className="text-right font-medium py-1 w-14">TVA</th>
                    <th className="text-right font-medium py-1 w-20">TTC</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveModel.lines.map((l, i) => (
                    <tr key={i} className="border-b border-gray-100 align-top">
                      <td className="py-1.5 pr-2">
                        <div className="text-gray-900">{l.label}</div>
                        {l.description && <div className="text-gray-500">{l.description}</div>}
                      </td>
                      <td className="py-1.5 text-right text-gray-700">{l.quantity}</td>
                      <td className="py-1.5 text-right text-gray-700">{l.vatPercent} %</td>
                      <td className="py-1.5 text-right text-gray-900 font-medium">
                        {l.kind === 'libre' && l.netTtc === 0 ? (
                          <span className="text-gray-700">offert</span>
                        ) : (
                          formatEuro(l.netTtc)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {effectiveModel.discount && (
                    <tr className="text-gray-700">
                      <td colSpan={3} className="pt-2 text-right">
                        Remise {effectiveModel.discount.percent} % sur les équipements
                        <span className="text-gray-500"> ({discountDetail})</span>
                      </td>
                      <td className="pt-2 text-right">−{formatEuro(effectiveModel.discount.amount)}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={3} className="pt-2 text-right font-semibold text-gray-900">Total TTC</td>
                    <td className="pt-2 text-right font-semibold text-gray-900">{formatEuro(effectiveModel.totalTtc)}</td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <>
                <InvoiceLinesEditor lines={edits} onChange={setEdits} model={model} />
                <div className="space-y-1 text-xs">
                  {effectiveModel.discount && (
                    <div className="flex justify-between text-gray-700">
                      <span>
                        Remise {effectiveModel.discount.percent} % sur les équipements
                        <span className="text-gray-500"> ({discountDetail})</span>
                      </span>
                      <span>−{formatEuro(effectiveModel.discount.amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-gray-900">
                    <span>Total TTC</span>
                    <span>{formatEuro(effectiveModel.totalTtc)}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Les lignes modifiées partent telles quelles (brouillon Pennylane ou facture émise). La remise du contrat reste appliquée sur les lignes d’équipement via leur colonne Rem.
                </p>
              </>
            )}

            <div className="text-xs text-gray-600 space-y-0.5">
              <div><span className="text-gray-500">Objet :</span> {effectiveModel.subject}</div>
              <div><span className="text-gray-500">Échéance :</span> {formatDateShortFR(effectiveModel.deadline)} ({invoiceSettings.deadlineDays} j)</div>
              {!isHub && invoiceSettings.journalId && (
                <div><span className="text-gray-500">Journal :</span> {invoiceSettings.journalCode || `#${invoiceSettings.journalId}`} (Pennylane refuse le déplacement, la facture tombe dans le journal de ventes principal)</div>
              )}
              {activeZone && <div><span className="text-gray-500">Zone tarifaire :</span> {activeZone.label || activeZone.code || activeZone.name}</div>}
            </div>
          </>
        )}

        {effectiveModel && effectiveModel.warnings.map((w, i) => (
          <p key={`${w.code}-${i}`} className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 text-xs">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />{w.message}
          </p>
        ))}

        {!isLoading && (
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <ExternalLink className="w-3 h-3" />
            Mode, échéance et mentions : Paramètres → Facturation.
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}
