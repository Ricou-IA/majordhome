// ============================================================================
// webshop-process — Process des commandes boutique (étape 2, spec
// docs/superpowers/specs/2026-10-17-webshop-parametrage-livraison-process-design.md).
// ============================================================================
//
// Point d'entrée UNIQUE des changements de statut d'une commande (le front n'écrit plus
// `status` en direct), des événements de tournée et du rejeu d'une action. Le client est
// prévenu PAR ENVOI : colis = transitions (settings.webshop.process.transitions), palette =
// événements de tournée (process.tournee). Logique de décision = modules purs
// `_shared/webshop/process.js` (copie de src/lib/webshop/process.js) ; rendu / émission =
// `./logic.ts` (testé).
//
// POST JSON, `Authorization: Bearer <jwt utilisateur>` (verify_jwt = true) :
//   { kind: 'transition', order_id, to }
//     → droit webshop_can_process(org) (= role_can(org,'pipeline','edit'), JWT utilisateur) ;
//       canMoveTo sinon 409 invalid_transition ; statusPatch écrit via
//       majordhome_webshop_orders_write (filtré org_id + statut lu, sinon 409 invalid_transition) ;
//       un pas EN AVANT exécute actionsPourTransition, un retour en arrière se pose sans action.
//     ← 200 { order, actions: [ActionReport] }
//   { kind: 'tournee', slot_id, event: 'partie'|'livree' }
//     → webshop_slot_mark_event avec le JWT utilisateur (garde team_leader+ en base) ; pour chaque
//       commande du créneau : actionsPourTournee (payée, non annulée), statutCible posé AVANT les
//       e-mails (100 % palette seulement), e-mails palette.
//     ← 200 { slot: { slot_id, event, first_time }, orders: [{ order_id, statut_applique, actions }] }
//   { kind: 'retry', action_id }
//     → action relue (org vérifiée), `sent` refusée (409 already_sent), rejouée sur la même ligne.
//     ← 200 { action: ActionReport }
//
// ActionReport = { id, action, envoi, evenement, gabarit, status: 'sent'|'failed'|'skipped',
//                  error_code, error_message, recipient }
//   skipped/already_sent : réservation refusée (déjà envoyée ou envoi en cours < 10 min).
//   failed : template_missing, prestataire_missing, no_from_email, resend_failed,
//            reserve_failed, template_read_failed. skipped : no_email.
// L'échec d'une action n'échoue JAMAIS la requête (200 avec les actions en échec).
//
// Erreurs (corps { error: code, detail? }) : bad_request 400, invalid_event 400,
// not_found 404, forbidden 403 (pas membre, pas le droit, garde de tournée),
// invalid_transition 409, already_sent 409, slot_not_closed / slot_not_departed /
// slot_cancelled 409, internal_error 500. 401 du helper d'auth passé tel quel.
//
// Réservation : webshop_order_action_reserve (service_role) → uuid | NULL, puis envoi, puis
// webshop_order_action_record (service_role). `not_reserved` au record = réservation reprise
// par un autre appel (> 10 min) : journalisé, non fatal.
//
// Org = org CORE, toujours lue sur la commande / la tournée / l'action (client admin), jamais
// prise dans le payload. Env : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// RESEND_API_KEY.
// ============================================================================
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  buildCorsHeaders,
  getAdminClient,
  jsonResponse,
  requireOrgMembership,
  sanitizeError,
} from "../_shared/auth.ts";
import { insertMailingLog, orgBranding, sendResendEmail } from "../_shared/mail.ts";
import type { OrgBranding } from "../_shared/mail.ts";
import { canMoveTo, orderLines, statusPatch } from "../_shared/webshop/orders.js";
import { actionsPourTournee, actionsPourTransition, variablesCommande } from "../_shared/webshop/process.js";
import { buildWebshopConfig, depotParCode } from "../_shared/webshop/reglages.js";
import { destinatairesAction, estRetour, issueAction, type ActionKind, type ActionStatus } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

const ORDER_SELECT_RETURN =
  "id, status, carrier, tracking_number, internal_notes, delivery_instructions, shipped_at, delivered_at, cancel_reason";
const SLOT_ERRORS = new Set(["slot_not_closed", "slot_not_departed", "slot_cancelled"]);

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

interface ActionReport {
  id: string | null;
  action: string;
  envoi: string;
  evenement: string;
  gabarit: string | null;
  status: ActionStatus;
  error_code: string | null;
  error_message: string | null;
  recipient: string | null;
}

