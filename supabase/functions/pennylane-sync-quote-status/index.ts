// supabase/functions/pennylane-sync-quote-status/index.ts
// Cron 15 min : sync quote_status Pennylane → DB + sync customer fields → clients MDH
// Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §9
//
// Auth : verify_jwt:false — protégée par MDH_CRON_SECRET (pattern P0.2)
//
// NOTE : cette edge function appelle l'API Pennylane **directement** (pas via
// pennylane-proxy) car elle tourne sans JWT user — pennylane-proxy nécessite
// verify_jwt:true + membership check qui n'a pas de sens ici.

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
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    });

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

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  // Auth : Bearer secret partagé (pattern P0.2 — requireSharedSecret retourne
  // Response|null, pas {ok, response})
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
    // 1. Charger les orgs Pennylane-activées
    // settings->pennylane->>enabled = "true" (valeur JSON string)
    const { data: orgs, error: orgsErr } = await supabase
      .schema("core")
      .from("organizations")
      .select("id, settings");

    if (orgsErr) throw orgsErr;

    // Filtrer côté JS (PostgREST ne supporte pas facilement les filtres jsonb imbriqués)
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
): Promise<{
  quote_status_updates: number;
  customer_field_updates: number;
  ejections: number;
  winning_quotes_set: number;
}> {
  let quote_status_updates = 0;
  let customer_field_updates = 0;
  let ejections = 0;
  let winning_quotes_set = 0;

  // 1. Récupérer tous les devis actifs (non éjectés) de cette org
  const { data: attachedQuotes, error: aqErr } = await supabase
    .from("majordhome_lead_pennylane_quotes")
    .select(
      "id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_status, is_winning_quote",
    )
    .eq("org_id", orgId)
    .is("ejected_at", null);

  if (aqErr) throw aqErr;
  if (!attachedQuotes || attachedQuotes.length === 0) {
    return { quote_status_updates, customer_field_updates, ejections, winning_quotes_set };
  }

  // 2. Sync quote_status pour chaque devis
  for (const aq of attachedQuotes) {
    if (!aq.pennylane_quote_id) continue;

    try {
      const { status: httpStatus, data: rawData } = await callPennylaneApi(
        `/quotes/${aq.pennylane_quote_id}`,
        apiToken,
      );

      if (httpStatus === 404) {
        // Devis supprimé côté Pennylane → eject
        const { error: ejectErr } = await supabase
          .schema("majordhome")
          .from("lead_pennylane_quotes")
          .update({
            ejected_at: new Date().toISOString(),
            ejected_reason: "deleted_in_pennylane",
          })
          .eq("id", aq.id);

        if (ejectErr) {
          console.warn(`[pennylane-sync] eject error for quote ${aq.id}:`, ejectErr.message);
        } else {
          ejections++;
          console.log(
            `[pennylane-sync] ejected quote ${aq.pennylane_quote_id} (deleted in PL)`,
          );
        }
        continue;
      }

      if (httpStatus < 200 || httpStatus >= 300) {
        console.warn(
          `[pennylane-sync] quote ${aq.pennylane_quote_id} returned HTTP ${httpStatus}`,
        );
        continue;
      }

      // L'API Pennylane retourne { quote: {...} }
      const plQuote = (rawData as { quote?: PennylaneQuote })?.quote ?? null;
      if (!plQuote) continue;

      // Sync status si différent
      if (plQuote.status && plQuote.status !== aq.quote_status) {
        const { error: updateErr } = await supabase
          .schema("majordhome")
          .from("lead_pennylane_quotes")
          .update({ quote_status: plQuote.status })
          .eq("id", aq.id);

        if (updateErr) {
          console.warn(
            `[pennylane-sync] status update error for quote ${aq.id}:`,
            updateErr.message,
          );
        } else {
          quote_status_updates++;
          console.log(
            `[pennylane-sync] quote ${aq.pennylane_quote_id}: ${aq.quote_status} → ${plQuote.status}`,
          );
        }
      }
    } catch (e) {
      console.warn(
        `[pennylane-sync] error fetching quote ${aq.pennylane_quote_id}:`,
        (e as Error)?.message,
      );
    }
  }

  // 3. Pose is_winning_quote sur le plus récent accepted (si aucun déjà posé)
  try {
    const { data: winnersSet, error: winnersErr } = await supabase.rpc(
      "pennylane_sync_ensure_winning_quotes",
      { p_org_id: orgId },
    );
    if (winnersErr) {
      console.warn(
        `[pennylane-sync] ensure_winning_quotes error for org ${orgId}:`,
        winnersErr.message,
      );
    } else {
      winning_quotes_set = (winnersSet as number) ?? 0;
    }
  } catch (e) {
    console.warn(
      `[pennylane-sync] ensure_winning_quotes exception for org ${orgId}:`,
      (e as Error)?.message,
    );
  }

  // 4. Sync customer fields PL → clients MDH (COALESCE strict)
  customer_field_updates = await syncCustomerFields(
    supabase,
    orgId,
    apiToken,
    attachedQuotes,
  );

  return { quote_status_updates, customer_field_updates, ejections, winning_quotes_set };
}

