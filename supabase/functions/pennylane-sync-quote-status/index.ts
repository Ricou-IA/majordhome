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

interface AttachedQuote {
  id: string;
  lead_id: string;
  pennylane_quote_id: number;
  pennylane_customer_id: number | null;
  quote_status: string | null;
  quote_amount_ht: number | string | null;
  quote_label: string | null;
  quote_date: string | null;
  is_winning_quote: boolean;
  pdf_url: string | null;
  assigned_at: string;
}

// Seuil pipeline commercial. ⚠️ COPIE de src/lib/constants.js — Deno ne peut pas
// importer le code frontend. Toute modification du seuil doit toucher LES DEUX.
// 2026-08-05 : descendu de 1000 à 500 (demande equipe — le SAV est sous 500).
const PIPELINE_MIN_AMOUNT_HT = 500;

// ---------------------------------------------------------------------------
// Miroir local — source de LECTURE (refonte 2026-08-11)
// ---------------------------------------------------------------------------
//
// Cette fonction interrogeait Pennylane entité par entité : 363 devis + 209
// clients + 209 listes = 781 appels ≈ 322 s, contre un wall-clock de 150 s
// (plan Free ; 400 s en Pro). Elle était donc tuée dans sa 1ʳᵉ étape à CHAQUE
// exécution, depuis des semaines, sur l'ancien projet comme sur le neuf — les
// étapes 3 à 5 n'ont jamais tourné. Échec parfaitement silencieux : pg_cron
// affiche `succeeded` parce que net.http_post est asynchrone.
//
// Or `pennylane-quotes-sweep` récupère les mêmes devis en 3 appels et 2 s,
// toutes les 5 min, et les range dans `majordhome_pennylane_quotes` — miroir
// déjà lu par 3 écrans (DevisExplorer, Dashboard, TabDevisPL). PRINCIPE :
// **Pennylane fait foi pour l'écriture, on lit le miroir.**
//
// Le miroir couvre pending | expired | accepted | invoiced | denied (`denied`
// réintégré le 2026-08-11 : le refus place la carte en Perdu, ce n'est pas une
// info morte). `draft` reste dehors — non filtrable côté PL. Un devis passé en
// draft n'est donc pas auto-attaché tant qu'il n'est pas envoyé : acceptable,
// un brouillon n'a rien à faire dans le pipeline commercial.

// Au-delà, les données du sweep sont considérées périmées : on s'abstient
// plutôt que d'appliquer du vieux. Le sweep tourne toutes les 5 min — 30 min
// signifie qu'il est cassé, et écrire sur la foi d'un miroir figé est pire que
// ne rien faire.
const MIRROR_MAX_AGE_MINUTES = 30;

// Seuls appels Pennylane restants : lever le doute sur un devis marqué disparu
// du périmètre balayé. Plafonné pour que la durée d'exécution reste bornée.
const MISSING_VERIFY_MAX_PER_RUN = 20;

const MIRROR_PAGE = 1000;

interface MirrorQuote {
  pennylane_quote_id: number;
  quote_number: string | null;
  label: string | null;
  status: string | null;
  quote_date: string | null;
  amount_ht: number | string | null;
  pdf_url: string | null;
  customer_id: number | null;
  missing_since: string | null;
  synced_at: string;
}

interface CachedCustomer {
  pennylane_id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
}

// Pagination explicite : PostgREST plafonne silencieusement à 1000 lignes. Une
// troncature muette ici ferait passer des devis pour absents du miroir — donc
// non synchronisés, sans le moindre signal. On pagine jusqu'à épuisement.
async function fetchAllPages<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += MIRROR_PAGE) {
    const { data, error } = await query(from, from + MIRROR_PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < MIRROR_PAGE) return out;
  }
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

