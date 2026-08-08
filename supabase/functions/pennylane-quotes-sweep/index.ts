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

// Borne dure de la résolution de noms. Ce balayage tourne toutes les 5 min :
// on refuse d'y empiler des centaines d'appels unitaires. Le reliquat part au
// cycle suivant — le cache se remplit en quelques passages.
const RESOLVE_MAX_PER_SWEEP = 40;

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

// Shape de GET /customers/{id}. ATTENTION : Pennylane V2 renvoie la ressource
// DIRECTEMENT AU ROOT, elle n'est PAS enveloppée dans { customer: … }.
// Assumer l'enveloppe a déjà fait sauter 155 devis en silence sur ce projet.
interface PennylaneCustomer {
  id?: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  customer_type?: string;
  billing_email?: string;
  email?: string;
  phone?: string;
  address?: string;
  postal_code?: string;
  city?: string;
  reference?: string;
  external_reference?: string;
}

// `name` est absent pour un particulier → composer depuis first_name/last_name.
function formatCustomerName(
  c?: { name?: string; first_name?: string; last_name?: string } | null,
): string | null {
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

  // --- Normalisation des échéances -----------------------------------------
  // Un seul PUT par devis : le statut `expired` est DÉRIVÉ de `deadline` côté
  // Pennylane (établi par test le 2026-08-07), il se recalcule seul. Ne PAS
  // appeler /update_status.
  //
  // La cible vient de la RPC (majordhome.pl_quote_target_deadline), qui ne
  // renvoie que des allongements : une échéance prolongée à la main n'est
  // jamais raccourcie par ce balayage (garde posée en migration 20260807_1d).
  let normalized = 0;
  let normalizeErrors = 0;
  // Détail des échecs. Sans lui, un devis que Pennylane refuse durablement est
  // retenté à CHAQUE passage sans qu'on sache pourquoi : le compteur d'erreurs
  // ne revient jamais à zéro et perd toute valeur d'alarme. Borné à 5 pour ne
  // pas gonfler la réponse.
  const normalizeFailures: { id: number; target: string; status: number; detail: string }[] = [];

  if (applyDeadlines && toNormalize.length > 0) {
    // Rate limit PL V2 = 25 req / 5 s → 5 en vol maximum.
    const CONCURRENCY = 5;
    for (let i = 0; i < toNormalize.length; i += CONCURRENCY) {
      const batch = toNormalize.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async ({ id, target }) => {
        try {
          const { status, data } = await callPennylane(`/quotes/${id}`, apiToken, {
            method: "PUT",
            body: JSON.stringify({ deadline: target }),
          });
          if (status >= 200 && status < 300) {
            normalized++;
          } else {
            normalizeErrors++;
            if (normalizeFailures.length < 5) {
              normalizeFailures.push({
                id,
                target,
                status,
                detail: typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300),
              });
            }
          }
        } catch (e) {
          normalizeErrors++;
          if (normalizeFailures.length < 5) {
            normalizeFailures.push({ id, target, status: 0, detail: sanitizeError(e, "PUT failed") });
          }
        }
      }));
    }
  }

  // --- Résolution des noms clients manquants ---------------------------------
  // L'endpoint LISTE /quotes n'embarque QUE `customer.id`, jamais le nom : seul
  // le GET unitaire /customers/{id} le porte. Les devis dont le client n'est pas
  // encore dans majordhome.pennylane_customer_lookup ressortent donc sans
  // customer_name (« Client inconnu » sur /devis).
  //
  // On fetche ces clients et on alimente LE CACHE — magasin canonique des noms
  // (write-through D.5) qui sert aussi resolveCustomerNames, la recherche
  // « Client existant » et le rapprochement de devis. Le COALESCE de
  // pennylane_quotes_upsert_batch reprendra la valeur au passage suivant : la
  // table jumelle se répare seule en 2-3 cycles de 5 min.
  //
  // On ne réinjecte volontairement PAS les lignes de devis pour converger en un
  // seul passage : une seule voie de résolution vaut mieux que deux mécanismes
  // concurrents.
  //
  // NB : la RPC appelée ici est la jumelle service_role de
  // upsert_pennylane_customer_lookup(), inappelable depuis une edge function
  // (elle vérifie auth.uid(), NULL hors contexte utilisateur). Cf. migration
  // 20260807_5.
  //
  // JAMAIS bloquante : un nom non résolu est cosmétique, une matérialisation
  // ratée ne l'est pas. D'où le try/catch qui compte l'échec sans le propager.
  let customersResolved = 0;
  let customersPending = 0;
  let resolveError: string | null = null;

  try {
    const { data: missingRows, error: missingErr } = await supabase
      .from("majordhome_pennylane_quotes")
      .select("customer_id")
      .eq("org_id", orgId)
      .is("customer_name", null)
      .not("customer_id", "is", null)
      .limit(200);
    if (missingErr) throw missingErr;

    const uniqueIds = [
      ...new Set(
        (missingRows ?? [])
          .map((r) => Number((r as { customer_id: number | string }).customer_id))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ];
    const batch = uniqueIds.slice(0, RESOLVE_MAX_PER_SWEEP);

    const payloads: Record<string, unknown>[] = [];
    const CONCURRENCY = 5; // rate limit PL V2 = 25 req / 5 s
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const slice = batch.slice(i, i + CONCURRENCY);
      const fetched = await Promise.all(slice.map(async (id) => {
        // Un client qui échoue ne doit pas emporter les 4 autres du lot.
        try {
          const { status, data } = await callPennylane(`/customers/${id}`, apiToken);
          if (status !== 200 || !data || typeof data !== "object") return null;
          return { id, customer: data as PennylaneCustomer };
        } catch {
          return null;
        }
      }));

      for (const f of fetched) {
        if (!f) continue;
        const c = f.customer;
        const name = formatCustomerName(c);
        if (!name) continue; // rien d'exploitable : ne pas polluer le cache
        payloads.push({
          pennylane_id: Number(c.id ?? f.id),
          name,
          first_name: c.first_name ?? null,
          last_name: c.last_name ?? null,
          customer_type: c.customer_type ?? null,
          email: c.billing_email ?? c.email ?? null,
          phone: c.phone ?? null,
          address: c.address ?? null,
          postal_code: c.postal_code ?? null,
          city: c.city ?? null,
          external_reference: c.reference ?? c.external_reference ?? null,
          raw_payload: c,
        });
      }
    }

    // Reste à traiter : dépassement du plafond ET clients non résolus (fetch
    // KO ou sans nom exploitable). Le passage suivant les recomptera depuis la
    // base — ce compteur sert à voir si le mécanisme converge.
    customersPending = uniqueIds.length - payloads.length;

    if (payloads.length > 0) {
      const { error: cacheErr } = await supabase.rpc(
        "pennylane_customer_lookup_upsert_batch",
        { p_org_id: orgId, p_rows: payloads },
      );
      if (cacheErr) throw cacheErr;
      customersResolved = payloads.length;
    }
  } catch (e) {
    resolveError = sanitizeError(e, "customer resolution failed");
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
    normalized,
    normalize_errors: normalizeErrors,
    normalize_failures: normalizeFailures,
    marked_missing: missing ?? 0,
    apply_deadlines: applyDeadlines,
    customers_resolved: customersResolved,
    customers_pending: customersPending,
    ...(resolveError ? { customers_resolve_error: resolveError } : {}),
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

  // Interrupteurs d'écriture. Tant qu'aucun des deux n'est vrai, la fonction ne
  // touche PAS aux devis Pennylane : elle matérialise et compte seulement.
  //
  // Les deux canaux sont volontairement distincts :
  //   - corps `{ "apply_deadlines": true }` → passage MANUEL délibéré, décidé
  //     appel par appel (campagnes de normalisation pilotées à la main) ;
  //   - env `MDH_PL_APPLY_DEADLINES` → gouverne le CRON planifié.
  //
  // Préfixe MDH_ obligatoire : les secrets d'edge functions Supabase sont au
  // niveau du PROJET, et cette instance est partagée avec Pack Vendeur, Baikal
  // et Arpet. Un nom sans préfixe vit dans un espace de noms commun aux quatre.
  //
  // Le cron envoie `{}` : il reste donc en lecture seule tant que la variable
  // d'environnement n'est pas posée. Autoriser une campagne manuelle ne rend
  // PAS le balayage automatique écrivain — c'est la propriété qu'on protège.
  let bodyFlag = false;
  try {
    const body = await req.json();
    bodyFlag = body?.apply_deadlines === true;
  } catch { /* corps vide ou non-JSON : lecture seule */ }

  const applyDeadlines = Deno.env.get("MDH_PL_APPLY_DEADLINES") === "true" || bodyFlag;

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
