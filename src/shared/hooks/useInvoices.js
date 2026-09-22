// src/shared/hooks/useInvoices.js
// ============================================================================
// Hub de facturation — chaîne d'émission d'une facture d'entretien, POINT
// D'ENTRÉE UNIQUE (spec 2026-09-22, flux étapes 1-2) :
//   brouillon (RPC) → émission = numéro (RPC) → carte marquée facturée →
//   PDF (react-pdf, fourni par l'appelant) → Storage → pdf_path.
// L'ordre compte : dès que le numéro est attribué la facture existe légalement,
// donc la carte est marquée AVANT le PDF ; un échec aval remonte un message qui
// dit ce qui EST fait (jamais « rien ne s'est passé » quand un numéro a été
// consommé). Contrat mutation : unwrapResult → mutateAsync rejette sur { error }.
// ============================================================================
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoicesService } from '@services/invoices.service';
import { savService } from '@services/sav.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { buildInvoicePdfModel, invoiceErrorMessage } from '@/lib/invoiceDocumentModel';
import { invoiceKeys, entretienSavKeys, pennylaneKeys } from './cacheKeys';

export { invoiceKeys };

/**
 * @param {string} orgId  org CORE
 */
export function useIssueEntretienInvoice(orgId) {
  const queryClient = useQueryClient();
  return useMutation({
    /**
     * @param {object} p
     * @param {{ invoice: object, lines: object[] }} p.draft  `buildInvoiceDraft(...)`
     * @param {string} p.numberPrefix
     * @param {object} p.company  `buildCompanyInfo(settings)`
     * @param {object} p.invoicing  `invoicingSettings(settings)`
     * @param {(pdfModel: object, company: object) => Promise<Blob>} p.renderPdf
     * @param {string} p.interventionId
     * @param {string|null} p.invoicedAt
     * @param {{ enabled: boolean, clientId: string } | null} [p.pennylane]
     */
    mutationFn: async ({ draft, numberPrefix, company, invoicing, renderPdf, interventionId, invoicedAt, pennylane = null }) => {
      const invoiceId = await unwrapResult(invoicesService.createDraft(draft));
      const issued = await unwrapResult(invoicesService.issue(invoiceId, numberPrefix));
      const number = issued.number;

      const { error: cardError } = await savService.updateFields(interventionId, {
        invoice_id: invoiceId,
        invoiced_at: invoicedAt || new Date().toISOString(),
      });
      if (cardError) {
        // La facture existe déjà légalement (numéro attribué) : l'appelant ne doit pas
        // ré-émettre — `e.issued` porte l'identité déjà consommée (review round 1, 2026-09-22).
        const e = new Error(`Facture ${number} émise, mais la carte n’a pas pu être marquée facturée : ${invoiceErrorMessage(cardError, cardError.message || String(cardError))}`);
        e.issued = { invoiceId, number };
        throw e;
      }

      let pdfPath = null;
      let blob = null;
      try {
        const { invoice, lines } = await unwrapResult(invoicesService.getById(orgId, invoiceId));
        const pdfModel = buildInvoicePdfModel({ invoice, lines, company, invoicing });
        blob = await renderPdf(pdfModel, company);
        pdfPath = await unwrapResult(invoicesService.uploadPdf(orgId, invoice, blob));
        await unwrapResult(invoicesService.attachPdf(orgId, invoiceId, pdfPath));
      } catch (err) {
        const e = new Error(`Facture ${number} émise et carte marquée, mais le PDF n’a pas pu être archivé : ${invoiceErrorMessage(err, err?.message || String(err))}`);
        e.issued = { invoiceId, number };
        throw e;
      }

      // Import Pennylane (phase 2) : jamais bloquant — la facture est émise et archivée,
      // un import raté se rejoue depuis la carte (import_status = error + message).
      let pennylaneInvoiceId = null;
      let importWarning = null;
      if (pennylane?.enabled && pennylane.clientId) {
        try {
          await unwrapResult(invoicesService.ensurePennylaneCustomer(orgId, pennylane.clientId));
          const imported = await unwrapResult(invoicesService.importToPennylane(orgId, invoiceId));
          pennylaneInvoiceId = imported?.pennylane_invoice_id ?? null;
        } catch (err) {
          importWarning = `Facture ${number} émise et archivée, mais pas encore importée dans Pennylane (à rejouer depuis la carte) : ${invoiceErrorMessage(err, err?.message || String(err))}`;
        }
      }
      return { invoiceId, number, pdfPath, blob, pennylaneInvoiceId, importWarning };
    },
    onSettled: () => {
      // Même en échec partiel, la carte et la facture ont pu changer : on rafraîchit.
      queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.all(orgId) });
    },
  });
}

/**
 * Rejeu de l'export d'une facture ÉMISE : régénère et archive le PDF s'il manque, puis
 * importe dans Pennylane si l'org l'a activé et que la facture n'y est pas encore.
 * Idempotent : rien n'est recréé pour ce qui existe déjà.
 * @param {string} orgId  org CORE
 */
export function useRetryInvoiceExport(orgId) {
  const queryClient = useQueryClient();
  return useMutation({
    /**
     * @param {object} p
     * @param {string} p.invoiceId
     * @param {string|null} p.clientId
     * @param {object} p.company  `buildCompanyInfo(settings)`
     * @param {object} p.invoicing  `invoicingSettings(settings)`
     * @param {(pdfModel: object, company: object) => Promise<Blob>} p.renderPdf
     * @param {boolean} p.pennylaneEnabled
     */
    mutationFn: async ({ invoiceId, clientId, company, invoicing, renderPdf, pennylaneEnabled }) => {
      const { invoice, lines } = await unwrapResult(invoicesService.getById(orgId, invoiceId));
      if (invoice.status !== 'issued') throw new Error('invoice_not_issued');
      let pdfRegenerated = false;
      if (!invoice.pdf_path) {
        const pdfModel = buildInvoicePdfModel({ invoice, lines, company, invoicing });
        const blob = await renderPdf(pdfModel, company);
        const pdfPath = await unwrapResult(invoicesService.uploadPdf(orgId, invoice, blob));
        await unwrapResult(invoicesService.attachPdf(orgId, invoiceId, pdfPath));
        pdfRegenerated = true;
      }
      let imported = false;
      let alreadyImported = Boolean(invoice.pennylane_invoice_id);
      if (pennylaneEnabled && !alreadyImported) {
        if (!clientId) throw new Error('customer_not_synced');
        await unwrapResult(invoicesService.ensurePennylaneCustomer(orgId, clientId));
        const res = await unwrapResult(invoicesService.importToPennylane(orgId, invoiceId));
        alreadyImported = Boolean(res?.already);
        imported = !alreadyImported;
      }
      return { number: invoice.number, pdfRegenerated, imported, alreadyImported };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.all(orgId) });
    },
  });
}
