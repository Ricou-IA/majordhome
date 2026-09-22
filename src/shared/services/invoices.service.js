/**
 * invoices.service.js — factures émises par Majord'home (hub de facturation, phase 1)
 * ============================================================================
 * Lecture via les vues `majordhome_invoices` / `majordhome_invoice_lines`
 * (security_invoker, RLS org) ; écriture UNIQUEMENT via les RPC
 * `invoice_create_draft` (brouillon atomique) et `invoice_issue` (numéro sous
 * verrou, gel) ; `pdf_path` posé après émission (colonne de suivi autorisée par
 * le trigger d'immuabilité). PDF archivé dans le bucket `invoices` sous
 * `${orgId}/${année}/${numéro}.pdf`. Contrat : { data, error }, jamais throw.
 * ============================================================================
 */
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling, extractRpcResult } from '@/lib/serviceHelpers';
import { storageService } from './storage.service';
import { pennylaneService } from './pennylane.service';
import { clientsService } from './clients.service';

export const INVOICES_BUCKET = 'invoices';

async function createDraft({ invoice, lines }) {
  const { data, error } = await supabase.rpc('invoice_create_draft', { p_invoice: invoice, p_lines: lines });
  if (error) throw error;
  return extractRpcResult(data);
}

async function issue(invoiceId, numberPrefix) {
  const { data, error } = await supabase.rpc('invoice_issue', { p_invoice_id: invoiceId, p_number_prefix: numberPrefix });
  if (error) throw error;
  return extractRpcResult(data);
}

async function getById(orgId, invoiceId) {
  const { data: invoice, error } = await supabase
    .from('majordhome_invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!invoice) throw new Error('Facture introuvable');
  const { data: lines, error: linesError } = await supabase
    .from('majordhome_invoice_lines')
    .select('*')
    .eq('invoice_id', invoiceId)
    .eq('org_id', orgId)
    .order('position', { ascending: true });
  if (linesError) throw linesError;
  return { invoice, lines: lines || [] };
}

/** Chemin canonique du PDF archivé. */
export function invoicePdfPath(orgId, invoice) {
  return `${orgId}/${invoice.year}/${invoice.number}.pdf`;
}

/**
 * URL signée du PDF archivé d'une facture (finding F4, revue finale 2026-09-22) : la carte
 * n'offrait aucun moyen de retrouver le PDF d'une facture déjà émise. `pdf_path` NULL = le PDF
 * n'a jamais été archivé (échec partiel de la chaîne d'émission, cf. useInvoices.js) — une
 * erreur explicite plutôt qu'un lien mort.
 */
async function getPdfUrl(orgId, invoiceId) {
  const { data: row, error } = await supabase
    .from('majordhome_invoices')
    .select('pdf_path')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!row?.pdf_path) throw new Error('PDF non archivé');
  const { url, error: signError } = await storageService.getSignedUrl(INVOICES_BUCKET, row.pdf_path, 600);
  if (signError) throw signError;
  return url;
}

async function uploadPdf(orgId, invoice, blob) {
  const path = invoicePdfPath(orgId, invoice);
  const { error } = await storageService.uploadFile(INVOICES_BUCKET, path, blob, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return path;
}

async function attachPdf(orgId, invoiceId, pdfPath) {
  const { data, error } = await supabase
    .from('majordhome_invoices')
    .update({ pdf_path: pdfPath })
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .select('id, pdf_path')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Facture introuvable (pdf_path non posé)');
  return data;
}

/**
 * Garantit la fiche Pennylane du client (mapping `pennylane_sync` type client) AVANT
 * l'import : l'edge ne prend jamais un customer_id du payload, elle relit le mapping.
 */
async function ensurePennylaneCustomer(orgId, clientId) {
  const { data: existing, error: syncError } = await pennylaneService.getSyncRecord(orgId, 'client', clientId);
  if (syncError) throw syncError;
  if (existing?.pennylane_id) return existing.pennylane_id;
  const { data: client, error: clientError } = await clientsService.getClientById(clientId);
  if (clientError) throw clientError;
  if (!client) throw new Error('Client introuvable');
  const { data: customerId, error } = await pennylaneService.getOrCreateCustomer(client, orgId);
  if (error) throw error;
  return customerId;
}

/** Appelle l'edge d'import ; l'erreur remonte le code de l'edge (`customer_not_synced`…) et l'étape. */
async function importToPennylane(orgId, invoiceId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Non authentifié');
  const { data, error } = await supabase.functions.invoke('pennylane-invoice-import', { body: { invoice_id: invoiceId, org_id: orgId } });
  if (error) {
    let detail = null;
    try { detail = await error.context?.json?.(); } catch { /* corps illisible */ }
    const err = new Error(detail?.error ? `${detail.error}${detail.step ? ` (étape ${detail.step})` : ''}${detail.detail ? ` — ${detail.detail}` : ''}` : error.message);
    err.code = detail?.error || null;
    err.step = detail?.step || null;
    throw err;
  }
  return data;
}

export const invoicesService = {
  createDraft: (params) => withErrorHandling(() => createDraft(params), 'invoices.createDraft'),
  issue: (invoiceId, numberPrefix) => withErrorHandling(() => issue(invoiceId, numberPrefix), 'invoices.issue'),
  getById: (orgId, invoiceId) => withErrorHandling(() => getById(orgId, invoiceId), 'invoices.getById'),
  getPdfUrl: (orgId, invoiceId) => withErrorHandling(() => getPdfUrl(orgId, invoiceId), 'invoices.getPdfUrl'),
  uploadPdf: (orgId, invoice, blob) => withErrorHandling(() => uploadPdf(orgId, invoice, blob), 'invoices.uploadPdf'),
  attachPdf: (orgId, invoiceId, pdfPath) => withErrorHandling(() => attachPdf(orgId, invoiceId, pdfPath), 'invoices.attachPdf'),
  ensurePennylaneCustomer: (orgId, clientId) => withErrorHandling(() => ensurePennylaneCustomer(orgId, clientId), 'invoices.ensurePennylaneCustomer'),
  importToPennylane: (orgId, invoiceId) => withErrorHandling(() => importToPennylane(orgId, invoiceId), 'invoices.importToPennylane'),
};
