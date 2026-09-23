// src/apps/artisan/components/facturation/SendInvoiceEmailDialog.jsx
// ============================================================================
// Renvoi de la facture d'entretien par e-mail depuis la carte « Facturée »
// (spec 2026-09-23-facture-entretien-envoi-email-resend). Même mécanique que
// l'envoi proposé dans FacturerEntretienDialog, mais déclenché explicitement :
// la coche est cochée et non décochable (on est déjà dans un dialogue « Envoyer »).
// ============================================================================
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useOrgSettings, pennylaneInvoiceSettings } from '@hooks/useOrgSettings';
import { useInterventionCertificats } from '@hooks/useCertificats';
import { useSendInvoiceEmail } from '@hooks/useInvoices';
import { invoiceEmailAvailability, certificateAttachmentRows, invoiceEmailErrorMessage } from '@/lib/invoiceEmailModel';
import InvoiceEmailOptions from './InvoiceEmailOptions';

/**
 * @param {object} p
 * @param {object} p.item   carte de `majordhome_entretien_sav`
 * @param {string} p.orgId  org core
 * @param {boolean} p.open
 * @param {(open: boolean) => void} p.onOpenChange
 */
export default function SendInvoiceEmailDialog({ item, orgId, open, onOpenChange }) {
  const { settings } = useOrgSettings();
  const invoiceSettings = pennylaneInvoiceSettings(settings);
  const availability = useMemo(
    () => invoiceEmailAvailability({
      settings,
      mode: invoiceSettings.mode,
      clientEmail: item.client_email,
      hasInvoice: !!item.invoice_id,
      isDraftInvoice: undefined,
    }),
    [settings, invoiceSettings.mode, item.client_email, item.invoice_id],
  );
  const { certificats, isLoading: loadingCerts } = useInterventionCertificats(orgId, item.id, { enabled: open });
  const certRows = useMemo(() => certificateAttachmentRows(certificats), [certificats]);
  const [selectedCertIds, setSelectedCertIds] = useState(null);
  const effectiveCertIds = selectedCertIds ?? new Set(certRows.filter((r) => r.defaultChecked).map((r) => r.id));

  const sendInvoiceEmail = useSendInvoiceEmail(orgId);

  const clientLabel = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim();

  const handleConfirm = async () => {
    if (!availability.enabled || sendInvoiceEmail.isPending) return;
    try {
      const sent = await sendInvoiceEmail.mutateAsync({ interventionId: item.id, certificateIds: [...effectiveCertIds] });
      toast.success(`Facture envoyée à ${sent.to}${sent.attachments?.length > 1 ? ` (${sent.attachments.length} pièces jointes)` : ''}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(invoiceEmailErrorMessage(err), { duration: 15000 });
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Envoyer la facture par e-mail"
      description={`${clientLabel}${item.contract_number ? ` · ${item.contract_number}` : ''} — la facture et les certificats cochés partent par e-mail depuis ${settings?.from_email || 'l’adresse configurée'}.`}
      confirmLabel="Envoyer"
      variant="default"
      size="lg"
      onConfirm={handleConfirm}
      loading={sendInvoiceEmail.isPending}
      confirmDisabled={!availability.enabled}
    >
      <div className="mt-4 space-y-2 text-sm">
        <p className="text-xs text-gray-500">
          Un brouillon Pennylane ne peut pas être envoyé : l’envoi sera refusé tant que la facture n’est pas finalisée.
        </p>
        <InvoiceEmailOptions
          availability={availability}
          email={item.client_email}
          checked
          onCheckedChange={() => {}}
          rows={certRows}
          selectedIds={effectiveCertIds}
          onToggleCertificate={(id) => setSelectedCertIds((prev) => {
            const next = new Set(prev ?? effectiveCertIds);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          })}
          loadingCertificates={loadingCerts}
        />
      </div>
    </ConfirmDialog>
  );
}
