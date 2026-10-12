// supabase/functions/pennylane-sync-quote-status/index.ts
// Cron 15 min : synchro identité client MDH ⇄ PL par deltas (journal PL, rejeu des
// pushes en attente — cf. _shared/pennylaneCustomerSync.ts) + sync devis attachés
// (status + pdf_url) + identité PL → leads + auto-attach nouveaux devis PL.
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
import { runCustomerIdentitySync } from "../_shared/pennylaneCustomerSync.ts";

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

// Seuil pipeline = réglage d'org `settings.pennylane.pipeline_min_amount_ht`
// (20261012_5). Plus de copie ici : pennylane_sync_auto_attach_pending et
// pennylane_sync_update_quote_fields lisent majordhome.pl_pipeline_min_amount_ht().

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
      customer_identity: [] as unknown[],
      quote_status_updates: 0,
      customer_field_updates: 0,
      lead_field_updates: 0,
      auto_attached_quotes: 0,
      ejections: 0,
      winning_quotes_set: 0,
      errors: [] as string[],
    };

    for (const org of plOrgs) {
      // Synchro identité client par deltas — indépendante des devis : elle tourne même
      // sans devis rattaché ou miroir périmé, et son échec n'empêche pas la suite.
      try {
        const identity = await runCustomerIdentitySync(supabase, PENNYLANE_API_TOKEN, org.id);
        summary.customer_identity.push({ org: org.id, ...identity });
        summary.customer_field_updates += identity.clients_updated;
        for (const e of identity.errors) summary.errors.push(`org ${org.id} identité : ${e}`);
      } catch (idErr) {
        const msg = sanitizeError(idErr, "Customer identity sync failed");
        console.warn(`[pennylane-sync] org ${org.id} identité : ${msg}`);
        summary.errors.push(`org ${org.id} identité : ${msg}`);
      }

      try {
        const result = await syncOrgQuotes(supabase, org.id, PENNYLANE_API_TOKEN);
        summary.processed_orgs++;
        summary.quote_status_updates += result.quote_status_updates;
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

  // 0. Rattachement automatique des devis en attente (RPC, 20261012_5) — AVANT
  //    le retour anticipé ci-dessous : une org sans aucun devis rattaché doit
  //    pouvoir attacher sa première carte. Candidats, seuil d'org, écartés et
  //    éjectés : tout est tranché en SQL.
  const auto_attached_quotes = await autoAttachPendingQuotes(supabase, orgId);

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
      lead_field_updates: 0,
      auto_attached_quotes,
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
      lead_field_updates: 0,
      auto_attached_quotes, // l'étape 0 a déjà écrit : on le dit
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

  // 4. Identite PL -> leads (OVERWRITE, PL canonical post-attache) — depuis le
  //    cache clients. Zéro appel Pennylane. Les clients : runCustomerIdentitySync.
  const { lead_field_updates } =
    await syncIdentityFromPennylane(supabase, orgId, attachedQuotes);

  // 5. Rattachement automatique : fait en étape 0 (autoAttachPendingQuotes).

  return {
    quote_status_updates,
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
// syncIdentityFromPennylane — etape 4 : identite PL -> LEADS uniquement
// Lead(s) bridges via lead_pennylane_quotes : OVERWRITE depuis le cache (PL canonical
// post-attache, contact du lead en lecture seule).
//
// Les CLIENTS ne sont plus ecrits ici (2026-10-11). Cette etape reimposait toutes
// les 15 min la fiche du cache sur le client MDH ; or le cache n'etait jamais
// rafraichi : toute correction faite dans MDH etait ecrasee par une photo perimee
// (HELLARD CLI-03715). La fiche client est desormais synchronisee par DELTAS dans
// les deux sens (runCustomerIdentitySync, appele avant syncOrgQuotes) ; ce meme
// mecanisme tient le cache a jour (journal PL + push MDH), donc les leads lus ici
// suivent les modifications faites d'un cote comme de l'autre.
// ---------------------------------------------------------------------------

async function syncIdentityFromPennylane(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  attachedQuotes: AttachedQuote[],
): Promise<{ lead_field_updates: number }> {
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

  return { lead_field_updates };
}

// ---------------------------------------------------------------------------
// autoAttachPendingQuotes — étape 0 : rattachement automatique des devis en
// attente, en SQL (RPC pennylane_sync_auto_attach_pending, 20261012_5).
//
// Avant : seuls les devis SUIVANTS d'un client déjà ponté par un devis rattaché
// étaient traités ; le PREMIER devis ne l'était jamais (ROZIÈRES, 2026-10-12),
// le seuil était une constante copiée et les devis écartés n'étaient pas
// respectés. La RPC choisit les candidats (miroir, ≥ seuil d'org, ni rattaché,
// ni éjecté, ni écarté), résout la carte (pont par devis rattaché, sinon client
// ponté / contact Pennylane → carte active) et écrit via
// pennylane_sync_auto_attach_quote. Sans carte active : rien (no_lead), le
// devis reste « Non rattaché » dans /devis et sera réexaminé au passage suivant.
// ---------------------------------------------------------------------------

async function autoAttachPendingQuotes(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("pennylane_sync_auto_attach_pending", {
    p_org_id: orgId,
    p_dry_run: false,
  });
  if (error) {
    // Pas de throw : statuts et identité ne doivent pas tomber avec le
    // rattachement. Bruyant quand même, et compté 0.
    console.warn(
      `[pennylane-sync] auto-attach RPC failed:`,
      sanitizeError(error, "auto-attach failed"),
    );
    return 0;
  }
  const res = (data ?? {}) as {
    attached?: number; examined?: number; no_lead?: number; min_amount_ht?: number; details?: unknown[];
  };
  if ((res.attached ?? 0) > 0 || (res.no_lead ?? 0) > 0) {
    console.log(
      `[pennylane-sync] auto-attach: ${res.attached ?? 0} rattaché(s), ${res.no_lead ?? 0} sans carte ` +
        `(seuil ${res.min_amount_ht} € HT, ${res.examined ?? 0} examiné(s))`,
      JSON.stringify(res.details ?? []).slice(0, 2000),
    );
  }
  return res.attached ?? 0;
}