// ---------------------------------------------------------------------------
// syncCustomerFields — sync champs contact PL → clients MDH
// COALESCE strict : ne jamais écraser avec null/vide
// ---------------------------------------------------------------------------

async function syncCustomerFields(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  apiToken: string,
  attachedQuotes: Array<{ pennylane_customer_id: number | null }>,
): Promise<number> {
  let updates = 0;

  // Dédup sur pennylane_customer_id
  const uniqueCustomerIds = Array.from(
    new Set(
      attachedQuotes
        .map((q) => q.pennylane_customer_id)
        .filter((id): id is number => id !== null),
    ),
  );

  for (const customerId of uniqueCustomerIds) {
    try {
      // Fetch customer PL
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

      // L'API Pennylane retourne { customer: {...} }
      const plCustomer = (rawData as { customer?: PennylaneCustomer })
        ?.customer ?? null;
      if (!plCustomer) continue;

      // Trouver le client MDH via pennylane_sync
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
          syncErr.message,
        );
        continue;
      }
      if (!syncRow?.local_id) continue;

      // Extraire les valeurs PL non-nulles (COALESCE strict)
      const updatePayload: Record<string, unknown> = {};

      if (plCustomer.first_name?.trim()) {
        updatePayload.first_name = plCustomer.first_name.trim();
      }
      if (plCustomer.last_name?.trim()) {
        updatePayload.last_name = plCustomer.last_name.trim();
      }

      // Email : priorité billing_email, sinon emails[is_default], sinon premier
      const email =
        plCustomer.billing_email?.trim() ||
        plCustomer.emails?.find((e) => e.is_default)?.value?.trim() ||
        plCustomer.emails?.[0]?.value?.trim();
      if (email) updatePayload.email = email;

      // Téléphone
      const phone = (plCustomer.billing_phone || plCustomer.phone)?.trim();
      if (phone) updatePayload.phone = phone;

      // Adresse
      if (plCustomer.billing_address?.street?.trim()) {
        updatePayload.address = plCustomer.billing_address.street.trim();
      }
      if (plCustomer.billing_address?.postal_code?.trim()) {
        updatePayload.postal_code = plCustomer.billing_address.postal_code.trim();
      }
      if (plCustomer.billing_address?.city?.trim()) {
        updatePayload.city = plCustomer.billing_address.city.trim();
      }

      if (Object.keys(updatePayload).length === 0) continue;

      updatePayload.updated_at = new Date().toISOString();

      const { error: updateErr } = await supabase
        .schema("majordhome")
        .from("clients")
        .update(updatePayload)
        .eq("id", syncRow.local_id)
        .eq("org_id", orgId);

      if (updateErr) {
        console.warn(
          `[pennylane-sync] client update error (pl_customer ${customerId}):`,
          updateErr.message,
        );
      } else {
        updates++;
      }
    } catch (e) {
      console.warn(
        `[pennylane-sync] customer ${customerId} sync exception:`,
        (e as Error)?.message,
      );
    }
  }

  return updates;
}