/** Action à exécuter : sortie de actionsPourTransition / actionsPourTournee. */
interface ActionSpec {
  envoi: "colis" | "palette";
  evenement: string;
  action: ActionKind;
  gabarit: string;
}

/** Contexte d'une org : réglages webshop + marque (lus une fois par requête). */
interface OrgCtx {
  orgId: string;
  cfg: AnyRecord;
  branding: OrgBranding;
}

/** Commande prête pour le process : ligne de vue + lignes (avec poids catalogue) + dépôt. */
interface OrderCtx {
  order: AnyRecord;
  lines: AnyRecord[];
  depot: AnyRecord | null;
}

class HttpError extends Error {
  constructor(public status: number, public code: string, public detail?: string) {
    super(code);
  }
}

function userClient(req: Request): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function chargerOrg(admin: SupabaseClient, orgId: string): Promise<OrgCtx> {
  const { data, error } = await admin.schema("core").from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if (error) throw new HttpError(500, "internal_error", sanitizeError(error, "lecture organisation"));
  const settings = (data?.settings as AnyRecord | null) ?? {};
  return { orgId, cfg: buildWebshopConfig(settings), branding: orgBranding(settings) };
}

/**
 * Lignes + poids catalogue + dépôt pour un lot de commandes. `orderLines` conserve l'ordre des
 * items : le poids (`webshop_products.weight_kg`) est rattaché par index ; inconnu → null (le
 * gabarit affiche « non renseigné »). Dépôt = dépôt du secteur de la commande, sinon 1er dépôt.
 */
async function chargerCommandes(admin: SupabaseClient, ctx: OrgCtx, orders: AnyRecord[]): Promise<OrderCtx[]> {
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const { data: items, error: itemsErr } = await admin
    .from("majordhome_webshop_order_items")
    .select("order_id, product_id, product_name, qty, unit_price_ttc_cents, shipping_kind, line_total_ttc_cents, created_at")
    .eq("org_id", ctx.orgId)
    .in("order_id", ids)
    .order("created_at", { ascending: true });
  if (itemsErr) throw new HttpError(500, "internal_error", sanitizeError(itemsErr, "lecture lignes"));

  const productIds = [...new Set((items ?? []).map((i) => i.product_id).filter(Boolean))];
  const poids = new Map<string, number | null>();
  if (productIds.length) {
    const { data: products, error: prodErr } = await admin
      .from("majordhome_webshop_products")
      .select("id, weight_kg")
      .eq("org_id", ctx.orgId)
      .in("id", productIds);
    if (prodErr) throw new HttpError(500, "internal_error", sanitizeError(prodErr, "lecture produits"));
    for (const p of products ?? []) {
      const kg = p.weight_kg === null || p.weight_kg === undefined ? null : Number(p.weight_kg);
      poids.set(p.id, kg !== null && Number.isFinite(kg) ? kg : null);
    }
  }

  const sectorIds = [...new Set(orders.map((o) => o.sector_id).filter(Boolean))];
  const depotParSecteur = new Map<string, string | null>();
  if (sectorIds.length) {
    const { data: sectors, error: secErr } = await admin
      .from("majordhome_webshop_sectors")
      .select("id, depot")
      .eq("org_id", ctx.orgId)
      .in("id", sectorIds);
    if (secErr) throw new HttpError(500, "internal_error", sanitizeError(secErr, "lecture secteurs"));
    for (const s of sectors ?? []) depotParSecteur.set(s.id, s.depot ?? null);
  }
  const premierDepot = Array.isArray(ctx.cfg.depots) && ctx.cfg.depots.length ? ctx.cfg.depots[0] : null;

  const parCommande = new Map<string, AnyRecord[]>();
  for (const it of items ?? []) {
    if (!parCommande.has(it.order_id)) parCommande.set(it.order_id, []);
    parCommande.get(it.order_id)!.push(it);
  }
  return orders.map((order) => {
    const its = parCommande.get(order.id) ?? [];
    const lines = (orderLines({ ...order, items: its }) as AnyRecord[]).map((l, i) => ({
      ...l,
      weightKg: its[i]?.product_id ? (poids.get(its[i].product_id) ?? null) : null,
    }));
    const code = order.sector_id ? depotParSecteur.get(order.sector_id) : null;
    const depot = code ? depotParCode(ctx.cfg as never, code) : premierDepot;
    return { order, lines, depot };
  });
}

