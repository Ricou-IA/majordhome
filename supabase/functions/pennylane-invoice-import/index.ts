// supabase/functions/pennylane-invoice-import/index.ts
// ============================================================================
// Hub de facturation — phase 2 : importe dans Pennylane une facture ÉMISE par
// Majord'home (spec 2026-09-22, § Flux étape 3). Journal de ventes principal :
// aucun déplacement d'écriture (refusé par l'API, phase 0).
//   1. facture + lignes (client admin, filtre org) ; déjà importée ⇒ already
//   2. client Pennylane = mapping pennylane_sync type client (jamais du payload)
//   3. PDF archivé (bucket invoices) → POST /file_attachments (multipart)
//   4. POST /customer_invoices/import : notre numéro, external_reference = id
//      facture (unique), lignes et montants au centime tels qu'enregistrés
//   5. résultat → RPC invoice_set_import_result (service_role) + pennylane_sync
// Toute écriture lit { error } ; un échec Pennylane est ENREGISTRÉ (import_status
// = error + message) puis répondu 502 : visible et rejouable, jamais silencieux.
// Auth : verify_jwt + requireOrgMembership(team_leader+, org Pennylane activée).
// ============================================================================
import { requireOrgMembership, jsonResponse, corsHeaders, sanitizeError } from "../_shared/auth.ts";

const PENNYLANE_API_TOKEN = Deno.env.get("PENNYLANE_API_TOKEN") || "";
const PENNYLANE_BASE_URL = Deno.env.get("PENNYLANE_BASE_URL") || "https://app.pennylane.com/api/external/v2";
const INVOICES_BUCKET = "invoices";

interface Body { invoice_id?: string; org_id?: string }

