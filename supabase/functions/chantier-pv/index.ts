// supabase/functions/chantier-pv/index.ts
// ============================================================================
// chantier-pv — PV de réception signé en ligne par le client (page sans compte)
// ============================================================================
// Spec : docs/superpowers/specs/2026-11-17-chantier-apres-vente-pv-en-ligne-design.md
// verify_jwt:false (le client n'a pas de compte) — quatre actions FERMÉES :
//   POST { action: "envoyer", org_id, chantier_id } + JWT utilisateur
//        → membre de l'org + droit de modifier les chantiers + module Communication.
//          E-mail au client (gabarit pv_reception) avec le lien, trace mailing_logs,
//          envoi noté sur le chantier. L'adresse est relue EN BASE, jamais prise ici.
//   POST { action: "lien", org_id, chantier_id } + JWT utilisateur
//        → même garde, rend le lien sans rien envoyer (SMS, WhatsApp à la main).
//   GET  ?token=<jeton>
//        → ce que la page du client affiche ; note la première ouverture.
//   POST { action: "signer", token, reponse }
//        → enregistre la signature (RPC chantier_pv_signer) ; un chantier Planifié
//          passe en Réceptionné.
// Jeton : _shared/pvToken.ts (HMAC MDH_PV_SECRET, sans état). L'org est TOUJOURS
// dérivée du chantier porté par le jeton.
// La page publique ne reçoit ni montant, ni note interne, ni téléphone ou e-mail du client.
// Env : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, MDH_PV_SECRET,
//       MDH_APP_URL, RESEND_API_KEY.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  requireOrgMembership, jsonResponse, buildCorsHeaders, getAdminClient, sanitizeError,
} from "../_shared/auth.ts";
import { signerPv, verifierPv, secretConfigure, UUID_RE } from "../_shared/pvToken.ts";
import {
  orgBranding, brandingReplacements, wrapWithSkeleton, applyPlaceholders, escapeHtml, sendResendEmail, insertMailingLog,
} from "../_shared/mail.ts";
import { moduleActif } from "../_shared/modules.js";
import {
  PV_RECEPTION_TEMPLATE_KEY, PV_LIEN_VALIDITE_JOURS, validerReponsePv, normaliserReponsePv, objetDuPv,
} from "../_shared/pvReception.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const APP_URL = (Deno.env.get("MDH_APP_URL") || "https://majordhome.vercel.app").replace(/\/+$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LIMITE_PAR_HEURE = 40;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Identité de l'entreprise transmise à la page publique : ce qui figure déjà sur ses documents.
const CLES_ENTREPRISE = [
  "brand_name", "legal_name", "legal_form", "capital", "rcs", "siret", "tva_intra",
  "address", "postal_code", "city", "phone", "from_email", "website_url", "logo_url", "accent_color",
];

type Json = Record<string, unknown>;

interface ContextePv {
  chantier_id: string;
  org_id: string;
  statut: string;
  libelle: string | null;
  equipement: string | null;
  pv_archive: boolean;
  client: { id: string | null; lead_id: string | null; prenom: string | null; nom: string | null; email: string | null;
    adresse: string | null; code_postal: string | null; ville: string | null };
  poses: string[];
  settings: Json;
  pv: Json | null;
}

// ── Limite de débit (par jeton, en mémoire) ───────────────────────────────

const compteurs = new Map<string, { n: number; depuis: number }>();
function tropDeRequetes(cle: string): boolean {
  const now = Date.now();
  const c = compteurs.get(cle);
  if (!c || now - c.depuis > 3_600_000) {
    compteurs.set(cle, { n: 1, depuis: now });
    return false;
  }
  c.n += 1;
  return c.n > LIMITE_PAR_HEURE;
}

// ── Lecture du chantier ───────────────────────────────────────────────────

async function contexte(chantierId: string, marquerOuverture = false): Promise<{ ctx: ContextePv | null; erreur: unknown }> {
  const { data, error } = await getAdminClient().rpc("chantier_pv_contexte", {
    p_chantier_id: chantierId, p_marquer_ouverture: marquerOuverture,
  });
  if (error) return { ctx: null, erreur: error };
  return { ctx: (data as ContextePv | null) ?? null, erreur: null };
}

function dejaSigne(ctx: ContextePv): boolean {
  return ctx.pv_archive === true || Boolean(ctx.pv && (ctx.pv as Json).signed_at);
}

function expiration(): number {
  return Math.floor(Date.now() / 1000) + PV_LIEN_VALIDITE_JOURS * 86_400;
}

async function lienPour(chantierId: string): Promise<{ url: string; exp: number }> {
  const exp = expiration();
  return { url: `${APP_URL}/pv/${await signerPv(chantierId, exp)}`, exp };
}

// ── Garde des actions du bureau ───────────────────────────────────────────

type Garde = { ok: true; ctx: ContextePv; userId: string } | { ok: false; response: Response };

