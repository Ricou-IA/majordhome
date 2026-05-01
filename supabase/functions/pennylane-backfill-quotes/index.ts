// ============================================================================
// pennylane-backfill-quotes — Job one-shot
// ============================================================================
//
// Pour TOUS les customers Pennylane déjà mappés en MDH :
//   1. Récupère tous leurs devis Pennylane
//   2. Trouve un lead existant pour le client MDH (ou en crée un via RPC)
//   3. Attache toutes les quotes au lead via RPC assign_pennylane_quote_to_lead
//
// Idempotent : déjà attachée à un lead → no-op (RPC retourne already_assigned).
//
// Appelé manuellement (one-shot). verify_jwt: false pour invocation simple.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PENNYLANE_API_TOKEN = Deno.env.get("PENNYLANE_API_TOKEN") || "";
const PENNYLANE_BASE_URL =
  Deno.env.get("PENNYLANE_BASE_URL") ||
  "https://app.pennylane.com/api/external/v2";

const ORG_ID = "3c68193e-783b-4aa9-bc0d-fb2ce21e99b1";
const LEAD_THRESHOLD_HT = 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, x-app-name, apikey, content-type",
};
const plHeaders = {
  Authorization: `Bearer ${PENNYLANE_API_TOKEN}`,
  Accept: "application/json",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function plGet(path: string) {
  const res = await fetch(`${PENNYLANE_BASE_URL}${path}`, { headers: plHeaders });
  if (res.status === 429) {
    const wait = parseInt(res.headers.get("retry-after") || "3", 10);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return plGet(path);
  }
  if (!res.ok) throw new Error(`PL ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchAllPlCustomers(): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore) {
    let url = "/customers?limit=100";
    if (cursor) url += `&cursor=${cursor}`;
    const json = await plGet(url);
    all.push(...(json.items || []));
    hasMore = json.has_more && !!json.next_cursor;
    cursor = json.next_cursor || null;
    if (hasMore) await new Promise((r) => setTimeout(r, 250));
  }
  return all;
}

async function fetchAllPlQuotes(): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  let pageCount = 0;
  const MAX_PAGES = 30;
  while (hasMore && pageCount < MAX_PAGES) {
    let url = "/quotes?limit=100";
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    const json = await plGet(url);
    all.push(...(json.items || []));
    hasMore = json.has_more && !!json.next_cursor;
    cursor = json.next_cursor || null;
    pageCount++;
    if (hasMore) await new Promise((r) => setTimeout(r, 250));
  }
  return all;
}

function buildQuotesByCustomerMap(quotes: any[]): Map<number, any[]> {
  const map = new Map<number, any[]>();
  for (const q of quotes) {
    const customerId = q.customer?.id;
    if (!customerId) continue;
    const arr = map.get(customerId) || [];
    arr.push(q);
    map.set(customerId, arr);
  }
  return map;
}

function pickMaxQuote(
  customerQuotes: any[]
): { amount: number; label: string | null } {
  let maxAmount = 0;
  let maxLabel: string | null = null;
  for (const q of customerQuotes) {
    const ht = parseFloat(q.currency_amount_before_tax || "0");
    if (ht > maxAmount) {
      maxAmount = ht;
      maxLabel = q.label || q.pdf_invoice_subject || null;
    }
  }
  return { amount: maxAmount, label: maxLabel };
}

function extractEmail(c: any): string | null {
  if (Array.isArray(c.emails) && c.emails.length > 0) {
    const f = c.emails[0];
    return typeof f === "string" ? f : f?.email || null;
  }
  return null;
}

function extractName(name: string): { firstName: string; lastName: string } {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: "", lastName: parts[0] || "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (!PENNYLANE_API_TOKEN) {
    return jsonResponse({ error: "No PL token" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const log: string[] = [];

  try {
    const plCustomers = await fetchAllPlCustomers();
    log.push(`PL customers fetched: ${plCustomers.length}`);

    const allQuotes = await fetchAllPlQuotes();
    const quotesByCustomer = buildQuotesByCustomerMap(allQuotes);
    log.push(`PL quotes fetched: ${allQuotes.length}`);

    // Map pennylane_id → mdh_client_id (uniquement les déjà mappés)
    const { data: syncRows } = await supabase
      .from("majordhome_pennylane_sync")
      .select("pennylane_id, local_id")
      .eq("entity_type", "client")
      .eq("org_id", ORG_ID);

    const mdhClientByPlId = new Map<number, string>();
    for (const s of (syncRows as any[]) || []) {
      mdhClientByPlId.set(s.pennylane_id, s.local_id);
    }
    log.push(`Mapped customers: ${mdhClientByPlId.size}`);

    let processedCustomers = 0;
    let skippedNoQuotes = 0;
    let skippedBelowThreshold = 0;
    let leadsCreated = 0;
    let leadsUpdated = 0;
    let quotesAttached = 0;
    let quotesAlreadyAssigned = 0;
    let leadFound = 0;

    for (const plCustomer of plCustomers) {
      const mdhClientId = mdhClientByPlId.get(plCustomer.id);
      if (!mdhClientId) continue;

      const customerQuotes = quotesByCustomer.get(plCustomer.id) || [];
      if (customerQuotes.length === 0) {
        skippedNoQuotes++;
        continue;
      }

      const { amount: maxQuoteHT, label: quoteLabel } = pickMaxQuote(customerQuotes);
      if (maxQuoteHT < LEAD_THRESHOLD_HT) {
        skippedBelowThreshold++;
        continue;
      }

      // Trouver le lead le plus récent du client (ou null)
      const { data: existingLead } = await supabase
        .from("majordhome_leads")
        .select("id")
        .eq("org_id", ORG_ID)
        .eq("client_id", mdhClientId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let leadId: string | null = (existingLead as any)?.id || null;

      if (leadId) {
        leadFound++;
      } else {
        // Pas de lead → créer via upsert_pennylane_lead
        const email = extractEmail(plCustomer);
        const phone = plCustomer.phone || null;
        const { firstName, lastName } = extractName(plCustomer.name || "");
        const displayName = (plCustomer.name || "").toUpperCase().trim();
        const billing = plCustomer.billing_address || {};
        const isCompany = plCustomer.customer_type === "company";

        const { data: leadResult, error: leadErr } = await supabase.rpc(
          "upsert_pennylane_lead",
          {
            p_org_id: ORG_ID,
            p_client_id: mdhClientId,
            p_email: email,
            p_phone: phone,
            p_first_name: firstName,
            p_last_name: lastName,
            p_company_name: isCompany ? displayName : null,
            p_address: billing.address || null,
            p_postal_code: billing.postal_code || null,
            p_city: billing.city || null,
            p_max_quote_ht: maxQuoteHT,
            p_quote_label: quoteLabel,
          }
        );

        if (leadErr) {
          log.push(`[lead-error] ${plCustomer.name}: ${leadErr.message}`);
          continue;
        }

        leadId = (leadResult as any)?.lead_id || null;
        const action = (leadResult as any)?.action;
        if (action === "lead_created") leadsCreated++;
        else if (action === "lead_updated") leadsUpdated++;
      }

      // Attacher toutes les quotes
      if (leadId) {
        for (const q of customerQuotes) {
          const { data: assignResult, error: assignErr } = await supabase.rpc(
            "assign_pennylane_quote_to_lead",
            {
              p_org_id: ORG_ID,
              p_quote_pl_id: q.id,
              p_target_lead_id: leadId,
              p_quote_data: {
                customer_id: plCustomer.id,
                amount_ht: parseFloat(q.currency_amount_before_tax || "0"),
                label: q.label || q.pdf_invoice_subject || null,
                date: q.date || null,
                status: q.status || null,
              },
            }
          );
          if (!assignErr) {
            const action = (assignResult as any)?.action;
            if (action === "already_assigned") quotesAlreadyAssigned++;
            else quotesAttached++;
          }
        }
      }

      processedCustomers++;

      // Pause faible pour éviter timeout
      if (processedCustomers % 20 === 0) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return jsonResponse({
      success: true,
      processed_customers: processedCustomers,
      lead_found_existing: leadFound,
      leads_created: leadsCreated,
      leads_updated: leadsUpdated,
      quotes_attached: quotesAttached,
      quotes_already_assigned: quotesAlreadyAssigned,
      skipped_no_quotes: skippedNoQuotes,
      skipped_below_threshold: skippedBelowThreshold,
      log: log.slice(0, 50), // truncate pour réponse JSON pas trop volumineuse
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Error", log },
      500
    );
  }
});
