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
     * @param {{ enabled: boolean } | null} [p.pennylane]  déclenche l'import si activé ; le
     *   client importé est TOUJOURS celui de la facture (`draft.invoice.client_id`), jamais un
     *   client fourni par l'appelant (review round 1, 2026-09-23).
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
      // un import raté se rejoue depuis la carte (import_status pending ou error).
      let pennylaneInvoiceId = null;
      let importWarning = null;
      if (pennylane?.enabled) {
        const pennylaneClientId = draft?.invoice?.client_id || null;
        if (!pennylaneClientId) {
          importWarning = `Facture ${number} émise et archivée, mais sans client rattaché : import Pennylane impossible.`;
        } else {
          try {
            await unwrapResult(invoicesService.ensurePennylaneCustomer(orgId, pennylaneClientId));
            const imported = await unwrapResult(invoicesService.importToPennylane(orgId, invoiceId));
            pennylaneInvoiceId = imported?.pennylane_invoice_id ?? null;
          } catch (err) {
            importWarning = `Facture ${number} émise et archivée, mais pas encore importée dans Pennylane (à rejouer depuis la carte) : ${invoiceErrorMessage(err, err?.message || String(err))}`;
          }
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
 * Annulation d'une facture émise par un avoir (phase 3). L'avoir est émis par la base
 * (même série), la carte redevient facturable, le PDF est archivé, l'import Pennylane
 * enchaîné sans jamais faire échouer l'annulation. Erreurs post-RPC : `err.issued`.
 * @param {string} orgId  org CORE
 */
export function useCancelInvoiceWithCreditNote(orgId) {
  const queryClient = useQueryClient();
  return useMutation({
    /**
     * @param {object} p
     * @param {string} p.invoiceId
     * @param {string|null} p.interventionId
     * @param {string} p.numberPrefix
     * @param {string} [p.reason]
     * @param {object} p.company  `buildCompanyInfo(settings)`
     * @param {object} p.invoicing  `invoicingSettings(settings)`
     * @param {(pdfModel: object, company: object) => Promise<Blob>} p.renderPdf
     * @param {boolean} p.pennylaneEnabled
     */
    mutationFn: async ({ invoiceId, interventionId, numberPrefix, reason, company, invoicing, renderPdf, pennylaneEnabled }) => {
      const res = await unwrapResult(invoicesService.cancelWithCreditNote(orgId, invoiceId, numberPrefix, reason));
      const creditNoteId = res.credit_note_id;
      const number = res.number;
      const fail = (message) => { const e = new Error(message); e.issued = { creditNoteId, number }; return e; };
      if (interventionId) {
        const { error: cardError } = await savService.updateFields(interventionId, { invoice_id: null, invoiced_at: null });
        if (cardError) throw fail(`Avoir ${number} émis, mais la carte n’a pas pu être remise à facturer : ${invoiceErrorMessage(cardError, cardError.message || String(cardError))}`);
      }
      let invoiceRow = null;
      let pdfPath = null;
      let blob = null;
      try {
        const { invoice, lines } = await unwrapResult(invoicesService.getById(orgId, creditNoteId));
        invoiceRow = invoice;
        blob = await renderPdf(buildInvoicePdfModel({ invoice, lines, company, invoicing }), company);
        pdfPath = await unwrapResult(invoicesService.uploadPdf(orgId, invoice, blob));
        await unwrapResult(invoicesService.attachPdf(orgId, creditNoteId, pdfPath));
      } catch (err) {
        throw fail(`Avoir ${number} émis et carte remise à facturer, mais le PDF n’a pas pu être archivé : ${invoiceErrorMessage(err, err?.message || String(err))}`);
      }
      let importWarning = null;
      if (pennylaneEnabled) {
        try {
          if (!invoiceRow.client_id) throw new Error('invoice_without_client');
          await unwrapResult(invoicesService.ensurePennylaneCustomer(orgId, invoiceRow.client_id));
          const imported = await unwrapResult(invoicesService.importToPennylane(orgId, creditNoteId));
          if (Array.isArray(imported?.warnings) && imported.warnings.includes('credited_invoice_not_imported')) {
            importWarning = invoiceErrorMessage(new Error('credited_invoice_not_imported'));
          }
        } catch (err) {
          // Contrairement à une facture (bouton « Import Pennylane à rejouer » tant que
          // invoice_id reste posé sur la carte), un avoir n'a pas de surface de rejeu : la
          // carte est déjà remise à NULL (review round 1, 2026-09-23) — le message doit dire
          // que c'est définitif côté carte, pas promettre un retry qui n'apparaîtra jamais.
          importWarning = `Avoir ${number} émis et archivé, mais son import Pennylane a échoué : à saisir dans Pennylane (aucun rejeu possible depuis la carte pour un avoir) — ${invoiceErrorMessage(err, err?.message || String(err))}`;
        }
      }
      return { creditNoteId, number, creditedNumber: res.credited_number, blob, pdfPath, importWarning };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.all(orgId) });
    },
  });
}