async function pl(method: string, path: string, body?: unknown, form?: FormData) {
  const headers: Record<string, string> = { Authorization: `Bearer ${PENNYLANE_API_TOKEN}`, Accept: "application/json" };
  const init: RequestInit = { method, headers };
  if (form) init.body = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(`${PENNYLANE_BASE_URL}${path}`, init);
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

/** Montant Pennylane = chaîne à 2 décimales. */
const money = (n: unknown) => Number(n ?? 0).toFixed(2);
/** PU HT ≤ 6 décimales, sans zéros de queue (schéma PL, vécu 2026-09-22). */
const unitPrice = (n: unknown) => Number(n ?? 0).toFixed(6).replace(/\.?0+$/, "") || "0";
const plError = (data: unknown) => (typeof data === "string" ? data : JSON.stringify(data ?? {})).slice(0, 1500);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: Body;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Corps JSON invalide" }, 400); }
  if (!body.invoice_id || !body.org_id) return jsonResponse({ error: "invoice_id et org_id sont requis" }, 400);

  const auth = await requireOrgMembership(req, {
    orgId: body.org_id,
    requiredRole: "team_leader",
    orgSettingsFilter: (s) => (s.pennylane as { enabled?: boolean } | undefined)?.enabled === true,
  });
  if (!auth.ok) return auth.response;
  if (!PENNYLANE_API_TOKEN) return jsonResponse({ error: "PENNYLANE_API_TOKEN manquant" }, 500);
  const { supabase, orgId, userId } = auth;

  const recordResult = async (status: "imported" | "error", plId: number | null, ledgerId: number | null, error: string | null) => {
    const { error: rpcError } = await supabase.rpc("invoice_set_import_result", {
      p_invoice_id: body.invoice_id, p_status: status, p_pennylane_invoice_id: plId,
      p_pennylane_ledger_entry_id: ledgerId, p_error: error,
    });
    return rpcError ? sanitizeError(rpcError, "invoice_set_import_result failed") : null;
  };

  try {
    // 1. Facture + lignes
    const { data: invoice, error: invErr } = await supabase
      .from("majordhome_invoices").select("*").eq("id", body.invoice_id).eq("org_id", orgId).maybeSingle();
    if (invErr) return jsonResponse({ error: sanitizeError(invErr, "lecture facture") }, 500);
    if (!invoice) return jsonResponse({ error: "invoice_not_found" }, 404);
    if (invoice.status !== "issued") return jsonResponse({ error: "invoice_not_issued", status: invoice.status }, 409);
    if (invoice.pennylane_invoice_id) {
      return jsonResponse({ ok: true, already: true, pennylane_invoice_id: invoice.pennylane_invoice_id }, 200);
    }
    if (!invoice.pdf_path) return jsonResponse({ error: "pdf_missing" }, 409);

    const { data: lines, error: linesErr } = await supabase
      .from("majordhome_invoice_lines").select("*").eq("invoice_id", invoice.id).eq("org_id", orgId).order("position");
    if (linesErr) return jsonResponse({ error: sanitizeError(linesErr, "lecture lignes") }, 500);
    if (!lines || lines.length === 0) return jsonResponse({ error: "lines_required" }, 409);

    // 2. Client Pennylane (mapping posé par le front via getOrCreateCustomer)
    const { data: sync, error: syncErr } = await supabase
      .from("majordhome_pennylane_sync").select("pennylane_id")
      .eq("org_id", orgId).eq("entity_type", "client").eq("local_id", invoice.client_id).maybeSingle();
    if (syncErr) return jsonResponse({ error: sanitizeError(syncErr, "lecture mapping client") }, 500);
    if (!sync?.pennylane_id) return jsonResponse({ error: "customer_not_synced" }, 409);

    // 3. PDF archivé → Pennylane
    const { data: file, error: dlErr } = await supabase.storage.from(INVOICES_BUCKET).download(invoice.pdf_path);
    if (dlErr || !file) {
      const msg = `pdf_download_failed: ${sanitizeError(dlErr, "download")}`;
      await recordResult("error", null, null, msg);
      return jsonResponse({ error: "pdf_missing", detail: msg }, 409);
    }
    const form = new FormData();
    const filename = `${invoice.number}.pdf`;
    form.append("file", new Blob([await file.arrayBuffer()], { type: "application/pdf" }), filename);
    form.append("filename", filename);
    const up = await pl("POST", "/file_attachments", undefined, form);
    if (up.status >= 300) {
      const detail = plError(up.data);
      await recordResult("error", null, null, `file_attachment ${up.status}: ${detail}`);
      return jsonResponse({ error: "pennylane_import_failed", step: "file_attachment", status: up.status, detail }, 502);
    }
    const fileAttachmentId = (up.data as { id?: number })?.id;

    // 4. Import : montants ENREGISTRÉS, jamais recalculés
    const payload = {
      file_attachment_id: fileAttachmentId,
      date: invoice.invoice_date,
      deadline: invoice.due_at || invoice.invoice_date,
      customer_id: Number(sync.pennylane_id),
      currency: "EUR",
      currency_amount_before_tax: money(invoice.total_ht),
      currency_amount: money(invoice.total_ttc),
      currency_tax: money(invoice.total_tva),
      label: invoice.subject || invoice.number,
      invoice_number: invoice.number,
      external_reference: invoice.id,
      invoice_lines: lines.map((l: Record<string, unknown>) => ({
        label: l.description ? `${l.label} — ${l.description}` : l.label,
        quantity: Number(l.quantity),
        unit: "piece",
        raw_currency_unit_price: unitPrice(l.unit_price_ht),
        vat_rate: (l.vat_code as string) || "FR_200",
        currency_amount: money(l.ttc),
        currency_tax: money(l.tva),
        ...(l.ledger_account_pl_id ? { ledger_account_id: Number(l.ledger_account_pl_id) } : {}),
      })),
    };
    const imported = await pl("POST", "/customer_invoices/import", payload);
    console.log(`[pennylane-invoice-import] ${imported.status} invoice=${invoice.number} by ${userId} (org ${orgId}) → ${JSON.stringify(imported.data).slice(0, 1500)}`);
    if (imported.status >= 300) {
      const detail = plError(imported.data);
      await recordResult("error", null, null, `import ${imported.status}: ${detail}`);
      return jsonResponse({ error: "pennylane_import_failed", step: "import", status: imported.status, detail }, 502);
    }
    const plInvoice = imported.data as { id?: number; ledger_entry?: { id?: number }; public_file_url?: string; file_url?: string };
    if (!plInvoice?.id) {
      await recordResult("error", null, null, "import: réponse Pennylane sans id");
      return jsonResponse({ error: "pennylane_import_failed", step: "import", detail: "réponse sans id" }, 502);
    }
    const ledgerEntryId = plInvoice.ledger_entry?.id ?? null;

    // 5. Résultat (la facture Pennylane EXISTE désormais : tout échec ici est répondu avec son id)
    const rpcFail = await recordResult("imported", plInvoice.id, ledgerEntryId, null);
    if (rpcFail) {
      console.error(`[pennylane-invoice-import] invoice_set_import_result failed for ${invoice.number} (PL ${plInvoice.id}): ${rpcFail}`);
      return jsonResponse({ error: "import_recorded_failed", pennylane_invoice_id: plInvoice.id, detail: rpcFail }, 500);
    }
    const { error: upsertErr } = await supabase.from("majordhome_pennylane_sync").upsert({
      org_id: orgId, entity_type: "invoice", local_id: invoice.id,
      pennylane_id: plInvoice.id, pennylane_number: invoice.number, external_reference: invoice.id,
      sync_status: "synced", last_synced_at: new Date().toISOString(),
      metadata: { source: "hub", intervention_id: invoice.intervention_id, public_file_url: plInvoice.public_file_url ?? null, file_url: plInvoice.file_url ?? null, ledger_entry_id: ledgerEntryId },
    }, { onConflict: "org_id,entity_type,local_id" });
    const syncWarning = upsertErr ? sanitizeError(upsertErr, "pennylane_sync upsert") : null;
    if (syncWarning) console.error(`[pennylane-invoice-import] pennylane_sync upsert failed for ${invoice.number}: ${syncWarning}`);

    return jsonResponse({
      ok: true, pennylane_invoice_id: plInvoice.id, ledger_entry_id: ledgerEntryId,
      public_file_url: plInvoice.public_file_url ?? null, ...(syncWarning ? { sync_warning: syncWarning } : {}),
    }, 201);
  } catch (err) {
    console.error("[pennylane-invoice-import] Error:", err);
    return jsonResponse({ error: sanitizeError(err, "Internal error") }, 500);
  }
});
