// supabase/functions/pennylane-supplier-invoices/index.ts
// ============================================================================
// pennylane-supplier-invoices — factures FOURNISSEUR Pennylane d'un fournisseur, avec le lien de leur PDF
// ============================================================================
// Pennylane ne porte, pour un relevé mensuel fournisseur, que des ventilations comptables sans libellé :
// le détail article / quantité / prix net n'existe que dans le PDF joint (`public_file_url`, lien valable
// 30 min). Cette edge relaie la liste des factures d'un fournisseur Pennylane et, pour chacune, son lien
// de téléchargement — le jeton Pennylane (PENNYLANE_API_TOKEN, mono-tenant) ne sort jamais du serveur.
// Consommateur : scripts/catalogue/telecharger-factures-pennylane.mjs (import du catalogue d'achats).
//
// Auth (verify_jwt:false) : Authorization: Bearer <MDH_IMPORT_SECRET> (jobs lancés depuis un poste de
// dev, secret créé le 2026-10-24) ou <MDH_CRON_SECRET>. Lecture seule : aucun POST vers Pennylane.
// Body : { supplier_id: number }            → { items: [{ id, date, label, invoice_number, amount,
//                                                amount_before_tax, filename, public_file_url }] }
// ============================================================================

import { jsonResponse, buildCorsHeaders, sanitizeError, timingSafeEqual } from "../_shared/auth.ts";

const PENNYLANE_API_TOKEN = Deno.env.get("PENNYLANE_API_TOKEN") || "";
const PENNYLANE_BASE_URL = Deno.env.get("PENNYLANE_BASE_URL") || "https://app.pennylane.com/api/external/v2";
const SECRETS = [Deno.env.get("MDH_IMPORT_SECRET") || "", Deno.env.get("MDH_CRON_SECRET") || ""].filter(Boolean);
const MAX_RETRIES = 3;

interface PlInvoice {
  id: number;
  date: string;
  label: string;
  invoice_number: string | null;
  amount: string;
  currency_amount_before_tax?: string | null;
  filename?: string | null;
  public_file_url?: string | null;
  supplier?: { id: number; name?: string } | null;
}

async function pl(path: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const url = new URL(PENNYLANE_BASE_URL + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${PENNYLANE_API_TOKEN}`, Accept: "application/json" } });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "2", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`pennylane_${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error("pennylane_429: rate limit exceeded after retries");
}

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed — use POST" }, 405, req);

  if (SECRETS.length === 0) return jsonResponse({ error: "MDH_IMPORT_SECRET not configured" }, 500, req);
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token || !SECRETS.some((s) => timingSafeEqual(token, s))) return jsonResponse({ error: "Unauthorized" }, 401, req);
  if (!PENNYLANE_API_TOKEN) return jsonResponse({ error: "PENNYLANE_API_TOKEN not configured" }, 500, req);

  let body: { supplier_id?: unknown } = {};
  try { body = await req.json(); } catch { /* body vide */ }
  const supplierId = Number(body.supplier_id);
  if (!Number.isInteger(supplierId) || supplierId <= 0) return jsonResponse({ error: "supplier_id (entier Pennylane) requis" }, 400, req);

  try {
    const heads: PlInvoice[] = [];
    let cursor: string | null = null;
    do {
      const page = (await pl("/supplier_invoices", {
        filter: [{ field: "supplier_id", operator: "eq", value: supplierId }],
        limit: 100,
        cursor,
      })) as { items?: PlInvoice[]; has_more?: boolean; next_cursor?: string | null };
      heads.push(...(page.items || []));
      cursor = page.has_more ? page.next_cursor || null : null;
    } while (cursor);

    // Le lien du fichier n'est renvoyé que par la ressource unitaire.
    const items = [];
    for (const h of heads) {
      const d = (await pl(`/supplier_invoices/${h.id}`)) as PlInvoice;
      items.push({
        id: d.id,
        date: d.date,
        label: d.label,
        invoice_number: d.invoice_number ?? null,
        amount: d.amount,
        amount_before_tax: d.currency_amount_before_tax ?? null,
        filename: d.filename ?? null,
        public_file_url: d.public_file_url ?? null,
        supplier_name: d.supplier?.name ?? h.supplier?.name ?? null,
      });
    }
    return jsonResponse({ supplier_id: supplierId, count: items.length, items }, 200, req);
  } catch (err) {
    console.error("[pennylane-supplier-invoices]", err);
    return jsonResponse({ error: sanitizeError(err, "pennylane_error") }, 502, req);
  }
});