/**
 * Envoi de la facture d'entretien au client par e-mail (Resend, edge `invoice-send`), pièces
 * jointes = certificats cochés. Module Communication requis (gate côté modèle pur
 * `invoiceEmailAvailability`, vérifié aussi côté edge).
 * @param {string} orgId  org CORE
 */
export function useSendInvoiceEmail(orgId) {
  return useMutation({
    mutationFn: ({ interventionId, certificateIds }) =>
      unwrapResult(invoicesService.sendByEmail(orgId, { interventionId, certificateIds })),
  });
}

/**
 * Rejeu de l'export d'une facture ÉMISE : régénère et archive le PDF s'il manque, puis
 * importe dans Pennylane si l'org l'a activé et que l'import n'est pas complet — soit parce que
 * la facture n'y est pas encore, soit parce qu'un `pennylane_invoice_id` existe mais que
 * `import_status` n'est pas `imported` (fix round 2, 2026-09-23 : c'est exactement l'état que la
 * branche `repaired` de l'edge cible — sans ce 2ᵉ cas, le bouton de rejeu reste amber pour
 * toujours puisque `pennylane_invoice_id` seul suffisait à couper l'appel).
 * Idempotent : rien n'est recréé pour ce qui existe déjà.
 * @param {string} orgId  org CORE
 */
export function useRetryInvoiceExport(orgId) {
  const queryClient = useQueryClient();
  return useMutation({
    /**
     * @param {object} p
     * @param {string} p.invoiceId
     * @param {object} p.company  `buildCompanyInfo(settings)`
     * @param {object} p.invoicing  `invoicingSettings(settings)`
     * @param {(pdfModel: object, company: object) => Promise<Blob>} p.renderPdf
     * @param {boolean} p.pennylaneEnabled
     */
    mutationFn: async ({ invoiceId, company, invoicing, renderPdf, pennylaneEnabled }) => {
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
      let alreadyImported = Boolean(invoice.pennylane_invoice_id) && invoice.import_status === 'imported';
      // Fix round 2 (2026-09-23) : `pennylane_invoice_id` seul ne suffit pas à couper l'appel —
      // un id posé avec `import_status` pending/error (crash entre le POST PL et l'écriture RPC,
      // cf. finding I4 de l'edge) doit rappeler l'edge pour que sa branche `repaired` s'exécute.
      const needsImport = pennylaneEnabled && (!invoice.pennylane_invoice_id || invoice.import_status !== 'imported');
      if (needsImport) {
        // Le client importé est TOUJOURS celui de la facture, jamais un client fourni par
        // l'appelant (review round 1, 2026-09-23). Absence de client ≠ client pas encore
        // synchronisé Pennylane : deux causes distinctes, deux messages distincts (finding
        // minor, revue finale 2026-09-22).
        if (!invoice.client_id) throw new Error('invoice_without_client');
        await unwrapResult(invoicesService.ensurePennylaneCustomer(orgId, invoice.client_id));
        const res = await unwrapResult(invoicesService.importToPennylane(orgId, invoiceId));
        // `recovered` = la facture existait déjà côté PL (probe anti-doublon) et cet appel vient
        // de la réconcilier ; `repaired` = l'id PL existait déjà mais import_status a été corrigé
        // maintenant (fix round 2) — les deux sont un travail fait maintenant, pas un no-op.
        alreadyImported = Boolean(res?.already) && !res?.recovered && !res?.repaired;
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
