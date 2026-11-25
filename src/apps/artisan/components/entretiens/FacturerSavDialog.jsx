/**
 * FacturerSavDialog.jsx — facture Pennylane d'une intervention SAV, depuis le bouton « Facturé »
 * de sa carte (Eric 2026-11-25).
 *
 * Reprend le devis fait dans Majord'home (fléché vers la carte) s'il existe ; sinon part d'une
 * ligne « Intervention SAV » et des pièces de la carte. Les lignes restent modifiables. Règles :
 * `preparerFactureSav` / `modeleFactureSav` (src/lib/savInvoiceModel.js) ; création et marquage
 * de la carte : `useCreateEntretienInvoice` (même voie que l'entretien, idempotente par carte).
 * Ce composant charge et affiche, il ne calcule rien.
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, XCircle, FileText } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { LignesSquelette } from '@components/ui/squelette';
import { useOrgSettings, pennylaneInvoiceSettings } from '@hooks/useOrgSettings';
import { useCreateEntretienInvoice, useLedgerAccounts } from '@hooks/usePennylane';
import { useDevisDetail, useDevisLines } from '@hooks/useDevis';
import { devisAFacturer, preparerFactureSav, modeleFactureSav } from '@/lib/savInvoiceModel';
import { toPennylaneInvoicePayload } from '@/lib/entretienInvoiceModel';
import { formatEuro, formatDateForInput, formatDateShortFR } from '@/lib/utils';
import InvoiceLinesEditor from '@/apps/artisan/components/facturation/InvoiceLinesEditor';
import { FormField, TextArea } from '../FormFields';
import { savService } from '@services/sav.service';

/**
 * @param {object} p
 * @param {object} p.item carte SAV de `majordhome_entretien_sav`
 * @param {string} p.orgId org core
 * @param {boolean} p.open
 * @param {(open: boolean) => void} p.onOpenChange
 * @param {() => void} [p.onCreated]
 */
