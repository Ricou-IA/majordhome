/**
 * FacturerEntretienDialog.jsx — Majord'home Artisan
 * ============================================================================
 * Aperçu puis création de la facture Pennylane d'un entretien réalisé, depuis
 * sa carte (spec 2026-09-21-facturation-entretien-pennylane-push-design.md).
 *
 * Le calcul (lignes, TVA, objet, total) vit dans le module PUR
 * `src/lib/entretienInvoiceModel.js` ; ce composant ne fait que charger les
 * entrées (lignes tarifaires du contrat effectif, équipements du client,
 * référentiel, réglages) et afficher le modèle. Un avertissement s'affiche, une
 * erreur bloque : on ne crée jamais une facture qu'on n'a pas su calculer.
 * ============================================================================
 */

import { useMemo } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, XCircle, ExternalLink } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useContractPricing } from '@hooks/usePricing';
import { useClientEquipments } from '@hooks/useClients';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { useOrgSettings, pennylaneInvoiceSettings } from '@hooks/useOrgSettings';
import { useCreateEntretienInvoice } from '@hooks/usePennylane';
import { buildEntretienInvoice, toPennylaneInvoicePayload } from '@/lib/entretienInvoiceModel';
import { formatEuro, formatDateForInput, formatDateShortFR } from '@/lib/utils';

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
  const { items: pricingItems, isLoading: loadingItems } = useContractPricing(contractId);
  const { equipments, isLoading: loadingEquipments } = useClientEquipments(item.client_id);
  const { index: referentiel, isLoading: loadingReferentiel } = useEquipmentReferential();
  const { settings, isLoading: loadingSettings } = useOrgSettings();
  const createInvoice = useCreateEntretienInvoice(orgId);

  const invoiceSettings = pennylaneInvoiceSettings(settings);
  const isDraft = invoiceSettings.mode === 'draft';
  const isLoading = loadingItems || loadingEquipments || loadingReferentiel || loadingSettings;

  const model = useMemo(() => {
    if (isLoading) return null;
    return buildEntretienInvoice({
      intervention: { id: item.id },
      contract: { id: contractId, contract_number: item.contract_number, amount: item.contract_amount },
      pricingItems: pricingItems || [],
      equipments: equipments || [],
      parts: Array.isArray(item.parts_detail) ? item.parts_detail : [],
      referentiel,
      deadlineDays: invoiceSettings.deadlineDays,
      today: formatDateForInput(new Date()),
    });
  }, [isLoading, item, contractId, pricingItems, equipments, referentiel, invoiceSettings.deadlineDays]);

  const blocked = !model || model.errors.length > 0 || model.lines.length === 0 || !item.client_id;

  const handleConfirm = async () => {
    if (blocked || createInvoice.isPending) return;
    try {
      const created = await createInvoice.mutateAsync({
        interventionId: item.id,
        clientId: item.client_id,
        invoicedAt: item.invoiced_at || null,
        buildPayload: (customerId) =>
          toPennylaneInvoicePayload(model, { customerId, draft: isDraft, externalReference: item.id }),
      });
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

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isDraft ? 'Créer le brouillon de facture' : 'Créer la facture'}
      description={`${clientLabel}${item.contract_number ? ` · ${item.contract_number}` : ''} — la facture sera créée sur Pennylane${isDraft ? ' en brouillon, à finaliser et envoyer depuis Pennylane' : ' et numérotée immédiatement'}.`}
      confirmLabel={isDraft ? 'Créer le brouillon' : 'Créer la facture'}
      variant="default"
      onConfirm={handleConfirm}
      loading={createInvoice.isPending}
      confirmDisabled={isLoading || blocked}
    >
      <div className="mt-4 space-y-3 text-sm">
        {isLoading && <p className="text-gray-500">Préparation de la facture…</p>}

        {!isLoading && !item.client_id && (
          <p className="flex items-start gap-2 text-red-700"><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />Cette carte n’a pas de client rattaché.</p>
        )}

        {model && model.errors.map((e) => (
          <p key={e.code} className="flex items-start gap-2 text-red-700"><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{e.message}</p>
        ))}

        {model && model.lines.length > 0 && (
          <>
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
                {model.lines.map((l, i) => (
                  <tr key={i} className="border-b border-gray-100 align-top">
                    <td className="py-1.5 pr-2">
                      <div className="text-gray-900">{l.label}</div>
                      {l.description && <div className="text-gray-500">{l.description}</div>}
                    </td>
                    <td className="py-1.5 text-right text-gray-700">{l.quantity}</td>
                    <td className="py-1.5 text-right text-gray-700">{l.vatPercent} %</td>
                    <td className="py-1.5 text-right text-gray-900 font-medium">{formatEuro(l.totalTtc)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="pt-2 text-right font-semibold text-gray-900">Total TTC</td>
                  <td className="pt-2 text-right font-semibold text-gray-900">{formatEuro(model.totalTtc)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="text-xs text-gray-600 space-y-0.5">
              <div><span className="text-gray-500">Objet :</span> {model.subject}</div>
              <div><span className="text-gray-500">Échéance :</span> {formatDateShortFR(model.deadline)} ({invoiceSettings.deadlineDays} j)</div>
            </div>
          </>
        )}

        {model && model.warnings.map((w, i) => (
          <p key={`${w.code}-${i}`} className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 text-xs">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />{w.message}
          </p>
        ))}

        {!isLoading && (
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <ExternalLink className="w-3 h-3" />
            Mode et échéance : Paramètres → Facturation Pennylane.
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}
