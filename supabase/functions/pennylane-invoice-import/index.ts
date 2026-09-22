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
import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError } from "../_shared/auth.ts";

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  let body: Body;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Corps JSON invalide" }, 400, req); }
  if (!body.invoice_id || !body.org_id) return jsonResponse({ error: "invoice_id et org_id sont requis" }, 400, req);

  const auth = await requireOrgMembership(req, {
    orgId: body.org_id,
    requiredRole: "team_leader",
    orgSettingsFilter: (s) => (s.pennylane as { enabled?: boolean } | undefined)?.enabled === true,
  });
  if (!auth.ok) return auth.response;
  if (!PENNYLANE_API_TOKEN) return jsonResponse({ error: "PENNYLANE_API_TOKEN manquant" }, 500, req);
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
    if (invErr) return jsonResponse({ error: sanitizeError(invErr, "lecture facture") }, 500, req);
    if (!invoice) return jsonResponse({ error: "invoice_not_found" }, 404, req);
    if (invoice.status !== "issued") return jsonResponse({ error: "invoice_not_issued", status: invoice.status }, 409, req);
    if (invoice.pennylane_invoice_id) {
      return jsonResponse({ ok: true, already: true, pennylane_invoice_id: invoice.pennylane_invoice_id }, 200, req);
    }
    if (!invoice.pdf_path) {
      const recordError = await recordResult("error", null, null, "pdf_missing");
      if (recordError) console.error(`[pennylane-invoice-import] record failed for ${invoice.number}: ${recordError}`);
      return jsonResponse({ error: "pdf_missing", ...(recordError ? { record_error: recordError } : {}) }, 409, req);
    }

    const { data: lines, error: linesErr } = await supabase
      .from("majordhome_invoice_lines").select("*").eq("invoice_id", invoice.id).eq("org_id", orgId).order("position");
    if (linesErr) return jsonResponse({ error: sanitizeError(linesErr, "lecture lignes") }, 500, req);
    if (!lines || lines.length === 0) {
      const recordError = await recordResult("error", null, null, "lines_required");
      if (recordError) console.error(`[pennylane-invoice-import] record failed for ${invoice.number}: ${recordError}`);
      return jsonResponse({ error: "lines_required", ...(recordError ? { record_error: recordError } : {}) }, 409, req);
    }

    // 2. Client Pennylane (mapping posé par le front via getOrCreateCustomer)
    const { data: sync, error: syncErr } = await supabase
      .from("majordhome_pennylane_sync").select("pennylane_id")
      .eq("org_id", orgId).eq("entity_type", "client").eq("local_id", invoice.client_id).maybeSingle();
    if (syncErr) return jsonResponse({ error: sanitizeError(syncErr, "lecture mapping client") }, 500, req);
    if (!sync?.pennylane_id) {
      const recordError = await recordResult("error", null, null, "customer_not_synced");
      if (recordError) console.error(`[pennylane-invoice-import] record failed for ${invoice.number}: ${recordError}`);
      return jsonResponse({ error: "customer_not_synced", ...(recordError ? { record_error: recordError } : {}) }, 409, req);
    }

    // 3. PDF archivé → Pennylane
    const { data: file, error: dlErr } = await supabase.storage.from(INVOICES_BUCKET).download(invoice.pdf_path);
    if (dlErr || !file) {
      const msg = `pdf_download_failed: ${sanitizeError(dlErr, "download")}`;
      const recordError = await recordResult("error", null, null, msg);
      if (recordError) console.error(`[pennylane-invoice-import] record failed for ${invoice.number}: ${recordError}`);
      return jsonResponse({ error: "pdf_missing", detail: msg, ...(recordError ? { record_error: recordError } : {}) }, 409, req);
    }
    const form = new FormData();
    const filename = `${invoice.number}.pdf`;
    form.append("file", file, filename);
    form.append("filename", filename);
    const up = await pl("POST", "/file_attachments", undefined, form);
    if (up.status >= 300) {
      const detail = plError(up.data);
      const recordError = await recordResult("error", null, null, `file_attachment ${up.status}: ${detail}`);
      if (recordError) console.error(`[pennylane-invoice-import] record failed for ${invoice.number}: ${recordError}`);
      return jsonResponse({ error: "pennylane_import_failed", step: "file_attachment", status: up.status, detail, ...(recordError ? { record_error: recordError } : {}) }, 502, req);
    }
    const fileAttachmentId = (up.data as { id?: number })?.id;
    if (!fileAttachmentId) {
      const msg = "file_attachment: réponse Pennylane sans id";
      const recordError = await recordResult("error", null, null, msg);
      if (recordError) console.error(`[pennylane-invoice-import] record failed for ${invoice.number}: ${recordError}`);
      return jsonResponse({ error: "pennylane_import_failed", step: "file_attachment", detail: msg, ...(recordError ? { record_error: recordError } : {}) }, 502, req);
    }

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
        // invoice_lines n'a pas d'unité (V1 entretien) : 'piece' pour toutes les lignes.
        unit: "piece",
        raw_currency_unit_price: unitPrice(l.unit_price_ht),
        vat_rate: (l.vat_code as string) || "FR_200",
        currency_amount: money(l.ttc),
        currency_tax: money(l.tva),
        ...(l.ledger_account_pl_id ? { ledger_account_id: Number(l.ledger_account_pl_id) } : {}),
      })),
    };

    // Garde anti-doublon : un échec réseau après le POST (réponse jamais lue)
    // ne doit pas relancer un import — la facture peut déjà exister côté PL.
    // Le probe est un GARDE-FOU, pas un GATE : son échec ne bloque pas l'import.
    try {
      const probeFilter = encodeURIComponent(JSON.stringify([{ field: "external_reference", operator: "eq", value: invoice.id }]));
      const probe = await pl("GET", `/customer_invoices?limit=1&filter=${probeFilter}`);
      if (probe.status < 300) {
        const existing = ((probe.data as { items?: Array<{ id?: number; ledger_entry?: { id?: number } }> })?.items || [])[0];
        if (existing?.id) {
          const recordError = await recordResult("imported", existing.id, existing.ledger_entry?.id ?? null, null);
          if (recordError) console.error(`[pennylane-invoice-import] record failed for ${invoice.number}: ${recordError}`);
          return jsonResponse({ ok: true, already: true, pennylane_invoice_id: existing.id, recovered: true, ...(recordError ? { record_error: recordError } : {}) }, 200, req);
        }
      } else {
        console.error(`[pennylane-invoice-import] probe failed for ${invoice.number}: HTTP ${probe.status}`);
      }
    } catch (probeErr) {
      console.error(`[pennylane-invoice-import] probe threw for ${invoice.number}:`, probeErr);
    }

    const imported = await pl("POST", "/customer_invoices/import", payload);
    console.log(`[pennylane-invoice-import] ${imported.status} invoice=${invoice.number} by ${userId} (org ${orgId}) → ${JSON.stringify(imported.data).slice(0, 1500)}`);
    if (imported.status >= 300) {
      const detail = plError(imported.data);
      const recordError = await recordResult("error", null, null, `import ${imported.status}: ${detail}`);
      if (recordError) console.error(`[pennylane-invoice-import] record failed for ${invoice.number}: ${recordError}`);
      return jsonResponse({ error: "pennylane_import_failed", step: "import", status: imported.status, detail, ...(recordError ? { record_error: recordError } : {}) }, 502, req);
    }
    const plInvoice = imported.data as { id?: number; ledger_entry?: { id?: number }; public_file_url?: string; file_url?: string };
    if (!plInvoice?.id) {
      const recordError = await recordResult("error", null, null, "import: réponse Pennylane sans id");
      if (recordError) console.error(`[pennylane-invoice-import] record failed for ${invoice.number}: ${recordError}`);
      return jsonResponse({ error: "pennylane_import_failed", step: "import", detail: "réponse sans id", ...(recordError ? { record_error: recordError } : {}) }, 502, req);
    }
    let ledgerEntryId = plInvoice.ledger_entry?.id ?? null;
    if (!ledgerEntryId) {
      const back = await pl("GET", `/customer_invoices/${plInvoice.id}`);
      ledgerEntryId = (back.data as { ledger_entry?: { id?: number } })?.ledger_entry?.id ?? null;
    }

    // 5. Résultat (la facture Pennylane EXISTE désormais : tout échec ici est répondu avec son id)
    const rpcFail = await recordResult("imported", plInvoice.id, ledgerEntryId, null);
    if (rpcFail) {
      console.error(`[pennylane-invoice-import] invoice_set_import_result failed for ${invoice.number} (PL ${plInvoice.id}): ${rpcFail}`);
      return jsonResponse({ error: "import_recorded_failed", pennylane_invoice_id: plInvoice.id, detail: rpcFail }, 500, req);
    }
    const { error: upsertErr } = await supabase.from("majordhome_pennylane_sync").upsert({
      org_id: orgId, entity_type: "invoice", local_id: invoice.id,
      pennylane_id: plInvoice.id, pennylane_number: invoice.number, external_reference: invoice.id,
      sync_status: "synced", last_synced_at: new Date().toISOString(),
      metadata: { source: "hub", intervention_id: invoice.intervention_id, public_file_url: plInvoice.public_file_url ?? null, file_url: plInvoice.file_url ?? null, ledger_entry_id: ledgerEntryId },
    }, { onConflict: "org_id,entity_type,local_id" });
    const syncWarning = upsertErr ? sanitizeError(upsertErr, "pennylane_sync upsert") : null;
    if (syncWarning) console.error(`[pennylane-invoice-import] pennylane_sync upsert failed for ${invoice.number}: ${syncWarning}`);

    const warnings: string[] = [];
    if (lines.some((l: Record<string, unknown>) => !l.ledger_account_pl_id)) warnings.push("compte_manquant");

    return jsonResponse({
      ok: true, pennylane_invoice_id: plInvoice.id, ledger_entry_id: ledgerEntryId,
      public_file_url: plInvoice.public_file_url ?? null, warnings, ...(syncWarning ? { sync_warning: syncWarning } : {}),
    }, 201, req);
  } catch (err) {
    console.error("[pennylane-invoice-import] Error:", err);
    let recordError: string | null = null;
    try {
      recordError = await recordResult("error", null, null, `exception: ${sanitizeError(err, "Internal error")}`);
      if (recordError) console.error(`[pennylane-invoice-import] record failed in catch: ${recordError}`);
    } catch (recordErr) {
      console.error("[pennylane-invoice-import] recordResult threw in catch:", recordErr);
    }
    return jsonResponse({ error: sanitizeError(err, "Internal error"), ...(recordError ? { record_error: recordError } : {}) }, 500, req);
  }
});
