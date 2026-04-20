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

async function getCustomerMaxQuoteHT(
  customerId: number
): Promise<{ amount: number; label: string | null }> {
  try {
    const json = await plGet(
      `/quotes?limit=100&customer_id=${customerId}`
    );
    const quotes = json.items || [];
    let maxAmount = 0;
    let maxLabel = null;
    for (const q of quotes) {
      const ht = parseFloat(q.currency_amount_before_tax || "0");
      if (ht > maxAmount) {
        maxAmount = ht;
        maxLabel = q.label || q.pdf_invoice_subject || null;
      }
    }
    return { amount: maxAmount, label: maxLabel };
  } catch {
    return { amount: 0, label: null };
  }
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

        // Vérifier si client MDH existe déjà (par email ou display_name)
        let existingClientId: string | null = null;

        if (email) {
          const { data: byEmail } = await supabase
            .from("majordhome_clients")
            .select("id")
            .eq("org_id", ORG_ID)
            .ilike("email", email)
            .limit(1)
            .maybeSingle();
          if (byEmail) existingClientId = byEmail.id;
        }

        if (!existingClientId) {
          const { data: byName } = await supabase
            .from("majordhome_clients")
            .select("id")
            .eq("org_id", ORG_ID)
            .ilike("display_name", displayName)
            .limit(1)
            .maybeSingle();
          if (byName) existingClientId = byName.id;
        }

        let clientId: string;

        if (existingClientId) {
          // Client existe → juste mettre à jour le 411
          clientId = existingClientId;
          if (pl411) {
            await supabase
              .from("majordhome_clients")
              .update({ pennylane_account_number: pl411 })
              .eq("id", clientId);
          }
          log.push(`[match] ${displayName} → existing client ${clientId}`);
        } else {
          // Créer le project + client
          const projectId = crypto.randomUUID();
          const { error: projError } = await supabase
            .from("projects")
            .insert({ id: projectId, org_id: ORG_ID, name: displayName });
          if (projError) {
            log.push(`[error] project insert ${displayName}: ${projError.message}`);
            continue;
          }

          // Prochain client_number
          const { data: maxNum } = await supabase
            .from("majordhome_clients")
            .select("client_number")
            .eq("org_id", ORG_ID)
            .order("client_number", { ascending: false })
            .limit(1)
            .single();

          const nextSeq =
            parseInt((maxNum?.client_number || "CLI-00000").replace("CLI-", ""), 10) + 1;
          const clientNumber = `CLI-${String(nextSeq).padStart(5, "0")}`;

          const { data: newClient, error: clientError } = await supabase
            .from("majordhome_clients")
            .insert({
              project_id: projectId,
              org_id: ORG_ID,
              display_name: displayName,
              first_name: firstName.toUpperCase(),
              last_name: lastName.toUpperCase(),
              email: email,
              phone: phone,
              address: billing.address || null,
              postal_code: billing.postal_code || null,
              city: billing.city || null,
              client_number: clientNumber,
              client_category: isCompany ? "entreprise" : "particulier",
              pennylane_account_number: pl411,
            })
            .select("id")
            .single();

          if (clientError) {
            log.push(`[error] ${displayName}: ${clientError.message}`);
            continue;
          }
          clientId = newClient.id;
          clientsCreated++;
          log.push(`[created] ${displayName} → ${clientNumber} (${pl411})`);
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

        // Vérifier si un lead est nécessaire (devis > 1000€)
        const { amount: maxQuoteHT, label: quoteLabel } =
          await getCustomerMaxQuoteHT(plCustomer.id);

        if (maxQuoteHT >= LEAD_THRESHOLD_HT) {
          // Chercher un lead existant
          const existingLead = await findLeadMatch(
            supabase,
            email,
            phone,
            displayName
          );

          if (existingLead) {
            // Ne pas rétrograder un lead déjà en Devis envoyé, Gagné ou Perdu
            if (
              existingLead.status_id !== STATUS_DEVIS_ENVOYE &&
              existingLead.status_id !== "c717780c-0ba7-4bf1-9e1e-5f014c1e9e2f" &&
              existingLead.status_id !== "e0419cea-d0fe-4be5-aba4-56197b2fd4fb"
            ) {
              const { error: updateErr } = await supabase
                .schema("majordhome")
                .from("leads")
                .update({
                  status_id: STATUS_DEVIS_ENVOYE,
                  quote_sent_date: new Date().toISOString().split("T")[0],
                  client_id: clientId,
                  estimated_revenue: maxQuoteHT,
                  notes: `[Sync PL] Devis ${quoteLabel || ""} - ${maxQuoteHT.toFixed(0)} EUR HT`,
                })
                .eq("id", existingLead.id);
              if (updateErr) {
                log.push(`[lead-update-error] ${displayName}: ${updateErr.message}`);
              } else {
                leadsUpdated++;
                log.push(`[lead-updated] ${displayName} -> Devis envoye (${maxQuoteHT} EUR HT)`);
              }
            }
          } else {
            // Creer un lead via insert direct dans majordhome.leads
            const { error: leadError } = await supabase
              .schema("majordhome")
              .from("leads")
              .insert({
                org_id: ORG_ID,
                first_name: firstName.toUpperCase(),
                last_name: lastName.toUpperCase(),
                email: email,
                phone: phone,
                address: billing.address || null,
                postal_code: billing.postal_code || null,
                city: billing.city || null,
                company_name: isCompany ? displayName : null,
                status_id: STATUS_DEVIS_ENVOYE,
                quote_sent_date: new Date().toISOString().split("T")[0],
                client_id: clientId,
                estimated_revenue: maxQuoteHT,
                notes: `[Sync PL] Devis ${quoteLabel || ""} - ${maxQuoteHT.toFixed(0)} EUR HT`,
                external_source: "pennylane",
              });

            if (leadError) {
              log.push(`[lead-error] ${displayName}: ${leadError.message}`);
            } else {
              leadsCreated++;
              log.push(`[lead-created] ${displayName} -> Devis envoye (${maxQuoteHT} EUR HT)`);
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