async function gardeBureau(req: Request, body: Json): Promise<Garde> {
  const orgId = String(body.org_id || "");
  const chantierId = String(body.chantier_id || "");
  if (!UUID_RE.test(orgId) || !UUID_RE.test(chantierId)) {
    return { ok: false, response: jsonResponse({ error: "org_id et chantier_id requis" }, 400, req) };
  }
  const auth = await requireOrgMembership(req, { orgId });
  if (!auth.ok) return { ok: false, response: auth.response };
  if (!secretConfigure()) return { ok: false, response: jsonResponse({ error: "secret_non_configure" }, 500, req) };

  // Droit de modifier les chantiers, au jeton de l'utilisateur (même arbitre que la base).
  const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [edit, editOwn] = await Promise.all([
    user.rpc("user_can", { p_org_id: orgId, p_resource: "chantiers", p_action: "edit" }),
    user.rpc("user_can", { p_org_id: orgId, p_resource: "chantiers", p_action: "edit_own" }),
  ]);
  if (edit.error || editOwn.error) {
    return { ok: false, response: jsonResponse({ error: sanitizeError(edit.error || editOwn.error, "droits illisibles") }, 500, req) };
  }
  if (edit.data !== true && editOwn.data !== true) {
    return { ok: false, response: jsonResponse({ error: "droit_requis" }, 403, req) };
  }

  const { ctx, erreur } = await contexte(chantierId);
  if (erreur) return { ok: false, response: jsonResponse({ error: sanitizeError(erreur, "chantier illisible") }, 500, req) };
  // Le chantier doit appartenir à l'org dont l'appelant est membre (jamais l'org du payload seule).
  if (!ctx || ctx.org_id !== orgId) return { ok: false, response: jsonResponse({ error: "chantier_introuvable" }, 404, req) };
  if (dejaSigne(ctx)) return { ok: false, response: jsonResponse({ error: "deja_signe" }, 409, req) };
  return { ok: true, ctx, userId: auth.userId };
}

// ── Actions du bureau ─────────────────────────────────────────────────────

async function actionLien(req: Request, body: Json): Promise<Response> {
  const g = await gardeBureau(req, body);
  if (!g.ok) return g.response;
  const { url, exp } = await lienPour(g.ctx.chantier_id);
  return jsonResponse({ url, expires_at: new Date(exp * 1000).toISOString() }, 200, req);
}

async function actionEnvoyer(req: Request, body: Json): Promise<Response> {
  const g = await gardeBureau(req, body);
  if (!g.ok) return g.response;
  const { ctx, userId } = g;
  const admin = getAdminClient();

  if (!moduleActif(ctx.settings, "communication")) return jsonResponse({ error: "module_communication_ferme" }, 403, req);
  const email = String(ctx.client.email || "").trim();
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: "client_sans_email" }, 400, req);
  if (!RESEND_API_KEY) return jsonResponse({ error: "resend_non_configure" }, 500, req);
  const b = orgBranding(ctx.settings as never);
  if (!b.fromEmail) return jsonResponse({ error: "expediteur_absent" }, 400, req);

  const { data: tpl, error: tplErr } = await admin
    .from("majordhome_mail_campaigns").select("subject, html_body")
    .eq("org_id", ctx.org_id).eq("key", PV_RECEPTION_TEMPLATE_KEY).eq("is_archived", false).maybeSingle();
  if (tplErr) return jsonResponse({ error: sanitizeError(tplErr, "gabarit illisible") }, 500, req);
  if (!tpl) return jsonResponse({ error: "template_missing" }, 400, req);

  const { url } = await lienPour(ctx.chantier_id);
  const valeurs: Record<string, string> = {
    "{{PRENOM}}": String(ctx.client.prenom || "").trim(),
    "{{OBJET}}": objetDuPv({ equipement: ctx.equipement, libelle: ctx.libelle }),
  };
  const valeursHtml = Object.fromEntries(Object.entries(valeurs).map(([k, v]) => [k, escapeHtml(v)]));
  const subject = applyPlaceholders(String(tpl.subject || ""), { ...brandingReplacements(b), ...valeurs });
  const html = applyPlaceholders(
    wrapWithSkeleton(b, String(tpl.html_body || "")),
    { ...brandingReplacements(b), ...valeursHtml, "{{LIEN_PV}}": url },
  );

  const res = await sendResendEmail(RESEND_API_KEY, {
    from: b.fromName ? `${b.fromName} <${b.fromEmail}>` : b.fromEmail,
    to: [email], replyTo: b.replyTo || undefined, subject, html,
  });
  const logErr = await insertMailingLog(admin, {
    client_id: ctx.client.id, lead_id: ctx.client.lead_id, org_id: ctx.org_id,
    campaign_name: PV_RECEPTION_TEMPLATE_KEY, subject, email_to: email,
    status: res.ok ? "sent" : "failed", provider_id: res.id ?? null,
    error_message: res.ok ? null : (res.message || `resend_${res.status}`),
  });
  if (logErr) console.error("[chantier-pv] mailing_logs :", logErr);
  if (!res.ok) return jsonResponse({ error: "envoi_echoue", detail: res.message || `resend_${res.status}` }, 502, req);

  const { data: note, error: noteErr } = await admin.rpc("chantier_pv_marquer_envoi", {
    p_chantier_id: ctx.chantier_id, p_sent_to: email, p_sent_by: userId,
  });
  if (noteErr || (note as Json | null)?.ok !== true) {
    console.error("[chantier-pv] envoi non noté :", noteErr || note);
    return jsonResponse({ error: "envoi_non_note", sent_to: email }, 500, req);
  }
  return jsonResponse({ sent_to: email, sent_at: (note as Json).sent_at, sent_count: (note as Json).sent_count }, 200, req);
}