// NOTE — l'extraction des champs client depuis la réponse Pennylane brute
// (billing_email, `emails` en array de strings OU d'objets, billing_address
// .address avec fallback .street) vivait ici. Elle est désormais faite EN AMONT,
// une seule fois, par le sweep qui aplatit `pennylane_customer_lookup` : on lit
// des colonnes déjà normalisées. Le cas `emails` string-array — bug corrigé le
// 2026-06-10, l'email n'était jamais synchronisé — est donc traité une fois pour
// toutes côté sweep au lieu d'être dupliqué dans chaque consommateur.

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
  const attachedQuotes = await fetchAllPages<AttachedQuote>((from, to) =>
    supabase
      .from("majordhome_lead_pennylane_quotes")
      .select(
        "id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_status, quote_amount_ht, quote_label, quote_date, is_winning_quote, pdf_url, assigned_at",
      )
      .eq("org_id", orgId)
      .is("ejected_at", null)
      .range(from, to)
  );

  if (attachedQuotes.length === 0) {
    return {
      quote_status_updates: 0,
      customer_field_updates: 0,
      lead_field_updates: 0,
      auto_attached_quotes: 0,
      ejections: 0,
      winning_quotes_set: 0,
      skipped_stale_mirror: false,
    };
  }

  // 1bis. Charger le miroir local — la source de lecture de toute la suite.
  const mirrorRows = await fetchAllPages<MirrorQuote>((from, to) =>
    supabase
      .from("majordhome_pennylane_quotes")
      .select(
        "pennylane_quote_id, quote_number, label, status, quote_date, amount_ht, pdf_url, customer_id, missing_since, synced_at",
      )
      .eq("org_id", orgId)
      .range(from, to)
  );

  // Garde-fou de fraicheur : le sweep tourne toutes les 5 min. Au-dela de 30,
  // il est cassé — on s'abstient au lieu d'écrire sur la foi d'un miroir figé.
  // On rend 200 (le job a fait son travail : constater et refuser d'agir), en
  // marquant explicitement l'abstention pour qu'elle soit lisible côté cron.
  const freshest = mirrorRows.reduce<string | null>(
    (acc, r) => (!acc || r.synced_at > acc ? r.synced_at : acc),
    null,
  );
  const ageMinutes = freshest
    ? (Date.now() - new Date(freshest).getTime()) / 60000
    : Infinity;

  if (ageMinutes > MIRROR_MAX_AGE_MINUTES) {
    console.error(
      `[pennylane-sync] miroir périmé pour org ${orgId} : ` +
        `${freshest ? `${Math.round(ageMinutes)} min` : "aucune donnée"} ` +
        `(seuil ${MIRROR_MAX_AGE_MINUTES} min). Vérifier pennylane-quotes-sweep. ` +
        `Abstention volontaire — aucune écriture.`,
    );
    return {
      quote_status_updates: 0,
      customer_field_updates: 0,
      lead_field_updates: 0,
      auto_attached_quotes: 0,
      ejections: 0,
      winning_quotes_set: 0,
      skipped_stale_mirror: true,
    };
  }

  const mirrorByQuoteId = new Map<number, MirrorQuote>(
    mirrorRows.map((r) => [r.pennylane_quote_id, r]),
  );

  // 2. Sync quote_status + pdf_url depuis le miroir — zéro appel Pennylane.
  quote_status_updates = await syncAttachedQuoteFields(
    supabase, attachedQuotes, mirrorByQuoteId,
  );

  // 2bis. Lever le doute sur les devis sortis du périmètre balayé. SEULS appels
  // Pennylane restants, et plafonnés. Voir le commentaire de la fonction : un
  // devis absent du miroir n'est PAS un devis supprimé.
  await verifyMissingQuotes(
    supabase, apiToken, attachedQuotes, mirrorByQuoteId, ejections_ref,
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

  // 4. Sync identite PL -> MDH (clients + leads, mode OVERWRITE) — depuis le
  //    cache clients, alimenté par le sweep. Zéro appel Pennylane.
  const { customer_field_updates, lead_field_updates } =
    await syncIdentityFromPennylane(supabase, orgId, attachedQuotes);

  // 5. Auto-attach nouveaux devis PL pour bridges existants (bridge canonique)
  //    — depuis le miroir. Zéro appel Pennylane.
  const auto_attached_quotes = await autoAttachNewQuotes(
    supabase, orgId, attachedQuotes, mirrorRows,
  );

  return {
    quote_status_updates,
    customer_field_updates,
    lead_field_updates,
    auto_attached_quotes,
    ejections: ejections_ref.v,
    winning_quotes_set,
    skipped_stale_mirror: false,
  };
}

