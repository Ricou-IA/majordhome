// ============================================================================
// pennylane-sync-cron — Sync horaire PL → MDH
// ============================================================================
//
// Détecte les nouveaux clients Pennylane (sans mapping pennylane_sync)
// et crée automatiquement :
//   1. Le client dans majordhome.clients (+ code 411)
//   2. Un lead en "Devis envoyé" SI le client a un devis > 1000€ HT
//
// Appelé toutes les heures via N8N ou pg_cron.
// verify_jwt: false (appelé par cron, pas par un user)
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
const STATUS_DEVIS_ENVOYE = "47937391-5ffa-4804-9b5d-72f3fec6f4fe";

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

// ---------------------------------------------------------------------------
// Helpers Pennylane
// ---------------------------------------------------------------------------

async function plGet(path: string) {
  const res = await fetch(`${PENNYLANE_BASE_URL}${path}`, {
    headers: plHeaders,
  });
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

async function getLedgerNumber(ledgerAccountId: number): Promise<string | null> {
  if (!ledgerAccountId) return null;
  try {
    const la = await plGet(`/ledger_accounts/${ledgerAccountId}`);
    return la?.number || null;
  } catch {
    return null;
  }
}

// Fetch tous les devis Pennylane (paginé). L'API V2 ne supporte PAS filter[customer_id]
// donc on récupère tout puis filtre côté client par customer.id.
async function fetchAllPlQuotes(): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  let pageCount = 0;
  const MAX_PAGES = 30; // safety pour timeout edge function

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

// Indexe : customer.id → liste complète des devis (utilisé pour multi-devis par lead)
function buildQuotesByCustomerMap(
  quotes: any[]
): Map<number, any[]> {
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

// Trouve le devis le plus gros HT dans une liste (pour devis principal du lead)
function pickMaxQuote(
  customerQuotes: any[]
): { amount: number; label: string | null; quote: any | null } {
  let maxAmount = 0;
  let maxLabel: string | null = null;
  let maxQuote: any | null = null;
  for (const q of customerQuotes) {
    const ht = parseFloat(q.currency_amount_before_tax || "0");
    if (ht > maxAmount) {
      maxAmount = ht;
      maxLabel = q.label || q.pdf_invoice_subject || null;
      maxQuote = q;
    }
  }
  return { amount: maxAmount, label: maxLabel, quote: maxQuote };
}

// ---------------------------------------------------------------------------
// Helpers MDH
// ---------------------------------------------------------------------------

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

async function findLeadMatch(
  supabase: any,
  email: string | null,
  phone: string | null,
  name: string
): Promise<any | null> {
  // Match par email via vue publique majordhome_leads
  if (email) {
    const { data } = await supabase
      .from("majordhome_leads")
      .select("*")
      .eq("org_id", ORG_ID)
      .ilike("email", email)
      .eq("is_deleted", false)
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }

  // Match par téléphone
  if (phone && phone.replace(/\D/g, "").length >= 10) {
    const cleanPhone = phone.replace(/\D/g, "");
    const { data: leads } = await supabase
      .from("majordhome_leads")
      .select("*")
      .eq("org_id", ORG_ID)
      .eq("is_deleted", false);
    if (leads) {
      const match = leads.find(
        (l: any) =>
          l.phone && l.phone.replace(/\D/g, "") === cleanPhone
      );
      if (match) return match;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main sync logic
// ---------------------------------------------------------------------------

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
    // 1. Récupérer tous les pl_id déjà mappés
    const { data: existingSyncs } = await supabase
      .from("majordhome_pennylane_sync")
      .select("pennylane_id")
      .eq("entity_type", "client")
      .eq("org_id", ORG_ID);

    const mappedPlIds = new Set(
      (existingSyncs || []).map((s: any) => s.pennylane_id)
    );
    log.push(`Existing mappings: ${mappedPlIds.size}`);

    // 2. Fetch tous les clients PL
    const plCustomers = await fetchAllPlCustomers();
    log.push(`PL customers fetched: ${plCustomers.length}`);

    // 3. Filtrer les nouveaux (pas dans pennylane_sync)
    const newCustomers = plCustomers.filter(
      (c) => !mappedPlIds.has(c.id)
    );
    log.push(`New customers to process: ${newCustomers.length}`);

    if (newCustomers.length === 0) {
      return jsonResponse({ success: true, new_customers: 0, log });
    }

    // 4. Fetch tous les devis PL une fois (l'API V2 ne supporte pas filter customer_id)
    //    et indexe par customer.id → liste complète des quotes.
    const allQuotes = await fetchAllPlQuotes();
    const quotesByCustomer = buildQuotesByCustomerMap(allQuotes);
    log.push(`PL quotes fetched: ${allQuotes.length}`);

    let clientsCreated = 0;
    let leadsCreated = 0;
    let leadsUpdated = 0;

    for (const plCustomer of newCustomers) {
      try {
        const email = extractEmail(plCustomer);
        const phone = plCustomer.phone || null;
        const { firstName, lastName } = extractName(plCustomer.name || "");
        const displayName = (plCustomer.name || "").toUpperCase().trim();
        const billing = plCustomer.billing_address || {};
        const isCompany = plCustomer.customer_type === "company";

        // Récupérer le 411
        const pl411 = await getLedgerNumber(plCustomer.ledger_account?.id);

        // Find or create via RPC : matching invulnérable (clients + leads),
        // enrichissement automatique des champs vides, flag dedup_candidates si fuzzy match.
        const { data: rpcResult, error: rpcError } = await supabase.rpc(
          "find_or_create_client",
          {
            p_org_id: ORG_ID,
            p_email: email,
            p_phone: phone,
            p_first_name: firstName,
            p_last_name: lastName,
            p_display_name: displayName,
            p_company_name: isCompany ? displayName : null,
            p_address: billing.address || null,
            p_postal_code: billing.postal_code || null,
            p_city: billing.city || null,
            p_client_category: isCompany ? "entreprise" : "particulier",
            p_pennylane_account_number: pl411,
            p_source: "cron_pennylane",
          }
        );

        if (rpcError || !rpcResult) {
          log.push(
            `[error] RPC find_or_create ${displayName}: ${rpcError?.message || "no result"}`
          );
          continue;
        }

        const clientId: string = (rpcResult as any).client_id;
        const rpcAction: string = (rpcResult as any).action;
        const fuzzyId: string | null = (rpcResult as any).fuzzy_candidate_id;

        if (rpcAction === "matched_strict" || rpcAction === "matched_via_lead") {
          log.push(`[match] ${displayName} → ${clientId} (${rpcAction})`);
        } else if (rpcAction === "created" || rpcAction === "created_linked_lead") {
          clientsCreated++;
          log.push(`[created] ${displayName} → ${clientId} (${rpcAction}, pl=${pl411})`);
        }
        if (fuzzyId) {
          log.push(
            `[fuzzy-flag] ${displayName} → dedup_candidate avec ${fuzzyId}`
          );
        }

        // Créer le mapping sync
        await supabase.from("majordhome_pennylane_sync").upsert(
          {
            org_id: ORG_ID,
            entity_type: "client",
            local_id: clientId,
            pennylane_id: plCustomer.id,
            pennylane_number: pl411,
            external_reference: clientId,
            sync_status: "synced",
            metadata: { source: "sync_cron" },
          },
          { onConflict: "org_id,entity_type,local_id" }
        );

        // Vérifier si un lead est nécessaire (devis principal > 1000€) — lookup local (sans appel API)
        const customerQuotes = quotesByCustomer.get(plCustomer.id) || [];
        const { amount: maxQuoteHT, label: quoteLabel } = pickMaxQuote(customerQuotes);

        if (maxQuoteHT >= LEAD_THRESHOLD_HT) {
          // 1) RPC création/maj du lead avec le devis principal
          const { data: leadResult, error: leadRpcError } = await supabase.rpc(
            "upsert_pennylane_lead",
            {
              p_org_id: ORG_ID,
              p_client_id: clientId,
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

          if (leadRpcError) {
            log.push(`[lead-error] ${displayName}: ${leadRpcError.message}`);
          } else {
            const leadAction: string = (leadResult as any).action;
            const leadId: string | null = (leadResult as any).lead_id;
            if (leadAction === "lead_created") {
              leadsCreated++;
              log.push(`[lead-created] ${displayName} -> Devis envoye (max ${maxQuoteHT} EUR HT)`);
            } else if (leadAction === "lead_updated") {
              leadsUpdated++;
              log.push(`[lead-updated] ${displayName} -> Devis envoye (max ${maxQuoteHT} EUR HT)`);
            } else if (leadAction === "lead_skipped_priority_status") {
              log.push(`[lead-skipped] ${displayName} -> statut prioritaire conserve`);
            }

            // 2) Attacher TOUTES les quotes du customer à ce lead (variantes + autres projets,
            //    l'utilisateur triera ensuite via UI / RPCs eject + assign).
            if (leadId && customerQuotes.length > 0) {
              let attached = 0;
              for (const q of customerQuotes) {
                const { error: assignErr } = await supabase.rpc(
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
                if (!assignErr) attached++;
              }
              log.push(
                `[quotes-attached] ${displayName} -> ${attached}/${customerQuotes.length} devis lies au lead`
              );
            }
          }
        } else {
          log.push(
            `[no-lead] ${displayName} — max devis ${maxQuoteHT}€ HT < seuil ${LEAD_THRESHOLD_HT}€`
          );
        }
      } catch (err) {
        log.push(
          `[error] ${plCustomer.name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      // Pause entre chaque client pour rate limit
      await new Promise((r) => setTimeout(r, 300));
    }

    return jsonResponse({
      success: true,
      new_customers: newCustomers.length,
      clients_created: clientsCreated,
      leads_created: leadsCreated,
      leads_updated: leadsUpdated,
      log,
    });
  } catch (err) {
    return jsonResponse(
      {
        error: err instanceof Error ? err.message : "Error",
        log,
      },
      500
    );
  }
});