// ── Actions du client (lien) ──────────────────────────────────────────────

function pourLaPage(ctx: ContextePv): Json {
  const s = ctx.settings || {};
  const entreprise: Json = {};
  for (const cle of CLES_ENTREPRISE) if (s[cle] != null && s[cle] !== "") entreprise[cle] = s[cle];
  const pv = (ctx.pv || {}) as Json;
  const signeEnLigne = Boolean(pv.signed_at);
  return {
    chantier_id: ctx.chantier_id,
    entreprise,
    client: {
      prenom: ctx.client.prenom, nom: ctx.client.nom,
      adresse: ctx.client.adresse, code_postal: ctx.client.code_postal, ville: ctx.client.ville,
    },
    objet: objetDuPv({ equipement: ctx.equipement, libelle: ctx.libelle }),
    poses: ctx.poses || [],
    deja_signe: dejaSigne(ctx),
    // La signature n'est rendue que si elle a été faite en ligne (le client retélécharge son PV).
    signature: signeEnLigne ? {
      signed_at: pv.signed_at, signataire_nom: pv.signataire_nom, signature_png: pv.signature_png,
      reception_type: pv.reception_type, reserves_nature: pv.reserves_nature, reserves_travaux: pv.reserves_travaux,
      info_recues: pv.info_recues, notices_recues: pv.notices_recues, entretien_recues: pv.entretien_recues,
    } : null,
  };
}

async function actionLire(req: Request, token: string): Promise<Response> {
  const v = await verifierPv(token);
  if (!v.ok) return jsonResponse({ error: v.error }, v.status, req);
  if (tropDeRequetes(`lire:${v.chantierId}`)) return jsonResponse({ error: "too_many_requests" }, 429, req);
  const { ctx, erreur } = await contexte(v.chantierId, true);
  if (erreur) return jsonResponse({ error: sanitizeError(erreur, "chantier illisible") }, 500, req);
  if (!ctx) return jsonResponse({ error: "chantier_introuvable" }, 404, req);
  return jsonResponse(pourLaPage(ctx), 200, req);
}

async function actionSigner(req: Request, body: Json): Promise<Response> {
  const v = await verifierPv(String(body.token || ""));
  if (!v.ok) return jsonResponse({ error: v.error }, v.status, req);
  if (tropDeRequetes(`signer:${v.chantierId}`)) return jsonResponse({ error: "too_many_requests" }, 429, req);

  const brute = (body.reponse && typeof body.reponse === "object" ? body.reponse : {}) as Json;
  const refus = validerReponsePv(brute);
  if (refus) return jsonResponse({ error: refus }, 400, req);
  const reponse = normaliserReponsePv(brute);

  const { data, error } = await getAdminClient().rpc("chantier_pv_signer", {
    p_chantier_id: v.chantierId, p_payload: reponse,
  });
  if (error) {
    console.error("[chantier-pv] signature :", error);
    return jsonResponse({ error: sanitizeError(error, "signature non enregistrée") }, 500, req);
  }
  const r = (data || {}) as Json;
  if (r.ok !== true) {
    const code = String(r.code || "refus");
    const statut = code === "deja_signe" ? 409 : code === "chantier_introuvable" ? 404 : 400;
    return jsonResponse({ error: code }, statut, req);
  }

  // La page réaffiche ce qui vient d'être enregistré (récapitulatif + PDF du client).
  const { ctx } = await contexte(v.chantierId);
  return jsonResponse({
    ok: true,
    passe_en_receptionne: r.passe_en_receptionne === true,
    avec_reserves: r.avec_reserves === true,
    pv: ctx ? pourLaPage(ctx) : null,
  }, 200, req);
}

// ── Routage ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  try {
    if (req.method === "GET") {
      return await actionLire(req, new URL(req.url).searchParams.get("token") || "");
    }
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);
    const body = (await req.json().catch(() => ({}))) as Json;
    switch (body.action) {
      case "envoyer": return await actionEnvoyer(req, body);
      case "lien": return await actionLien(req, body);
      case "signer": return await actionSigner(req, body);
      default: return jsonResponse({ error: "action_inconnue" }, 400, req);
    }
  } catch (err) {
    console.error("[chantier-pv]", err);
    return jsonResponse({ error: sanitizeError(err, "erreur interne") }, 500, req);
  }
});