// ---------------------------------------------------------------------------
// syncAttachedQuoteFields — etape 2 : sync status + pdf_url des devis attaches
//
// Lit le miroir, n'appelle plus Pennylane. Les RPC d'écriture sont inchangées :
// seule la SOURCE des valeurs change, pas ce qui est écrit ni comment.
//
// Un devis absent du miroir n'est PAS traité — et surtout PAS éjecté. Absence
// = aucune information (brouillon hors périmètre, devis antérieur au miroir),
// jamais « supprimé ». Le doute se lève dans verifyMissingQuotes, sur preuve.
// ---------------------------------------------------------------------------

async function syncAttachedQuoteFields(
  supabase: ReturnType<typeof getAdminClient>,
  attachedQuotes: AttachedQuote[],
  mirrorByQuoteId: Map<number, MirrorQuote>,
): Promise<number> {
  let updates = 0;
  let notInMirror = 0;

  for (const aq of attachedQuotes) {
    if (!aq.pennylane_quote_id) continue;

    const m = mirrorByQuoteId.get(aq.pennylane_quote_id);
    if (!m) {
      notInMirror++;
      continue;
    }

    const plStatus = m.status ?? null;
    const plPdfUrl = m.pdf_url ?? null;
    const plAmountHt = m.amount_ht === null ? null : Number(m.amount_ht);
    const plLabel = m.quote_number || m.label || null;
    const plQuoteDate = m.quote_date ?? null;

    const statusDiffers = plStatus && plStatus !== aq.quote_status;

    // ⚠️ Le jeton `encrypted_id` de l'URL PDF est régénéré par Pennylane à
    // CHAQUE lecture : deux appels sur le même devis renvoient deux URL
    // différentes. Comparer les URL faisait donc diverger les 364 devis en
    // permanence — réécrits toutes les 15 min pour rien, et surtout compteur de
    // changements bloqué à « tous », donc aveugle aux vrais mouvements.
    // Les anciens jetons restent valides (vérifié le 2026-08-11 : une URL
    // stockée depuis des semaines renvoie toujours 200 application/pdf), on ne
    // pose donc le lien que s'il manque. Il est de toute façon rafraîchi dès
    // qu'un autre champ bouge, puisqu'il fait partie du même UPDATE.
    const pdfDiffers = !!plPdfUrl && !aq.pdf_url;
    // Comparaison numerique : quote_amount_ht revient en string depuis PostgREST.
    const amountDiffers =
      plAmountHt !== null && Number(plAmountHt) !== Number(aq.quote_amount_ht);
    const labelDiffers = plLabel && plLabel !== aq.quote_label;
    const dateDiffers = plQuoteDate && plQuoteDate !== aq.quote_date;

    if (!(statusDiffers || pdfDiffers || amountDiffers || labelDiffers || dateDiffers)) {
      continue;
    }

    const { data: updResult, error: updErr } = await supabase.rpc(
      'pennylane_sync_update_quote_fields',
      {
        p_quote_id: aq.id,
        p_new_status: plStatus,
        p_pdf_url: plPdfUrl,
        p_amount_ht: plAmountHt,
        p_label: plLabel,
        p_quote_date: plQuoteDate,
        p_pipeline_min_ht: PIPELINE_MIN_AMOUNT_HT,
      },
    );

    if (updErr) {
      console.warn(
        `[pennylane-sync] fields update failed for quote ${aq.id}:`,
        sanitizeError(updErr, 'fields update failed'),
      );
      continue;
    }

    updates++;
    if (updResult?.revision) {
      console.log(
        `[pennylane-sync] revision quote ${aq.pennylane_quote_id}: ` +
          `delta ${updResult.amount_delta}€ (${updResult.source}) flags=${JSON.stringify(updResult.anomaly_flags)}`,
      );
    }
  }

  // Jamais silencieux : une couverture qui se dégrade doit se voir dans les logs
  // avant de se voir dans le pipeline.
  if (notInMirror > 0) {
    console.warn(
      `[pennylane-sync] ${notInMirror}/${attachedQuotes.length} devis attachés ` +
        `absents du miroir — non synchronisés (ni éjectés). Périmètre du sweep ?`,
    );
  }

  return updates;
}

