// supabase/functions/pennylane-ledger-push/index.ts
// ============================================================================
// Pousse une ÉCRITURE COMPTABLE dans un journal Pennylane (POST /ledger_entries),
// avec sa pièce jointe PDF (POST /file_attachments, multipart — c'est pourquoi le
// proxy JSON ne suffit pas). Voie « logiciel de facturation tiers » documentée par
// Pennylane : une écriture de vente poussée dans un journal de type Ventes, avec
// une seule ligne 411, les comptes de TVA, un numéro de pièce et une pièce jointe,
// est convertie automatiquement en facture client par Pennylane (centre d'aide,
// article 301073). Spike du 2026-09-22 : vérifier que la conversion s'applique
// aux écritures poussées par l'API. Brique réutilisable pour le hub de facturation
// (spec 2026-09-22-majordhome-hub-facturation-import-pennylane-design.md).
//
// Auth : verify_jwt + requireOrgMembership org_admin, org Pennylane activée.
// Les comptes sont donnés par NUMÉRO (+ taux de TVA) et résolus ici en id
// (Pennylane décline chaque numéro par taux de TVA).
// ============================================================================
import { requireOrgMembership, jsonResponse, corsHeaders } from "../_shared/auth.ts";

const PENNYLANE_API_TOKEN = Deno.env.get("PENNYLANE_API_TOKEN") || "";
const PENNYLANE_BASE_URL = Deno.env.get("PENNYLANE_BASE_URL") || "https://app.pennylane.com/api/external/v2";

interface LineIn { account_number: string; vat_rate?: string | null; debit?: string | number; credit?: string | number; label?: string }
interface Body {
  /** `ledger_entry` (défaut) : écriture brute dans le journal. `import_invoice` : facture importée
   *  (PDF + montants exacts) puis déplacement de son écriture dans le journal (test 2, 2026-09-22). */
  mode?: "ledger_entry" | "import_invoice";
  journal_id: number;
  date: string;
  label: string;
  piece_number?: string;
  due_date?: string;
  lines: LineIn[];
  pdf_base64?: string;
  filename?: string;
  test_pdf_text?: string;
  /** import_invoice : client Pennylane + lignes de facture (montants en chaînes, cohérents au centime) */
  customer_id?: number;
  invoice_number?: string;
  external_reference?: string;
  invoice_lines?: Array<{ label: string; quantity: number; unit?: string; raw_currency_unit_price: string; vat_rate: string; currency_amount: string; currency_tax: string; account_number?: string }>;
  currency_amount_before_tax?: string;
  currency_amount?: string;
  currency_tax?: string;
}

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

/** Résout un numéro de compte (+ taux) en id : exact puis start_with ; déclinaison du taux, sinon `any`. */
async function resolveAccount(number: string, vatRate: string | null | undefined) {
  const filter = (op: string) => encodeURIComponent(JSON.stringify([{ field: "number", operator: op, value: number }]));
  let r = await pl("GET", `/ledger_accounts?limit=100&filter=${filter("eq")}`);
  let items = ((r.data as { items?: unknown[] })?.items || []) as Array<{ id: number; number: string; vat_rate?: string; enabled?: boolean }>;
  if (items.length === 0) {
    r = await pl("GET", `/ledger_accounts?limit=100&filter=${filter("start_with")}`);
    items = ((r.data as { items?: unknown[] })?.items || []) as typeof items;
  }
  items = items.filter((a) => a.enabled !== false);
  if (items.length === 0) throw new Error(`Compte ${number} introuvable dans Pennylane (HTTP ${r.status})`);
  const exact = vatRate ? items.find((a) => (a.vat_rate || "any") === vatRate) : null;
  const generic = items.find((a) => !a.vat_rate || a.vat_rate === "any");
  const chosen = exact || generic || items[0];
  return { id: chosen.id, number: chosen.number, vat_rate: chosen.vat_rate || "any" };
}

