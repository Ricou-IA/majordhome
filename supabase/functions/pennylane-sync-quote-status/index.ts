// supabase/functions/pennylane-sync-quote-status/index.ts
// Cron 15 min : sync devis attachés (status + pdf_url) + sync identité PL→MDH
// (clients + leads) + auto-attach nouveaux devis PL pour bridges existants.
//
// Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §9
// Bridge canonique (2026-05-27) : une fois un devis attaché à un lead, PL
// devient canonical pour l'identité du lead + tous les nouveaux devis PL
// de ce customer sont auto-attachés au même lead.
//
// Auth : verify_jwt:false — protégée par MDH_CRON_SECRET (pattern P0.2).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  requireSharedSecret,
  jsonResponse,
  getAdminClient,
  sanitizeError,
  buildCorsHeaders,
} from "../_shared/auth.ts";

// ---------------------------------------------------------------------------
// Types Pennylane (subset)
// ---------------------------------------------------------------------------

interface PennylaneQuote {
  id: number;
  quote_number?: string;
  label?: string;
  date?: string;
  status?: string;
  currency_amount_before_tax?: number;
  public_file_url?: string;
  customer?: { id?: number };
}

interface PennylaneCustomer {
  id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  emails?: Array<{ label?: string; value?: string; is_default?: boolean }>;
  billing_email?: string;
  phone?: string;
  billing_phone?: string;
  billing_iban?: string;
  billing_address?: {
    street?: string;
    postal_code?: string;
    city?: string;
  };
}

interface AttachedQuote {
  id: string;
  lead_id: string;
  pennylane_quote_id: number;
  pennylane_customer_id: number | null;
  quote_status: string | null;
  is_winning_quote: boolean;
  pdf_url: string | null;
  assigned_at: string;
}

// Bug-fix 2026-05-27 : PL V2 single GET retourne au ROOT, pas dans { quote: ... }.
function unwrapPennylaneResource<T>(
  rawData: unknown,
  expectedKey: string,
): T | null {
  if (!rawData || typeof rawData !== "object") return null;
  const obj = rawData as Record<string, unknown>;
  if (
    expectedKey in obj &&
    obj[expectedKey] &&
    typeof obj[expectedKey] === "object"
  ) {
    return obj[expectedKey] as T;
  }
  if ("id" in obj) return obj as T;
  return null;
}

// Seuil pipeline : devis < 1000€ HT = SAV/entretien hors pipeline commercial.
// Pas d'auto-attach pour ces devis (alignement constante frontend
// PIPELINE_MIN_AMOUNT_HT dans QuoteCandidatesModal).
const PIPELINE_MIN_AMOUNT_HT = 1000;

// ---------------------------------------------------------------------------
// Appel direct Pennylane (sans passer par pennylane-proxy)
// ---------------------------------------------------------------------------

const PENNYLANE_BASE_URL =
  Deno.env.get("PENNYLANE_BASE_URL") ||
  "https://app.pennylane.com/api/external/v2";

const MAX_RETRIES = 2;

