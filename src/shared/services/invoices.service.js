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

export const invoicesService = {
  createDraft: (params) => withErrorHandling(() => createDraft(params), 'invoices.createDraft'),
  issue: (invoiceId, numberPrefix) => withErrorHandling(() => issue(invoiceId, numberPrefix), 'invoices.issue'),
  getById: (orgId, invoiceId) => withErrorHandling(() => getById(orgId, invoiceId), 'invoices.getById'),
  uploadPdf: (orgId, invoice, blob) => withErrorHandling(() => uploadPdf(orgId, invoice, blob), 'invoices.uploadPdf'),
  attachPdf: (orgId, invoiceId, pdfPath) => withErrorHandling(() => attachPdf(orgId, invoiceId, pdfPath), 'invoices.attachPdf'),
};