// ---------------------------------------------------------------------------
// verifyMissingQuotes — etape 2bis : SEULS appels Pennylane restants
//
// `missing_since` signifie « sorti du périmètre balayé », PAS « supprimé ».
// Avant le 2026-08-11 il était même posé sur tout devis passant en refusé
// (cf. 20260807_2_mark_missing_refuse_wipe.sql) : brancher une éjection dessus
// aurait détaché 142 devis du pipeline en silence. Le périmètre élargi supprime
// ce faux positif, mais `draft` reste dehors — donc on ne déduit rien, on
// vérifie. Un GET tranche : 404 = supprimé (éjection), 2xx = toujours là.
// ---------------------------------------------------------------------------

async function verifyMissingQuotes(
  supabase: ReturnType<typeof getAdminClient>,
  apiToken: string,
  attachedQuotes: AttachedQuote[],
  mirrorByQuoteId: Map<number, MirrorQuote>,
  ejections_ref: { v: number },
): Promise<void> {
  const candidates = attachedQuotes
    .filter((aq) => {
      const m = aq.pennylane_quote_id
        ? mirrorByQuoteId.get(aq.pennylane_quote_id)
        : undefined;
      return !!m?.missing_since;
    })
    .sort((a, b) => {
      const ma = mirrorByQuoteId.get(a.pennylane_quote_id)!.missing_since!;
      const mb = mirrorByQuoteId.get(b.pennylane_quote_id)!.missing_since!;
      return ma < mb ? -1 : ma > mb ? 1 : 0;
    });

  if (candidates.length === 0) return;

  const batch = candidates.slice(0, MISSING_VERIFY_MAX_PER_RUN);
  if (candidates.length > batch.length) {
    console.log(
      `[pennylane-sync] ${candidates.length} devis à vérifier, ` +
        `${batch.length} traités ce passage (les plus anciens d'abord)`,
    );
  }

  for (const aq of batch) {
    try {
      const { status: httpStatus } = await callPennylaneApi(
        `/quotes/${aq.pennylane_quote_id}`,
        apiToken,
      );

      if (httpStatus === 404) {
        const { error: ejectErr } = await supabase.rpc('pennylane_sync_eject_quote', {
          p_quote_id: aq.id,
          p_reason: 'deleted_in_pennylane',
        });
        if (ejectErr) {
          console.warn(
            `[pennylane-sync] eject failed for quote ${aq.id}:`,
            sanitizeError(ejectErr, 'eject failed'),
          );
        } else {
          ejections_ref.v++;
        }
      }
      // 2xx : le devis existe, il a juste quitté le périmètre balayé (draft).
      // Rien à faire — surtout pas l'éjecter.
    } catch (e) {
      console.warn(
        `[pennylane-sync] verify failed for quote ${aq.pennylane_quote_id}:`,
        sanitizeError(e, 'verify failed'),
      );
    }
  }
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

  // Cache clients, alimenté en write-through par le sweep (qui en résout 40 par
  // passage — les manquants se comblent seuls en quelques cycles). Ses colonnes
  // à plat sont EXACTEMENT les 7 champs qu'on écrivait auparavant après parsing
  // de la réponse Pennylane brute : first_name, last_name, email, phone,
  // address, postal_code, city. Aucune conversion n'est réécrite ici — c'est ce
  // qui garantit qu'on écrit la même chose qu'avant.
  const cacheRows = await fetchAllPages<CachedCustomer>((from, to) =>
    supabase
      .from("majordhome_pennylane_customer_lookup")
      .select("pennylane_id, first_name, last_name, email, phone, address, postal_code, city")
      .eq("org_id", orgId)
      .range(from, to)
  );
  const cacheById = new Map<number, CachedCustomer>(
    cacheRows.map((c) => [c.pennylane_id, c]),
  );

  let notInCache = 0;

  for (const [customerId, leadIds] of bridgeMap) {
    try {
      const cached = cacheById.get(customerId);
      if (!cached) {
        notInCache++;
        continue;
      }

      // Même règle qu'avant : on n'écrase qu'avec une valeur non vide.
      const updatePayload: Record<string, string> = {};
      for (const [key, value] of Object.entries({
        first_name: cached.first_name,
        last_name: cached.last_name,
        email: cached.email,
        phone: cached.phone,
        address: cached.address,
        postal_code: cached.postal_code,
        city: cached.city,
      })) {
        if (typeof value === "string" && value.trim()) updatePayload[key] = value.trim();
      }
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

  // Dégradation temporaire attendue, pas une panne : le sweep comble le cache à
  // raison de 40 clients par passage. Loggé pour que « temporaire » reste vérifiable.
  if (notInCache > 0) {
    console.log(
      `[pennylane-sync] ${notInCache}/${bridgeMap.size} clients absents du cache — ` +
        `identité non synchronisée ce passage (le sweep les résout progressivement)`,
    );
  }

  return { customer_field_updates, lead_field_updates };
}

// ---------------------------------------------------------------------------
// autoAttachNewQuotes — etape 5 : auto-attach nouveaux devis PL pour bridges
// existants. Pour chaque customer ayant deja un bridge (>=1 devis attache),
// attache les devis du miroir qui ne sont pas encore en base.
//
// Respecte le seuil pipeline PIPELINE_MIN_AMOUNT_HT (SAV/entretien exclus).
// Respecte les ejections manuelles (RPC pennylane_sync_auto_attach_quote
// no-op si quote_pl_id existe en base, meme ejected).
//
// Bridge lead_id : on prend la rangee la plus recemment assignee pour chaque
// customer (assigned_at DESC).
// ---------------------------------------------------------------------------

async function autoAttachNewQuotes(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  attachedQuotes: AttachedQuote[],
  mirrorRows: MirrorQuote[],
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

  // Le miroir contient déjà tous les devis de l'org : un seul parcours en
  // mémoire remplace une requête Pennylane par client. Un devis est candidat
  // s'il appartient à un client déjà bridgé et n'est pas déjà attaché.
  //
  // Limite assumée : `draft` étant hors périmètre du sweep, un brouillon n'est
  // pas auto-attaché tant qu'il n'est pas envoyé. C'est le comportement voulu —
  // un brouillon n'a rien à faire dans le pipeline commercial.
  for (const q of mirrorRows) {
    const customerId = q.customer_id;
    if (!customerId) continue;

    const bridge = bridgeMap.get(customerId);
    if (!bridge) continue;                                  // client sans bridge
    if (attachedPlIds.has(q.pennylane_quote_id)) continue;  // deja attache

    const amountHt = Number(q.amount_ht ?? 0);
    if (amountHt < PIPELINE_MIN_AMOUNT_HT) continue; // SAV/entretien hors pipeline

    const label = q.quote_number || q.label || `Q-${q.pennylane_quote_id}`;
    const quoteDate = q.quote_date || new Date().toISOString().slice(0, 10);

    try {
      const { data: result, error: attachErr } = await supabase.rpc(
        'pennylane_sync_auto_attach_quote',
        {
          p_org_id: orgId,
          p_lead_id: bridge.lead_id,
          p_quote_pl_id: q.pennylane_quote_id,
          p_customer_id: customerId,
          p_amount_ht: amountHt,
          p_label: label,
          p_quote_date: quoteDate,
          p_status: q.status ?? null,
          p_pdf_url: q.pdf_url ?? null,
        },
      );

      if (attachErr) {
        console.warn(
          `[pennylane-sync] auto-attach failed for quote ${q.pennylane_quote_id}:`,
          sanitizeError(attachErr, 'auto-attach failed'),
        );
        continue;
      }

      const wasAttached = (result as { attached?: boolean } | null)?.attached === true;
      if (wasAttached) {
        attached++;
        console.log(
          `[pennylane-sync] auto-attached quote ${q.pennylane_quote_id} ` +
            `(${label}, ${amountHt}€) to lead ${bridge.lead_id}`,
        );
      }
    } catch (e) {
      console.warn(
        `[pennylane-sync] auto-attach exception for quote ${q.pennylane_quote_id}:`,
        sanitizeError(e, 'auto-attach exception'),
      );
    }
  }

  return attached;
}