export default function FacturerSavDialog({ item, orgId, open, onOpenChange, onCreated }) {
  const { settings, isLoading: loadingSettings } = useOrgSettings();
  const invoiceSettings = pennylaneInvoiceSettings(settings);
  const isDraft = invoiceSettings.mode === 'draft';
  const { accounts: ledgerCatalog, isLoading: loadingLedger } = useLedgerAccounts({ enabled: open });

  const devis = useMemo(() => devisAFacturer(item.sav_quotes), [item.sav_quotes]);
  const { quote, isLoading: loadingQuote, error: errQuote } = useDevisDetail(devis?.id || null);
  const { lines: quoteLines, isLoading: loadingLines, error: errLines } = useDevisLines(devis?.id || null);
  const lectureDevisKo = !!devis && (!!errQuote || !!errLines);
  const isLoading = loadingSettings || loadingLedger || (!!devis && (loadingQuote || loadingLines));

  const prep = useMemo(() => {
    if (isLoading || lectureDevisKo) return null;
    return preparerFactureSav({
      item,
      quote: devis ? (quote || devis) : null,
      quoteLines: devis ? quoteLines : [],
      ledgerAccounts: invoiceSettings.ledgerAccounts,
      deadlineDays: invoiceSettings.deadlineDays,
      today: formatDateForInput(new Date()),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- invoiceSettings dérive de `settings`
  }, [isLoading, lectureDevisKo, item, devis, quote, quoteLines, settings]);

  // Lignes éditées : posées une fois les données prêtes, remises à zéro à la fermeture —
  // jamais recalculées sous une saisie en cours.
  const [edits, setEdits] = useState(null);
  const [clientNote, setClientNote] = useState('');
  useEffect(() => { if (!open) { setEdits(null); setClientNote(''); } }, [open]);
  useEffect(() => { if (open && prep && edits === null) setEdits(prep.edits); }, [open, prep, edits]);

  const model = useMemo(() => {
    if (!prep || !edits) return null;
    const m = modeleFactureSav(prep.base, edits, { catalog: ledgerCatalog || [] });
    return { ...m, clientNote: clientNote.trim() || null };
  }, [prep, edits, ledgerCatalog, clientNote]);

  const createInvoice = useCreateEntretienInvoice(orgId);
  const blocked = !model || model.errors.length > 0 || !item.client_id || !!item.invoice_id;

  const handleConfirm = async () => {
    if (blocked || createInvoice.isPending) return;
    try {
      const created = await createInvoice.mutateAsync({
        interventionId: item.id,
        clientId: item.client_id,
        invoicedAt: item.invoiced_at || null,
        // Référence unique (un brouillon supprimé garde la sienne) ; l'idempotence est portée
        // par le mapping pennylane_sync relu avant tout envoi.
        buildPayload: (customerId) =>
          toPennylaneInvoicePayload(model, { customerId, draft: isDraft, externalReference: `${item.id}-${Date.now().toString(36)}` }),
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

  const marquerFactureeAilleurs = async () => {
    const { error } = await savService.updateFields(item.id, { invoiced_at: new Date().toISOString() });
    if (error) { toast.error('Erreur mise à jour facturation'); return; }
    toast.success('Carte marquée facturée');
    onOpenChange(false);
    onCreated?.();
  };

  const clientLabel = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isDraft ? 'Facturer le SAV — brouillon Pennylane' : 'Facturer le SAV'}
      description={`${clientLabel} — la facture sera créée sur Pennylane${isDraft ? ' en brouillon, à finaliser et envoyer depuis Pennylane' : ' et numérotée immédiatement'}.`}
      confirmLabel={isDraft ? 'Créer le brouillon' : 'Créer la facture'}
      variant="default"
      size="xl"
      onConfirm={handleConfirm}
      loading={createInvoice.isPending}
      confirmDisabled={isLoading || blocked}
    >
      <div className="mt-4 space-y-3 text-sm">
        {isLoading && <LignesSquelette nombre={3} libelle="Préparation de la facture" />}

        {lectureDevisKo && (
          <p className="flex items-start gap-2 text-red-700"><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />Le devis {devis.quote_number || ''} n’a pas pu être lu : réessayez dans un instant.</p>
        )}
        {!isLoading && !item.client_id && (
          <p className="flex items-start gap-2 text-red-700"><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />Cette carte n’a pas de client rattaché.</p>
        )}

        {prep && (
          <p className="flex items-center gap-2 text-xs text-secondary-600">
            <FileText className="w-3.5 h-3.5 text-secondary-400" />
            {prep.source === 'devis'
              ? `Lignes reprises du devis ${devis.quote_number || ''}, modifiables.`
              : 'Aucun devis Majord’home sur cette demande : renseignez les lignes.'}
          </p>
        )}

        {model && edits && (
          <>
            <InvoiceLinesEditor lines={edits} onChange={setEdits} model={model} />
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-secondary-700"><span>Total HT</span><span>{formatEuro(model.totalHt)}</span></div>
              <div className="flex justify-between font-semibold text-secondary-900"><span>Total TTC</span><span>{formatEuro(model.totalTtc)}</span></div>
            </div>
            <div className="text-xs text-secondary-600 space-y-0.5">
              <div><span className="text-secondary-500">Objet :</span> {model.subject}</div>
              <div><span className="text-secondary-500">Échéance :</span> {formatDateShortFR(model.deadline)}</div>
            </div>
            <FormField label="Information client (imprimée sur la facture)">
              <TextArea value={clientNote} onChange={setClientNote} rows={2} placeholder="Rien n’est imprimé si vide" />
            </FormField>
          </>
        )}

        {model && model.errors.map((e, i) => (
          <p key={`${e.code}-${i}`} className="flex items-start gap-2 text-red-700"><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{e.message}</p>
        ))}
        {model && model.warnings.map((w, i) => (
          <p key={`${w.code}-${i}`} className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 text-xs">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />{w.message}
          </p>
        ))}

        <button
          type="button"
          onClick={marquerFactureeAilleurs}
          className="text-xs text-secondary-600 underline underline-offset-2 hover:text-secondary-900"
        >
          Facture déjà faite ailleurs ? Marquer la carte facturée
        </button>
      </div>
    </ConfirmDialog>
  );
}