async function callPennylaneApi(
  path: string,
  apiToken: string,
): Promise<{ status: number; data: unknown }> {
  const url = `${PENNYLANE_BASE_URL}${path}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: "application/json",
        },
      });
    } catch (e) {
      throw new Error(`Pennylane fetch failed: ${sanitizeError(e, "fetch error")}`);
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "2", 10);
      console.log(`[pennylane-sync] 429 on ${path}, retry in ${retryAfter}s`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, data };
  }

  return { status: 429, data: { error: "Rate limit after retries" } };
}

// Helpers extraction non-vide depuis customer PL (mirror frontend service)
function extractUpdatePayload(c: PennylaneCustomer): Record<string, string> {
  const p: Record<string, string> = {};

  if (c.first_name?.trim()) p.first_name = c.first_name.trim();
  if (c.last_name?.trim()) p.last_name = c.last_name.trim();

  const email =
    c.billing_email?.trim() ||
    c.emails?.find((e) => e.is_default)?.value?.trim() ||
    c.emails?.[0]?.value?.trim();
  if (email) p.email = email;

  const phone = (c.billing_phone || c.phone)?.trim();
  if (phone) p.phone = phone;

  if (c.billing_address?.street?.trim()) {
    p.address = c.billing_address.street.trim();
  }
  if (c.billing_address?.postal_code?.trim()) {
    p.postal_code = c.billing_address.postal_code.trim();
  }
  if (c.billing_address?.city?.trim()) {
    p.city = c.billing_address.city.trim();
  }

  return p;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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

  const PENNYLANE_API_TOKEN = Deno.env.get("PENNYLANE_API_TOKEN") || "";
  if (!PENNYLANE_API_TOKEN) {
    return jsonResponse(
      { success: false, error: "PENNYLANE_API_TOKEN not configured" },
      500,
      req,
    );
  }

  const supabase = getAdminClient();

  try {
    const { data: orgs, error: orgsErr } = await supabase
      .schema("core")
      .from("organizations")
      .select("id, settings");

    if (orgsErr) throw orgsErr;

    const plOrgs = (orgs ?? []).filter((org) => {
      const pl = (org.settings as Record<string, unknown>)?.pennylane as
        | { enabled?: boolean }
        | undefined;
      return pl?.enabled === true;
    });

    if (plOrgs.length === 0) {
      return jsonResponse(
        { success: true, processed_orgs: 0, message: "No PL-enabled orgs" },
        200,
        req,
      );
    }

    const summary = {
      processed_orgs: 0,
      quote_status_updates: 0,
      customer_field_updates: 0,
      lead_field_updates: 0,
      auto_attached_quotes: 0,
      ejections: 0,
      winning_quotes_set: 0,
      errors: [] as string[],
    };

    for (const org of plOrgs) {
      try {
        const result = await syncOrgQuotes(supabase, org.id, PENNYLANE_API_TOKEN);
        summary.processed_orgs++;
        summary.quote_status_updates += result.quote_status_updates;
        summary.customer_field_updates += result.customer_field_updates;
        summary.lead_field_updates += result.lead_field_updates;
        summary.auto_attached_quotes += result.auto_attached_quotes;
        summary.ejections += result.ejections;
        summary.winning_quotes_set += result.winning_quotes_set;
      } catch (orgErr) {
        const msg = sanitizeError(orgErr, "Org sync failed");
        console.warn(`[pennylane-sync] org ${org.id} error: ${msg}`);
        summary.errors.push(`org ${org.id}: ${msg}`);
      }
    }

    return jsonResponse({ success: true, ...summary }, 200, req);
  } catch (err) {
    const msg = sanitizeError(err, "Global sync failed");
    console.error(`[pennylane-sync] global error: ${msg}`);
    return jsonResponse({ success: false, error: msg }, 500, req);
  }
});

// ---------------------------------------------------------------------------
// syncOrgQuotes — traite une org
// ---------------------------------------------------------------------------

async function syncOrgQuotes(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  apiToken: string,
) {
  let quote_status_updates = 0;
  const ejections_ref = { v: 0 };
  let winning_quotes_set = 0;

  // 1. Recuperer tous les devis actifs (non ejectes) de cette org
  const { data: attachedRows, error: aqErr } = await supabase
    .from("majordhome_lead_pennylane_quotes")
    .select(
      "id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_status, is_winning_quote, pdf_url, assigned_at",
    )
    .eq("org_id", orgId)
    .is("ejected_at", null);

  if (aqErr) throw aqErr;
  const attachedQuotes: AttachedQuote[] = (attachedRows ?? []) as AttachedQuote[];
  if (attachedQuotes.length === 0) {
    return {
      quote_status_updates: 0,
      customer_field_updates: 0,
      lead_field_updates: 0,
      auto_attached_quotes: 0,
      ejections: 0,
      winning_quotes_set: 0,
    };
  }

  // 2. Sync quote_status + pdf_url pour chaque devis attache
  quote_status_updates = await syncAttachedQuoteFields(
    supabase, orgId, apiToken, attachedQuotes, ejections_ref,
  );

  // 3. Pose is_winning_quote sur le plus recent accepted
  try {
    const { data: winnersSet, error: winnersErr } = await supabase.rpc(
      "pennylane_sync_ensure_winning_quotes",
      { p_org_id: orgId },
    );
    if (winnersErr) {
      console.warn(
        `[pennylane-sync] ensure_winning_quotes error for org ${orgId}:`,
        sanitizeError(winnersErr, 'ensure_winning_quotes error'),
      );
    } else {
      winning_quotes_set = (winnersSet as number) ?? 0;
    }
  } catch (e) {
    console.warn(
      `[pennylane-sync] ensure_winning_quotes exception for org ${orgId}:`,
      sanitizeError(e, 'ensure_winning_quotes exception'),
    );
  }

  // 4. Sync identite PL -> MDH (clients + leads, mode OVERWRITE)
  const { customer_field_updates, lead_field_updates } =
    await syncIdentityFromPennylane(supabase, orgId, apiToken, attachedQuotes);

  // 5. Auto-attach nouveaux devis PL pour bridges existants (bridge canonique)
  const auto_attached_quotes = await autoAttachNewQuotes(
    supabase, orgId, apiToken, attachedQuotes,
  );

  return {
    quote_status_updates,
    customer_field_updates,
    lead_field_updates,
    auto_attached_quotes,
    ejections: ejections_ref.v,
    winning_quotes_set,
  };
}

// ---------------------------------------------------------------------------
// syncAttachedQuoteFields — etape 2 : sync status + pdf_url des devis attaches
// ---------------------------------------------------------------------------

async function syncAttachedQuoteFields(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  apiToken: string,
  attachedQuotes: AttachedQuote[],
  ejections_ref: { v: number },
): Promise<number> {
  let updates = 0;

  for (const aq of attachedQuotes) {
    if (!aq.pennylane_quote_id) continue;

    try {
      const { status: httpStatus, data: rawData } = await callPennylaneApi(
        `/quotes/${aq.pennylane_quote_id}`,
        apiToken,
      );

      if (httpStatus === 404) {
        const { error: ejectErr } = await supabase.rpc('pennylane_sync_eject_quote', {
          p_quote_id: aq.id,
          p_reason: 'deleted_in_pennylane',
        });

        if (ejectErr) {
          console.warn(`[pennylane-sync] eject failed for quote ${aq.id}:`, sanitizeError(ejectErr, 'eject failed'));
        } else {
          ejections_ref.v++;
        }
        continue;
      }

      if (httpStatus < 200 || httpStatus >= 300) {
        console.warn(
          `[pennylane-sync] quote ${aq.pennylane_quote_id} returned HTTP ${httpStatus}`,
        );
        continue;
      }

      const plQuote = unwrapPennylaneResource<PennylaneQuote>(rawData, "quote");
      if (!plQuote) continue;

      const plStatus = plQuote.status ?? null;
      const plPdfUrl = plQuote.public_file_url ?? null;
      const statusDiffers = plStatus && plStatus !== aq.quote_status;
      const pdfDiffers = plPdfUrl && plPdfUrl !== aq.pdf_url;

      if (statusDiffers || pdfDiffers) {
        const { error: updErr } = await supabase.rpc('pennylane_sync_update_quote_fields', {
          p_quote_id: aq.id,
          p_new_status: plStatus,
          p_pdf_url: plPdfUrl,
        });

        if (updErr) {
          console.warn(
            `[pennylane-sync] fields update failed for quote ${aq.id}:`,
            sanitizeError(updErr, 'fields update failed'),
          );
        } else {
          updates++;
        }
      }
    } catch (e) {
      console.warn(
        `[pennylane-sync] error fetching quote ${aq.pennylane_quote_id}:`,
        sanitizeError(e, 'quote fetch error'),
      );
    }
  }

  return updates;
}

// ---------------------------------------------------------------------------
// syncIdentityFromPennylane — etape 4 : sync identite PL -> MDH
// Pour chaque customer unique : fetch /customers/{id} et update :
//   - client(s) MDH lies via pennylane_sync (OVERWRITE-when-PL-has-value)
//   - lead(s) bridges via lead_pennylane_quotes (OVERWRITE direct, PL canonical)
// ---------------------------------------------------------------------------

async function syncIdentityFromPennylane(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  apiToken: string,
  attachedQuotes: AttachedQuote[],
): Promise<{ customer_field_updates: number; lead_field_updates: number }> {
  let customer_field_updates = 0;
  let lead_field_updates = 0;

  // Bridge map : customer_id -> Set<lead_id>
  const bridgeMap = new Map<number, Set<string>>();
  for (const aq of attachedQuotes) {
    if (!aq.pennylane_customer_id) continue;
    let set = bridgeMap.get(aq.pennylane_customer_id);
    if (!set) {
      set = new Set();
      bridgeMap.set(aq.pennylane_customer_id, set);
    }
    set.add(aq.lead_id);
  }

  for (const [customerId, leadIds] of bridgeMap) {
    try {
      const { status: httpStatus, data: rawData } = await callPennylaneApi(
        `/customers/${customerId}`,
        apiToken,
      );

      if (httpStatus !== 200) {
        console.warn(
          `[pennylane-sync] customer ${customerId} returned HTTP ${httpStatus}`,
        );
        continue;
      }

      const plCustomer = unwrapPennylaneResource<PennylaneCustomer>(rawData, "customer");
      if (!plCustomer) continue;

      const updatePayload = extractUpdatePayload(plCustomer);
      if (Object.keys(updatePayload).length === 0) continue;

      // 4a. Sync client MDH (si mapping pennylane_sync existe)
      const { data: syncRow, error: syncErr } = await supabase
        .from("majordhome_pennylane_sync")
        .select("local_id")
        .eq("org_id", orgId)
        .eq("entity_type", "client")
        .eq("pennylane_id", customerId)
        .maybeSingle();

      if (syncErr) {
        console.warn(
          `[pennylane-sync] sync lookup error for customer ${customerId}:`,
          sanitizeError(syncErr, 'sync lookup error'),
        );
      } else if (syncRow?.local_id) {
        const { error: clientUpdErr } = await supabase.rpc('pennylane_sync_update_client_fields', {
          p_client_id: syncRow.local_id,
          p_org_id: orgId,
          p_fields: updatePayload,
        });

        if (clientUpdErr) {
          console.warn(
            `[pennylane-sync] client update failed (pl_customer ${customerId}):`,
            sanitizeError(clientUpdErr, 'client update failed'),
          );
        } else {
          customer_field_updates++;
        }
      }

      // 4b. Sync lead(s) bridges a ce customer (PL canonical post-attach)
      for (const leadId of leadIds) {
        const { error: leadUpdErr } = await supabase.rpc('pennylane_sync_overwrite_lead_fields', {
          p_lead_id: leadId,
          p_org_id: orgId,
          p_fields: updatePayload,
        });

        if (leadUpdErr) {
          console.warn(
            `[pennylane-sync] lead update failed (lead ${leadId}):`,
            sanitizeError(leadUpdErr, 'lead update failed'),
          );
        } else {
          lead_field_updates++;
        }
      }
    } catch (e) {
      console.warn(
        `[pennylane-sync] identity sync exception for customer ${customerId}:`,
        sanitizeError(e, 'identity sync exception'),
      );
    }
  }

  return { customer_field_updates, lead_field_updates };
}

// ---------------------------------------------------------------------------
// autoAttachNewQuotes — etape 5 : auto-attach nouveaux devis PL pour bridges
// existants. Pour chaque customer ayant deja un bridge (>=1 devis attache),
// fetch tous ses devis PL et attache ceux qui ne sont pas en base.
//
// Respecte le seuil pipeline 1000€ HT (SAV/entretien exclus).
// Respecte les ejections manuelles (RPC pennylane_sync_auto_attach_quote
// no-op si quote_pl_id existe en base, meme ejected).
//
// Bridge lead_id : on prend la rangee la plus recemment assignee pour chaque
// customer (assigned_at DESC).
// ---------------------------------------------------------------------------

interface PennylaneQuoteListItem {
  id: number;
  quote_number?: string;
  label?: string;
  date?: string;
  status?: string;
  currency_amount_before_tax?: number;
  public_file_url?: string;
  customer?: { id?: number };
}

interface PennylaneQuotesListResponse {
  items?: PennylaneQuoteListItem[];
  has_more?: boolean;
  next_cursor?: string;
}

async function autoAttachNewQuotes(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  apiToken: string,
  attachedQuotes: AttachedQuote[],
): Promise<number> {
  let attached = 0;

  // Set des quote_pl_id deja attaches (pour diff rapide)
  const attachedPlIds = new Set<number>(
    attachedQuotes.map((aq) => aq.pennylane_quote_id),
  );

  // Bridge map : customer_id -> lead_id le plus recemment assigne
  const bridgeMap = new Map<number, { lead_id: string; assigned_at: string }>();
  for (const aq of attachedQuotes) {
    if (!aq.pennylane_customer_id) continue;
    const existing = bridgeMap.get(aq.pennylane_customer_id);
    if (!existing || aq.assigned_at > existing.assigned_at) {
      bridgeMap.set(aq.pennylane_customer_id, {
        lead_id: aq.lead_id,
        assigned_at: aq.assigned_at,
      });
    }
  }

  for (const [customerId, bridge] of bridgeMap) {
    try {
      // Fetch tous les devis PL pour ce customer via filter natif V2
      const filter = encodeURIComponent(
        JSON.stringify([{ field: "customer_id", operator: "eq", value: customerId }]),
      );
      const { status: httpStatus, data: rawData } = await callPennylaneApi(
        `/quotes?filter=${filter}&limit=100`,
        apiToken,
      );

      if (httpStatus !== 200) {
        console.warn(
          `[pennylane-sync] customer ${customerId} quotes list HTTP ${httpStatus}`,
        );
        continue;
      }

      const list = (rawData as PennylaneQuotesListResponse) ?? {};
      const items = list.items ?? [];

      for (const q of items) {
        if (!q.id) continue;
        if (attachedPlIds.has(q.id)) continue; // deja attache

        const amountHt = Number(q.currency_amount_before_tax ?? 0);
        if (amountHt < PIPELINE_MIN_AMOUNT_HT) continue; // SAV/entretien hors pipeline

        const label = q.quote_number || q.label || `Q-${q.id}`;
        const quoteDate = q.date || new Date().toISOString().slice(0, 10);
        const status = q.status || null;
        const pdfUrl = q.public_file_url || null;

        const { data: result, error: attachErr } = await supabase.rpc(
          'pennylane_sync_auto_attach_quote',
          {
            p_org_id: orgId,
            p_lead_id: bridge.lead_id,
            p_quote_pl_id: q.id,
            p_customer_id: customerId,
            p_amount_ht: amountHt,
            p_label: label,
            p_quote_date: quoteDate,
            p_status: status,
            p_pdf_url: pdfUrl,
          },
        );

        if (attachErr) {
          console.warn(
            `[pennylane-sync] auto-attach failed for quote ${q.id}:`,
            sanitizeError(attachErr, 'auto-attach failed'),
          );
          continue;
        }

        const wasAttached = (result as { attached?: boolean } | null)?.attached === true;
        if (wasAttached) {
          attached++;
          console.log(
            `[pennylane-sync] auto-attached quote ${q.id} (${label}, ${amountHt}€) to lead ${bridge.lead_id}`,
          );
        }
      }
    } catch (e) {
      console.warn(
        `[pennylane-sync] auto-attach exception for customer ${customerId}:`,
        sanitizeError(e, 'auto-attach exception'),
      );
    }
  }

  return attached;
}
