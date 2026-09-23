// src/apps/artisan/components/facturation/CancelInvoiceDialog.jsx
// Annulation d'une facture émise par un avoir (hub phase 3). Destructif : l'avoir est un
// document légal numéroté, l'original passe « annulée », la carte redevient facturable.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useOrgSettings, usePennylaneEnabled } from '@hooks/useOrgSettings';
import { useCancelInvoiceWithCreditNote } from '@hooks/useInvoices';
import { invoicesService } from '@services/invoices.service';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { invoicingSettings, invoiceErrorMessage } from '@/lib/invoiceDocumentModel';
import { generateInvoicePdfBlob } from './InvoicePDF';
import { formatEuro, downloadBlob } from '@/lib/utils';

export default function CancelInvoiceDialog({ item, orgId, open, onOpenChange, onDone }) {
  const { settings } = useOrgSettings();
  const pennylaneEnabled = usePennylaneEnabled();
  const cancel = useCancelInvoiceWithCreditNote(orgId);
  const [invoice, setInvoice] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open || !item.invoice_id) return;
    let alive = true;
    setInvoice(null); setLoadError(null); setReason('');
    invoicesService.getById(orgId, item.invoice_id).then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) setLoadError(error?.message || 'Facture introuvable');
      else setInvoice(data.invoice);
    });
    return () => { alive = false; };
  }, [open, item.invoice_id, orgId]);

  const originalNotImported = pennylaneEnabled && invoice && invoice.import_status !== 'imported';
  const blocked = !invoice || invoice.status !== 'issued' || invoice.kind !== 'invoice' || originalNotImported;

  const handleConfirm = async () => {
    if (blocked || cancel.isPending) return;
    const invoicing = invoicingSettings(settings);
    try {
      const r = await cancel.mutateAsync({
        invoiceId: invoice.id, interventionId: item.id, numberPrefix: invoicing.numberPrefix, reason,
        company: buildCompanyInfo(settings), invoicing, renderPdf: generateInvoicePdfBlob, pennylaneEnabled,
      });
      if (r.blob) downloadBlob(r.blob, `${r.number}.pdf`);
      toast.success(`Avoir ${r.number} émis — facture ${r.creditedNumber} annulée, carte à refacturer`, {
        action: r.blob ? { label: 'Télécharger', onClick: () => downloadBlob(r.blob, `${r.number}.pdf`) } : undefined,
      });
      if (r.importWarning) toast.warning(r.importWarning, { duration: 15000 });
      onOpenChange(false);
      onDone?.();
    } catch (err) {
      toast.error(invoiceErrorMessage(err, 'L’avoir n’a pas pu être émis'), { duration: 15000 });
      if (err?.issued) { onOpenChange(false); onDone?.(); }
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Annuler la facture par un avoir"
      description={invoice
        ? `Facture ${invoice.number} (${formatEuro(invoice.total_ttc)} TTC) : un avoir du même montant sera émis dans la même série, la facture passera « annulée » et la carte redeviendra facturable. Irréversible.`
        : loadError || 'Chargement de la facture…'}
      confirmLabel="Émettre l’avoir"
      variant="destructive"
      onConfirm={handleConfirm}
      loading={cancel.isPending}
      confirmDisabled={blocked}
    >
      <div className="mt-4 space-y-2 text-sm">
        {invoice && invoice.status !== 'issued' && <p className="text-red-700">Cette facture n’est pas émise (statut {invoice.status}).</p>}
        {invoice && invoice.kind !== 'invoice' && <p className="text-red-700">Ce document est déjà un avoir : il ne peut pas être annulé.</p>}
        <label className="block text-xs font-medium text-gray-600">Motif (optionnel, porté sur l’avoir)</label>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="Erreur de tarif, prestation non réalisée…" />
        {originalNotImported
          ? <p className="text-red-700">La facture d’origine n’est pas importée dans Pennylane (statut : {invoice.import_status}) : importez-la d’abord depuis la carte, sinon l’avoir créerait une écriture négative isolée.</p>
          : pennylaneEnabled && <p className="text-xs text-gray-500">L’avoir sera importé dans Pennylane, lié à la facture d’origine si elle y est.</p>}
      </div>
    </ConfirmDialog>
  );
}
