// supabase/functions/pennylane-quotes-sweep/index.ts
// Balayage des devis Pennylane : matérialise la table jumelle et normalise les
// échéances (deadline = date d'émission + 3 mois).
//
// La règle des 3 mois n'est PAS ici : elle vit dans
// majordhome.pl_quote_target_deadline(). La RPC d'upsert renvoie les devis à
// corriger et leur cible — cette fonction ne fait aucune arithmétique de dates.
//
// Auth : verify_jwt:false — protégée par MDH_CRON_SECRET (pattern P0.2).
// Spec : docs/superpowers/specs/2026-08-07-devis-pl-deadline-et-materialisation-design.md

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  requireSharedSecret,
  jsonResponse,
  getAdminClient,
  sanitizeError,
  buildCorsHeaders,
} from "../_shared/auth.ts";

const PENNYLANE_BASE_URL = "https://app.pennylane.com/api/external/v2";

// Statuts balayés. `denied` est exclu : un devis refusé n'a pas à être
// matérialisé ni normalisé. `draft` n'est pas dans l'énumération filtrable
// documentée par Pennylane — cf. Task 3, à constater avant de l'ajouter.
const SWEEP_STATUSES = ["pending", "expired", "accepted", "invoiced"];

const PAGE_LIMIT = 100;
const MAX_PAGES = 200;          // garde-fou : 20 000 devis
const UPSERT_CHUNK = 200;

interface PennylaneQuoteListItem {
  id: number;
  quote_number?: string;
  label?: string;
  status?: string;
  date?: string;
  deadline?: string;
  currency_amount_before_tax?: number;
  amount?: number;
  currency_amount?: number;
  public_file_url?: string;
  pdf_invoice_subject?: string;
  archived_at?: string;
  created_at?: string;
  updated_at?: string;
  customer?: { id?: number; name?: string; first_name?: string; last_name?: string };
}

function formatCustomerName(c?: PennylaneQuoteListItem["customer"]): string | null {
  if (!c) return null;
  if (c.name) return c.name;
  const full = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return full || null;
}

async function callPennylane(
  path: string,
  apiToken: string,
  init?: RequestInit,
): Promise<{ status: number; data: unknown }> {
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${PENNYLANE_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  }
  return { status: 599, data: null };
}

async function sweepOrg(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  apiToken: string,
  applyDeadlines: boolean,
) {
  const sweepStarted = new Date().toISOString();
  const filter = encodeURIComponent(
    JSON.stringify([{ field: "status", operator: "in", value: SWEEP_STATUSES }]),
  );

  let cursor: string | null = null;
  let pages = 0;
  let scanned = 0;
  let truncated = false;
  const toNormalize: { id: number; target: string }[] = [];
  const statusSeen = new Set<string>();

  while (pages < MAX_PAGES) {
    let path = `/quotes?limit=${PAGE_LIMIT}&filter=${filter}`;
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;

    const { status, data } = await callPennylane(path, apiToken);
    if (status !== 200) {
      throw new Error(`GET /quotes a renvoye ${status}`);
    }
    const payload = data as { items?: PennylaneQuoteListItem[]; has_more?: boolean; next_cursor?: string };
    const items = payload?.items ?? [];
    scanned += items.length;
    pages++;

    for (const q of items) if (q.status) statusSeen.add(q.status);

    // Upsert par tranches
    for (let i = 0; i < items.length; i += UPSERT_CHUNK) {
      const chunk = items.slice(i, i + UPSERT_CHUNK).map((q) => ({
        id: q.id,
        quote_number: q.quote_number ?? q.label ?? null,
        label: q.label ?? null,
        status: q.status ?? null,
        date: q.date ?? null,
        deadline: q.deadline ?? null,
        amount_ht: q.currency_amount_before_tax ?? null,
        amount_ttc: q.amount ?? q.currency_amount ?? null,
        pdf_url: q.public_file_url ?? null,
        customer_id: q.customer?.id ?? null,
        customer_name: formatCustomerName(q.customer),
        pdf_invoice_subject: q.pdf_invoice_subject ?? null,
        archived_at: q.archived_at ?? null,
        pl_created_at: q.created_at ?? null,
        pl_updated_at: q.updated_at ?? null,
      }));

      const { data: rows, error } = await supabase.rpc("pennylane_quotes_upsert_batch", {
        p_org_id: orgId,
        p_rows: chunk,
      });
      if (error) throw error;

      // quote_pl_id (et non pennylane_quote_id) : la colonne de sortie de la RPC
      // est nommee distinctement de la colonne table, sinon ON CONFLICT devient
      // ambigu cote PL/pgSQL (42702, migration 20260807_1c).
      for (const r of (rows ?? []) as { quote_pl_id: number; target_deadline: string }[]) {
        toNormalize.push({ id: r.quote_pl_id, target: r.target_deadline });
      }
    }

    if (!payload?.has_more || !payload?.next_cursor) break;
    cursor = payload.next_cursor;
    if (pages >= MAX_PAGES) truncated = true;
  }

  // Devis absents de ce balayage
  const { data: missing, error: missErr } = await supabase.rpc("pennylane_quotes_mark_missing", {
    p_org_id: orgId,
    p_sweep_started: sweepStarted,
  });
  if (missErr) throw missErr;

  return {
    scanned,
    pages,
    truncated,
    statuses_seen: [...statusSeen],
    to_normalize: toNormalize.length,
    normalized: 0,          // Task 4
    normalize_errors: 0,    // Task 4
    marked_missing: missing ?? 0,
    apply_deadlines: applyDeadlines,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  const authError = requireSharedSecret(
    req,
    Deno.env.get("MDH_CRON_SECRET") || "",
    "MDH_CRON_SECRET",
  );
  if (authError) return authError;

  const apiToken = Deno.env.get("PENNYLANE_API_TOKEN") || "";
  if (!apiToken) {
    return jsonResponse({ success: false, error: "PENNYLANE_API_TOKEN not configured" }, 500, req);
  }

  // Interrupteur d'écriture. Tant qu'il est absent/false, la fonction ne touche
  // PAS aux devis Pennylane : elle matérialise et compte seulement.
  const applyDeadlines = Deno.env.get("PL_APPLY_DEADLINES") === "true";

  const supabase = getAdminClient();

  try {
    const { data: orgs, error: orgsErr } = await supabase
      .schema("core")
      .from("organizations")
      .select("id, settings");
    if (orgsErr) throw orgsErr;

    const plOrgs = (orgs ?? []).filter((org) => {
      const pl = (org.settings as Record<string, unknown>)?.pennylane as { enabled?: boolean } | undefined;
      return pl?.enabled === true;
    });

    const results: Record<string, unknown>[] = [];
    for (const org of plOrgs) {
      try {
        results.push({ org_id: org.id, ...(await sweepOrg(supabase, org.id, apiToken, applyDeadlines)) });
      } catch (e) {
        results.push({ org_id: org.id, error: sanitizeError(e, "sweep failed") });
      }
    }

    return jsonResponse({ success: true, orgs: results }, 200, req);
  } catch (e) {
    return jsonResponse({ success: false, error: sanitizeError(e, "sweep failed") }, 500, req);
  }
});