async function lireCommande(admin: SupabaseClient, orderId: string, orgId?: string): Promise<AnyRecord> {
  let q = admin.from("majordhome_webshop_orders").select("*").eq("id", orderId);
  if (orgId) q = q.eq("org_id", orgId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new HttpError(500, "internal_error", sanitizeError(error, "lecture commande"));
  if (!data) throw new HttpError(404, "not_found", "order");
  return data;
}

async function lireTournee(admin: SupabaseClient, slotId: string, orgId?: string): Promise<AnyRecord> {
  let q = admin.from("majordhome_webshop_delivery_slots").select("id, org_id, delivery_date, status").eq("id", slotId);
  if (orgId) q = q.eq("org_id", orgId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new HttpError(500, "internal_error", sanitizeError(error, "lecture tournée"));
  if (!data) throw new HttpError(404, "not_found", "slot");
  return data;
}

/** Adhésion à l'org (org lue en base, jamais dans le payload). 403 → `forbidden`. */
async function exigerAdhesion(req: Request, orgId: string): Promise<Response | null> {
  const auth = await requireOrgMembership(req, { orgId });
  if (auth.ok) return null;
  if (auth.response.status === 403) return jsonResponse({ error: "forbidden" }, 403, req);
  return auth.response;
}

/** Droit pipeline.edit, évalué en base avec le JWT de l'utilisateur. Garde positive. */
async function exigerDroitProcess(user: SupabaseClient, orgId: string): Promise<void> {
  const { data, error } = await user.rpc("webshop_can_process", { p_org_id: orgId });
  if (error) throw new HttpError(500, "internal_error", sanitizeError(error, "contrôle du droit"));
  if (data !== true) throw new HttpError(403, "forbidden");
}

/**
 * Pose un statut via la vue d'écriture, filtré org + statut lu (un statut modifié entre-temps
 * n'est pas écrasé). Renvoie la ligne écrite, ou null si le statut avait changé.
 */
async function poserStatut(admin: SupabaseClient, orgId: string, order: AnyRecord, to: string): Promise<AnyRecord | null> {
  const { data, error } = await admin
    .from("majordhome_webshop_orders_write")
    .update(statusPatch(order, to))
    .eq("id", order.id)
    .eq("org_id", orgId)
    .eq("status", order.status)
    .select(ORDER_SELECT_RETURN)
    .maybeSingle();
  if (error) throw new HttpError(500, "internal_error", sanitizeError(error, "écriture du statut"));
  return data;
}

/** Réserve → émet → trace → finalise UNE action. Ne throw jamais. */
async function executerAction(
  admin: SupabaseClient,
  ctx: OrgCtx,
  oc: OrderCtx,
  spec: ActionSpec,
  slot: AnyRecord | null,
): Promise<ActionReport> {
  const report: ActionReport = {
    id: null, action: spec.action, envoi: spec.envoi, evenement: spec.evenement, gabarit: spec.gabarit,
    status: "failed", error_code: null, error_message: null, recipient: null,
  };
  try {
    const { data: id, error: resErr } = await admin.rpc("webshop_order_action_reserve", {
      p_org_id: ctx.orgId, p_order_id: oc.order.id, p_envoi: spec.envoi, p_evenement: spec.evenement,
      p_action: spec.action, p_gabarit: spec.gabarit, p_slot_id: slot?.id ?? null,
    });
    if (resErr) {
      console.error("[webshop-process] reserve", resErr);
      return { ...report, error_code: "reserve_failed", error_message: resErr.message };
    }
    if (!id) return { ...report, status: "skipped", error_code: "already_sent", error_message: "Déjà envoyée ou envoi en cours" };
    report.id = id as string;

    let outcome: Awaited<ReturnType<typeof issueAction>>;
    const { data: template, error: tmplErr } = await admin
      .from("majordhome_mail_campaigns")
      .select("subject, html_body")
      .eq("org_id", ctx.orgId)
      .eq("key", spec.gabarit)
      .eq("is_archived", false)
      .maybeSingle();
    if (tmplErr) {
      outcome = {
        status: "failed", error_code: "template_read_failed", error_message: tmplErr.message,
        recipient: null, provider_id: null, subject: null, attempted: false,
      };
    } else {
      const { to, cc } = destinatairesAction(spec.action, oc.order, ctx.cfg);
      const varsHtml = variablesCommande({
        order: oc.order,
        lines: oc.lines as never,
        envoi: spec.envoi,
        company: { name: ctx.branding.brandName, email: ctx.branding.fromEmail, phone: ctx.branding.phone },
        slot: slot ? { date: slot.delivery_date } : null,
        depot: oc.depot,
      });
      outcome = await issueAction(
        { action: spec.action, template: template ?? null, to, cc, branding: ctx.branding, varsHtml },
        (p) => sendResendEmail(RESEND_API_KEY, p),
      );
    }

    if (outcome.attempted) {
      const logWarning = await insertMailingLog(admin, {
        client_id: oc.order.client_id ?? null,
        lead_id: oc.order.lead_id ?? null,
        org_id: ctx.orgId,
        campaign_name: spec.gabarit,
        subject: outcome.subject ?? "",
        email_to: outcome.recipient ?? "",
        status: outcome.status === "sent" ? "sent" : "failed",
        provider_id: outcome.provider_id,
        error_message: outcome.error_message,
      });
      if (logWarning) console.error("[webshop-process] mailing_logs", logWarning);
    }

    const { error: recErr } = await admin.rpc("webshop_order_action_record", {
      p_action_id: id, p_status: outcome.status, p_error_code: outcome.error_code,
      p_error_message: outcome.error_message, p_recipient: outcome.recipient,
    });
    if (recErr) {
      // not_reserved : réservation reprise par un autre appel (> 10 min) — non fatal.
      console.error(`[webshop-process] record ${recErr.message === "not_reserved" ? "(not_reserved, non fatal)" : ""}`, recErr);
    }
    return {
      ...report, status: outcome.status, error_code: outcome.error_code,
      error_message: outcome.error_message, recipient: outcome.recipient,
    };
  } catch (err) {
    console.error("[webshop-process] action", err);
    return { ...report, error_code: report.error_code ?? "internal_error", error_message: sanitizeError(err, "action") };
  }
}

// ---------------------------------------------------------------------------
async function transition(req: Request, admin: SupabaseClient, body: AnyRecord): Promise<Response> {
  if (typeof body.order_id !== "string" || typeof body.to !== "string") throw new HttpError(400, "bad_request", "order_id et to requis");
  const order = await lireCommande(admin, body.order_id);
  const orgId = order.org_id as string;
  const refus = await exigerAdhesion(req, orgId);
  if (refus) return refus;
  await exigerDroitProcess(userClient(req), orgId);

  const to = body.to as string;
  if (!canMoveTo(order.status, to)) throw new HttpError(409, "invalid_transition", `${order.status} → ${to}`);
  const ecrite = await poserStatut(admin, orgId, order, to);
  if (!ecrite) throw new HttpError(409, "invalid_transition", "statut modifié entre-temps");

  const ctx = await chargerOrg(admin, orgId);
  const actions: ActionReport[] = [];
  if (!estRetour(order.status, to)) {
    const [oc] = await chargerCommandes(admin, ctx, [order]);
    for (const spec of actionsPourTransition(ctx.cfg as never, order, oc.lines as never, to) as ActionSpec[]) {
      actions.push(await executerAction(admin, ctx, oc, spec, null));
    }
  }
  return jsonResponse({ order: ecrite, actions }, 200, req);
}

async function tournee(req: Request, admin: SupabaseClient, body: AnyRecord): Promise<Response> {
  if (typeof body.slot_id !== "string") throw new HttpError(400, "bad_request", "slot_id requis");
  const event = body.event;
  if (event !== "partie" && event !== "livree") throw new HttpError(400, "invalid_event");
  const slot = await lireTournee(admin, body.slot_id);
  const orgId = slot.org_id as string;
  const refus = await exigerAdhesion(req, orgId);
  if (refus) return refus;

  const { data: mark, error: markErr } = await userClient(req).rpc("webshop_slot_mark_event", {
    p_slot_id: slot.id, p_event: event,
  });
  if (markErr) {
    const m = markErr.message;
    if (SLOT_ERRORS.has(m)) throw new HttpError(409, m);
    if (m === "slot_not_found") throw new HttpError(404, "not_found", "slot");
    if (m === "team_leader_required" || m === "unauthenticated") throw new HttpError(403, "forbidden", m);
    if (m === "invalid_event") throw new HttpError(400, "invalid_event");
    throw new HttpError(500, "internal_error", sanitizeError(markErr, "événement de tournée"));
  }

  const ctx = await chargerOrg(admin, orgId);
  const { data: orders, error: ordErr } = await admin
    .from("majordhome_webshop_orders")
    .select("*")
    .eq("org_id", orgId)
    .eq("delivery_slot_id", slot.id)
    .order("created_at", { ascending: true });
  if (ordErr) throw new HttpError(500, "internal_error", sanitizeError(ordErr, "lecture commandes"));

  const resultats: Array<{ order_id: string; statut_applique: string | null; statut_erreur?: string; actions: ActionReport[] }> = [];
  for (const oc of await chargerCommandes(admin, ctx, orders ?? [])) {
    const { actions: specs, statutCible } = actionsPourTournee(ctx.cfg as never, oc.order, oc.lines as never, event) as {
      actions: ActionSpec[];
      statutCible: string | null;
    };
    if (specs.length === 0 && !statutCible) continue;

    // Statut posé AVANT les e-mails : un e-mail en échec ne bloque jamais la carte.
    let statutApplique: string | null = null;
    let statutErreur: string | undefined;
    if (statutCible) {
      try {
        const ecrite = await poserStatut(admin, orgId, oc.order, statutCible);
        if (ecrite) statutApplique = statutCible;
        else statutErreur = "statut modifié entre-temps";
      } catch (err) {
        statutErreur = err instanceof HttpError ? (err.detail ?? err.code) : sanitizeError(err, "statut");
      }
    }
    const actions: ActionReport[] = [];
    for (const spec of specs) actions.push(await executerAction(admin, ctx, oc, spec, slot));
    resultats.push({ order_id: oc.order.id, statut_applique: statutApplique, ...(statutErreur ? { statut_erreur: statutErreur } : {}), actions });
  }
  return jsonResponse({ slot: mark, orders: resultats }, 200, req);
}

async function rejouer(req: Request, admin: SupabaseClient, body: AnyRecord): Promise<Response> {
  if (typeof body.action_id !== "string") throw new HttpError(400, "bad_request", "action_id requis");
  const { data: row, error } = await admin
    .from("majordhome_webshop_order_actions")
    .select("id, org_id, order_id, envoi, evenement, action, gabarit, status, slot_id")
    .eq("id", body.action_id)
    .maybeSingle();
  if (error) throw new HttpError(500, "internal_error", sanitizeError(error, "lecture action"));
  if (!row) throw new HttpError(404, "not_found", "action");
  const orgId = row.org_id as string;
  const refus = await exigerAdhesion(req, orgId);
  if (refus) return refus;
  await exigerDroitProcess(userClient(req), orgId);
  if (row.status === "sent") throw new HttpError(409, "already_sent");
  if (!row.gabarit) throw new HttpError(409, "template_missing", "action sans gabarit");

  const order = await lireCommande(admin, row.order_id, orgId);
  const slot = row.slot_id ? await lireTournee(admin, row.slot_id, orgId) : null;
  const ctx = await chargerOrg(admin, orgId);
  const [oc] = await chargerCommandes(admin, ctx, [order]);
  const report = await executerAction(admin, ctx, oc, {
    envoi: row.envoi, evenement: row.evenement, action: row.action, gabarit: row.gabarit,
  }, slot);
  if (report.status === "skipped" && report.error_code === "already_sent") {
    return jsonResponse({ error: "already_sent", detail: "Déjà envoyée ou envoi en cours" }, 409, req);
  }
  return jsonResponse({ action: report }, 200, req);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  let body: AnyRecord;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "bad_request", detail: "Corps JSON invalide" }, 400, req);
  }
  if (!req.headers.get("Authorization")) return jsonResponse({ error: "No auth header" }, 401, req);

  const admin = getAdminClient();
  try {
    switch (body?.kind) {
      case "transition": return await transition(req, admin, body);
      case "tournee": return await tournee(req, admin, body);
      case "retry": return await rejouer(req, admin, body);
      default: return jsonResponse({ error: "bad_request", detail: "kind inconnu" }, 400, req);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.code, ...(err.detail ? { detail: err.detail } : {}) }, err.status, req);
    }
    console.error("[webshop-process]", err);
    return jsonResponse({ error: "internal_error", detail: sanitizeError(err, "Internal error") }, 500, req);
  }
});