/** PDF minimal valide (une page, une ligne de texte) — pour le spike uniquement. */
function minimalPdf(text: string): Uint8Array {
  const esc = text.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7E]/g, "?");
  const content = `BT /F1 14 Tf 50 780 Td (${esc}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireOrgMembership(req, {
    requiredRole: "org_admin",
    orgSettingsFilter: (s) => (s.pennylane as { enabled?: boolean } | undefined)?.enabled === true,
  });
  if (!auth.ok) return auth.response;
  if (!PENNYLANE_API_TOKEN) return jsonResponse({ error: "PENNYLANE_API_TOKEN manquant" }, 500);

  let body: Body;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Corps JSON invalide" }, 400); }
  const { journal_id, date, label, piece_number, due_date, lines } = body;
  const mode = body.mode || "ledger_entry";
  if (!journal_id || !date || !label) return jsonResponse({ error: "journal_id, date et label sont requis" }, 400);
  if (mode === "ledger_entry" && (!Array.isArray(lines) || lines.length === 0)) {
    return jsonResponse({ error: "lines est requis en mode ledger_entry" }, 400);
  }

  const steps: Record<string, unknown> = {};

  // ---- Mode 2 : facture IMPORTÉE (PDF + montants) puis déplacement de l'écriture dans le journal ----
  if (mode === "import_invoice") {
    try {
      if (!body.customer_id || !Array.isArray(body.invoice_lines) || body.invoice_lines.length === 0) {
        return jsonResponse({ error: "customer_id et invoice_lines sont requis en mode import_invoice" }, 400);
      }
      const pdfBytes = body.pdf_base64
        ? Uint8Array.from(atob(body.pdf_base64), (c) => c.charCodeAt(0))
        : minimalPdf(body.test_pdf_text || label);
      const form = new FormData();
      const filename = body.filename || `${body.invoice_number || piece_number || "facture"}.pdf`;
      form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), filename);
      form.append("filename", filename);
      const up = await pl("POST", "/file_attachments", undefined, form);
      steps.file_attachment = { status: up.status, data: up.data };
      if (up.status >= 300) return jsonResponse({ error: "Envoi du fichier refusé par Pennylane", step: "file_attachment", steps }, 502);
      const fileAttachmentId = (up.data as { id?: number })?.id;

      const invoiceLines = [];
      for (const l of body.invoice_lines) {
        const line: Record<string, unknown> = {
          label: l.label, quantity: l.quantity, unit: l.unit || "piece",
          raw_currency_unit_price: l.raw_currency_unit_price, vat_rate: l.vat_rate,
          currency_amount: l.currency_amount, currency_tax: l.currency_tax,
        };
        if (l.account_number) line.ledger_account_id = (await resolveAccount(l.account_number, l.vat_rate)).id;
        invoiceLines.push(line);
      }
      const payload: Record<string, unknown> = {
        file_attachment_id: fileAttachmentId,
        date, deadline: due_date || date, customer_id: Number(body.customer_id), currency: "EUR",
        currency_amount_before_tax: body.currency_amount_before_tax, currency_amount: body.currency_amount, currency_tax: body.currency_tax,
        label, external_reference: body.external_reference || piece_number, invoice_lines: invoiceLines,
      };
      if (body.invoice_number) payload.invoice_number = body.invoice_number;
      const imported = await pl("POST", "/customer_invoices/import", payload);
      steps.import = { status: imported.status, data: imported.data, payload };
      console.log(`[pennylane-ledger-push] import ${imported.status} by ${auth.userId} → ${JSON.stringify(imported.data).slice(0, 2000)}`);
      if (imported.status >= 300) return jsonResponse({ error: "Import de facture refusé par Pennylane", step: "import", steps }, 502);

      const invoiceId = (imported.data as { id?: number })?.id;
      let ledgerEntryId = (imported.data as { ledger_entry?: { id?: number } })?.ledger_entry?.id ?? null;
      if (!ledgerEntryId && invoiceId) {
        const back = await pl("GET", `/customer_invoices/${invoiceId}`);
        steps.invoice_readback = { status: back.status, data: back.data };
        ledgerEntryId = (back.data as { ledger_entry?: { id?: number } })?.ledger_entry?.id ?? null;
      }
      let moved = false;
      if (ledgerEntryId) {
        const mv = await pl("PUT", `/ledger_entries/${ledgerEntryId}`, { journal_id: Number(journal_id) });
        steps.journal_move = { status: mv.status, data: mv.data };
        moved = mv.status < 300;
        const entry = await pl("GET", `/ledger_entries/${ledgerEntryId}`);
        steps.ledger_entry_readback = { status: entry.status, data: entry.data };
      } else {
        steps.journal_move = { skipped: "ledger_entry.id absent de la facture importée" };
      }
      console.log(`[pennylane-ledger-push] import invoice=${invoiceId} ledger_entry=${ledgerEntryId} moved=${moved} → ${JSON.stringify(steps.journal_move).slice(0, 1500)}`);
      return jsonResponse({ ok: true, mode, invoice_id: invoiceId ?? null, ledger_entry_id: ledgerEntryId, journal_moved: moved, steps }, 201);
    } catch (err) {
      console.error("[pennylane-ledger-push] import Error:", err);
      return jsonResponse({ error: err instanceof Error ? err.message : "Internal error", steps }, 500);
    }
  }

  try {
    // 1. Comptes par numéro → id (déclinaison TVA)
    const resolved: Array<{ id: number; number: string; vat_rate: string }> = [];
    const entryLines = [];
    for (const l of lines) {
      const acc = await resolveAccount(String(l.account_number), l.vat_rate ?? null);
      resolved.push(acc);
      entryLines.push({
        ledger_account_id: acc.id,
        debit: String(Number(l.debit || 0).toFixed(2)),
        credit: String(Number(l.credit || 0).toFixed(2)),
        ...(l.label ? { label: l.label } : {}),
      });
    }
    steps.accounts = resolved;

    // 2. Pièce jointe (multipart)
    let fileAttachmentId: number | null = null;
    const pdfBytes = body.pdf_base64
      ? Uint8Array.from(atob(body.pdf_base64), (c) => c.charCodeAt(0))
      : body.test_pdf_text ? minimalPdf(body.test_pdf_text) : null;
    if (pdfBytes) {
      const form = new FormData();
      const filename = body.filename || `${piece_number || "piece"}.pdf`;
      form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), filename);
      form.append("filename", filename);
      const up = await pl("POST", "/file_attachments", undefined, form);
      steps.file_attachment = { status: up.status, data: up.data };
      if (up.status >= 300) return jsonResponse({ error: "Envoi du fichier refusé par Pennylane", step: "file_attachment", steps }, 502);
      fileAttachmentId = (up.data as { id?: number })?.id ?? null;
    }

    // 3. Écriture
    const payload: Record<string, unknown> = { date, label, journal_id: Number(journal_id), ledger_entry_lines: entryLines };
    if (piece_number) payload.piece_number = piece_number;
    if (due_date) payload.due_date = due_date;
    if (fileAttachmentId) payload.file_attachment_id = fileAttachmentId;
    const created = await pl("POST", "/ledger_entries", payload);
    steps.ledger_entry = { status: created.status, data: created.data, payload };
    console.log(`[pennylane-ledger-push] ${created.status} journal=${journal_id} piece=${piece_number} by ${auth.userId} (org ${auth.orgId}) → ${JSON.stringify(created.data).slice(0, 2000)}`);
    if (created.status >= 300) return jsonResponse({ error: "Écriture refusée par Pennylane", step: "ledger_entry", steps }, 502);

    // 4. Relecture immédiate (statut, journal, numéro de facture éventuel)
    const id = (created.data as { id?: number })?.id;
    if (id) {
      const back = await pl("GET", `/ledger_entries/${id}`);
      steps.readback = { status: back.status, data: back.data };
    }
    return jsonResponse({ ok: true, ledger_entry_id: id ?? null, file_attachment_id: fileAttachmentId, steps }, 201);
  } catch (err) {
    console.error("[pennylane-ledger-push] Error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Internal error", steps }, 500);
  }
});
