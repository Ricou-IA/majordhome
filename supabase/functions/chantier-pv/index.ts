// supabase/functions/chantier-pv/index.ts
// ============================================================================
// chantier-pv — PV de réception signé en ligne par le client (page sans compte)
// ============================================================================
// Specs : docs/superpowers/specs/2026-11-17-chantier-apres-vente-pv-en-ligne-design.md
//         docs/superpowers/specs/2026-11-18-pv-reception-points-levee-reserves-design.md
// verify_jwt:false (le client n'a pas de compte) — actions FERMÉES :
//
// Bureau (JWT utilisateur ; membre de l'org + droit de modifier les chantiers ; le chantier
// doit appartenir à l'org de l'appelant) :
//   POST { action: "preparer", org_id, chantier_id, reponses }
//        → déclaration de l'entreprise, point par point (oui | non | sans_objet). Le gabarit
//          vient du TYPE du chantier, jamais du corps ; textes repris de pvPoints.js.
//          Reprise permise tant que le client n'a pas signé.
//   POST { action: "envoyer", org_id, chantier_id }
//        → + module Communication. E-mail au client (gabarit pv_reception) avec le lien, trace
//          mailing_logs, envoi noté. Refus pv_non_prepare tant que rien n'est déclaré.
//          L'adresse est relue EN BASE, jamais prise ici.
//   POST { action: "lien", org_id, chantier_id }
//        → rend le lien sans rien envoyer (SMS, WhatsApp à la main). Admis sur un PV signé
//          avec réserves (le client y signera la levée) ; refus deja_signe sinon.
//   POST { action: "repondre_reserves", org_id, chantier_id, reponse, echeance }
//        → réponse de l'entreprise aux réserves (texte et/ou date d'engagement).
//   POST { action: "demander_levee", org_id, chantier_id, mode: "email" | "lien" }
//        → e-mail pv_levee_reserves (mêmes gardes que envoyer) ou lien ; la demande est notée
//          dans les deux cas (sans elle, le client n'aurait rien à signer).
//
// Client (jeton du lien) :
//   GET  ?token=<jeton>
//        → ce que la page du client affiche ; note la première ouverture.
//   POST { action: "signer", token, reponse }
//        → enregistre la signature (RPC chantier_pv_signer) avec les points confirmés, validés
//          contre le gabarit de la préparation ; un chantier Planifié passe en Réceptionné.
//   POST { action: "signer_levee", token, reponse: { signataire_nom, signature_png } }
//        → signe la levée des réserves (RPC chantier_pv_signer_levee).
//
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
  PV_RECEPTION_TEMPLATE_KEY, PV_LEVEE_TEMPLATE_KEY, PV_LIEN_VALIDITE_JOURS,
  validerReponsePv, normaliserReponsePv, validerReponseLevee, validerReponseReserves, objetDuPv, jourDeParis,
} from "../_shared/pvReception.js";
import {
  normaliserGabarit, pointsDuGabarit, figerDeclaration, figerPointsClient, GARANTIES_RECEPTION, LIBELLE_REPONSE,
} from "../_shared/pvPoints.js";

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

type PointEntreprise = { cle: string; texte: string; reponse: string };
type PointClient = { cle: string; texte: string; confirme: boolean };
type Devis = { libelle: string | null; date: string | null };

interface LignePv {
  sent_at: string | null; sent_to: string | null; sent_count: number | null; opened_at: string | null;
  signed_at: string | null; signataire_nom: string | null; signature_png: string | null;
  reception_type: string | null; reserves_nature: string | null; reserves_travaux: string | null;
  info_recues: boolean | null; notices_recues: boolean | null; entretien_recues: boolean | null;
  gabarit: string | null; points_entreprise: PointEntreprise[] | null;
  prepare_at: string | null; prepare_par: string | null;
  devis: Devis[] | null; points_client: PointClient[] | null;
  reserves_reponse: string | null; reserves_echeance: string | null;
  reserves_repondu_at: string | null; reserves_repondu_par: string | null;
  levee_demandee_at: string | null; levee_sent_to: string | null; levee_sent_count: number | null;
  levee_signed_at: string | null; levee_signataire_nom: string | null; levee_signature_png: string | null;
}

interface ContextePv {
  chantier_id: string;
  org_id: string;
  statut: string;
  libelle: string | null;
  equipement: string | null;
  gabarit_type: string | null;
  pv_archive: boolean;
  client: { id: string | null; lead_id: string | null; prenom: string | null; nom: string | null; email: string | null;
    adresse: string | null; code_postal: string | null; ville: string | null };
  poses: string[];
  devis: Devis[];
  settings: Json;
  pv: LignePv | null;
}

// ── Limite de débit (par chantier, en mémoire) ────────────────────────────

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

/** Signé en ligne ou archivé (PV sur tablette). */
function dejaSigne(ctx: ContextePv): boolean {
  return ctx.pv_archive === true || Boolean(ctx.pv?.signed_at);
}

/** Signé EN LIGNE avec réserves : seul cas où réponse et levée ont un sens. */
function signeAvecReserves(ctx: ContextePv): boolean {
  return Boolean(ctx.pv?.signed_at) && ctx.pv?.reception_type === "avec_reserves";
}

/** La déclaration de l'entreprise est enregistrée (préparation complète). */
function estPrepare(ctx: ContextePv): boolean {
  const points = ctx.pv?.points_entreprise;
  return Array.isArray(points) && points.length > 0;
}

function expiration(): number {
  return Math.floor(Date.now() / 1000) + PV_LIEN_VALIDITE_JOURS * 86_400;
}

async function lienPour(chantierId: string): Promise<{ url: string; exp: number }> {
  const exp = expiration();
  return { url: `${APP_URL}/pv/${await signerPv(chantierId, exp)}`, exp };
}

/** Code de refus d'une RPC → statut HTTP. */
function statutDuRefus(code: string): number {
  if (code === "deja_signe" || code === "levee_deja_signee" || code === "point_inconnu") return 409;
  if (code === "chantier_introuvable") return 404;
  return 400;
}

/** Lit le retour `{ ok, code }` d'une RPC ; rend la réponse d'erreur, ou null si ok. */
function refusRpc(req: Request, data: unknown, error: unknown, quoi: string): Response | null {
  if (error) {
    console.error(`[chantier-pv] ${quoi} :`, error);
    return jsonResponse({ error: sanitizeError(error, `${quoi} impossible`) }, 500, req);
  }
  const r = (data || {}) as Json;
  if (r.ok !== true) {
    const code = String(r.code || "refus");
    return jsonResponse({ error: code }, statutDuRefus(code), req);
  }
  return null;
}

// ── Garde des actions du bureau ───────────────────────────────────────────

type Garde = { ok: true; ctx: ContextePv; userId: string } | { ok: false; response: Response };

/**
 * Seule garde du bureau : membre de l'org, droit de modifier les chantiers, chantier de cette org.
 * `admettreSigne` : ne refuse pas un PV déjà signé (l'action décide elle-même de ce qu'elle admet).
 */
async function gardeBureau(req: Request, body: Json, { admettreSigne = false } = {}): Promise<Garde> {
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
  if (!admettreSigne && dejaSigne(ctx)) return { ok: false, response: jsonResponse({ error: "deja_signe" }, 409, req) };
  return { ok: true, ctx, userId: auth.userId };
}

// ── E-mail au client (PV ou levée) ────────────────────────────────────────

type Courriel = { ok: true; email: string } | { ok: false; response: Response };

/**
 * Envoie au client le gabarit `cle` avec le lien du PV, trace mailing_logs. Préconditions dans
 * l'ordre : module Communication, e-mail du client (relu en base), Resend, expéditeur, gabarit.
 */
async function envoyerCourriel(req: Request, ctx: ContextePv, cle: string): Promise<Courriel> {
  const admin = getAdminClient();
  const refus = (error: string, status: number, extra: Json = {}): Courriel =>
    ({ ok: false, response: jsonResponse({ error, ...extra }, status, req) });

  if (!moduleActif(ctx.settings, "communication")) return refus("module_communication_ferme", 403);
  const email = String(ctx.client.email || "").trim();
  if (!EMAIL_RE.test(email)) return refus("client_sans_email", 400);
  if (!RESEND_API_KEY) return refus("resend_non_configure", 500);
  const b = orgBranding(ctx.settings as never);
  if (!b.fromEmail) return refus("expediteur_absent", 400);

  const { data: tpl, error: tplErr } = await admin
    .from("majordhome_mail_campaigns").select("subject, html_body")
    .eq("org_id", ctx.org_id).eq("key", cle).eq("is_archived", false).maybeSingle();
  if (tplErr) return refus(sanitizeError(tplErr, "gabarit illisible"), 500);
  if (!tpl) return refus("template_missing", 400);

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
    campaign_name: cle, subject, email_to: email,
    status: res.ok ? "sent" : "failed", provider_id: res.id ?? null,
    error_message: res.ok ? null : (res.message || `resend_${res.status}`),
  });
  if (logErr) console.error("[chantier-pv] mailing_logs :", logErr);
  if (!res.ok) return refus("envoi_echoue", 502, { detail: res.message || `resend_${res.status}` });
  return { ok: true, email };
}

// ── Actions du bureau ─────────────────────────────────────────────────────

async function actionPreparer(req: Request, body: Json): Promise<Response> {
  const g = await gardeBureau(req, body);
  if (!g.ok) return g.response;
  const { ctx, userId } = g;
  if (tropDeRequetes(`preparer:${ctx.chantier_id}`)) return jsonResponse({ error: "too_many_requests" }, 429, req);

  // Forme : un objet simple dont chaque valeur est une chaîne (figerDeclaration le suppose).
  const reponses = body.reponses;
  if (!reponses || typeof reponses !== "object" || Array.isArray(reponses)
      || Object.values(reponses as Json).some((v) => typeof v !== "string")) {
    return jsonResponse({ error: "declaration_incomplete" }, 400, req);
  }
  // Gabarit du type du chantier, jamais du corps ; textes repris du module d'après les clés.
  const gabarit = normaliserGabarit(ctx.gabarit_type);
  const decl = figerDeclaration(gabarit, reponses as Record<string, string>);
  if (!decl.ok) return jsonResponse({ error: decl.code }, 400, req);

  const { data, error } = await getAdminClient().rpc("chantier_pv_preparer", {
    p_chantier_id: ctx.chantier_id, p_gabarit: gabarit, p_points: decl.points, p_user: userId,
  });
  const refus = refusRpc(req, data, error, "préparation");
  if (refus) return refus;
  return jsonResponse({ prepare_at: (data as Json).prepare_at }, 200, req);
}

async function actionLien(req: Request, body: Json): Promise<Response> {
  const g = await gardeBureau(req, body, { admettreSigne: true });
  if (!g.ok) return g.response;
  const { ctx } = g;
  if (dejaSigne(ctx)) {
    // Signé : le lien ne sert plus qu'à la levée des réserves.
    if (!signeAvecReserves(ctx)) return jsonResponse({ error: "deja_signe" }, 409, req);
  } else if (!estPrepare(ctx)) {
    return jsonResponse({ error: "pv_non_prepare" }, 400, req);
  }
  const { url, exp } = await lienPour(ctx.chantier_id);
  return jsonResponse({ url, expires_at: new Date(exp * 1000).toISOString() }, 200, req);
}

async function actionEnvoyer(req: Request, body: Json): Promise<Response> {
  const g = await gardeBureau(req, body);
  if (!g.ok) return g.response;
  const { ctx, userId } = g;
  if (!estPrepare(ctx)) return jsonResponse({ error: "pv_non_prepare" }, 400, req);

  const envoi = await envoyerCourriel(req, ctx, PV_RECEPTION_TEMPLATE_KEY);
  if (!envoi.ok) return envoi.response;
  const email = envoi.email;

  const { data: note, error: noteErr } = await getAdminClient().rpc("chantier_pv_marquer_envoi", {
    p_chantier_id: ctx.chantier_id, p_sent_to: email, p_sent_by: userId,
  });
  if (noteErr || (note as Json | null)?.ok !== true) {
    console.error("[chantier-pv] envoi non noté :", noteErr || note);
    return jsonResponse({ error: "envoi_non_note", sent_to: email }, 500, req);
  }
  return jsonResponse({ sent_to: email, sent_at: (note as Json).sent_at, sent_count: (note as Json).sent_count }, 200, req);
}

/** Préconditions communes à la réponse aux réserves et à la demande de levée. */
function refusReserves(req: Request, ctx: ContextePv): Response | null {
  if (!signeAvecReserves(ctx)) return jsonResponse({ error: "pas_de_reserves" }, 400, req);
  if (ctx.pv?.levee_signed_at) return jsonResponse({ error: "levee_deja_signee" }, 409, req);
  return null;
}

async function actionRepondreReserves(req: Request, body: Json): Promise<Response> {
  const g = await gardeBureau(req, body, { admettreSigne: true });
  if (!g.ok) return g.response;
  const { ctx, userId } = g;
  const refusEtat = refusReserves(req, ctx);
  if (refusEtat) return refusEtat;

  if (body.reponse != null && typeof body.reponse !== "string") return jsonResponse({ error: "reponse_vide" }, 400, req);
  if (body.echeance != null && typeof body.echeance !== "string") return jsonResponse({ error: "echeance_invalide" }, 400, req);
  const reponse = String(body.reponse ?? "").trim();
  const echeance = String(body.echeance ?? "").trim();
  // Jour de signature toujours fourni : sans lui, « pas avant la signature » ne serait pas vérifié.
  const jourSignature = jourDeParis(ctx.pv?.signed_at);
  if (!jourSignature) return jsonResponse({ error: "echeance_invalide" }, 400, req);
  const invalide = validerReponseReserves({ reponse, echeance }, jourSignature);
  if (invalide) return jsonResponse({ error: invalide }, 400, req);

  // Chaque enregistrement remplace le texte ET la date (vide ⇒ null).
  const { data, error } = await getAdminClient().rpc("chantier_pv_repondre_reserves", {
    p_chantier_id: ctx.chantier_id, p_reponse: reponse || null, p_echeance: echeance || null, p_user: userId,
  });
  const refus = refusRpc(req, data, error, "réponse aux réserves");
  if (refus) return refus;
  return jsonResponse({ ok: true, repondu_at: (data as Json).repondu_at }, 200, req);
}

async function actionDemanderLevee(req: Request, body: Json): Promise<Response> {
  const mode = body.mode;
  if (mode !== "email" && mode !== "lien") return jsonResponse({ error: "action_inconnue" }, 400, req);
  const g = await gardeBureau(req, body, { admettreSigne: true });
  if (!g.ok) return g.response;
  const { ctx, userId } = g;
  const refusEtat = refusReserves(req, ctx);
  if (refusEtat) return refusEtat;
  const admin = getAdminClient();

  if (mode === "lien") {
    const { url, exp } = await lienPour(ctx.chantier_id);
    const { data, error } = await admin.rpc("chantier_pv_marquer_levee", {
      p_chantier_id: ctx.chantier_id, p_sent_to: null, p_user: userId,
    });
    const refus = refusRpc(req, data, error, "demande de levée");
    if (refus) return refus;
    return jsonResponse({ url, expires_at: new Date(exp * 1000).toISOString() }, 200, req);
  }

  const envoi = await envoyerCourriel(req, ctx, PV_LEVEE_TEMPLATE_KEY);
  if (!envoi.ok) return envoi.response;
  const email = envoi.email;
  const { data: note, error: noteErr } = await admin.rpc("chantier_pv_marquer_levee", {
    p_chantier_id: ctx.chantier_id, p_sent_to: email, p_user: userId,
  });
  if (noteErr || (note as Json | null)?.ok !== true) {
    console.error("[chantier-pv] demande de levée non notée :", noteErr || note);
    return jsonResponse({ error: "envoi_non_note", sent_to: email }, 500, req);
  }
  return jsonResponse({
    sent_to: email,
    levee_demandee_at: (note as Json).levee_demandee_at,
    levee_sent_count: (note as Json).levee_sent_count,
  }, 200, req);
}

// ── Actions du client (lien) ──────────────────────────────────────────────

function pourLaPage(ctx: ContextePv): Json {
  const s = ctx.settings || {};
  const entreprise: Json = {};
  for (const cle of CLES_ENTREPRISE) if (s[cle] != null && s[cle] !== "") entreprise[cle] = s[cle];
  const pv = ctx.pv;
  const signeEnLigne = Boolean(pv?.signed_at);
  const signe = dejaSigne(ctx);
  const prepare = estPrepare(ctx);
  const avecReserves = signeAvecReserves(ctx);
  const libelles = LIBELLE_REPONSE as Record<string, string>;

  return {
    chantier_id: ctx.chantier_id,
    entreprise,
    client: {
      prenom: ctx.client.prenom, nom: ctx.client.nom,
      adresse: ctx.client.adresse, code_postal: ctx.client.code_postal, ville: ctx.client.ville,
    },
    objet: objetDuPv({ equipement: ctx.equipement, libelle: ctx.libelle }),
    poses: ctx.poses || [],
    deja_signe: signe,
    pret: prepare || signe,
    // Devis photographiés à la signature une fois signé en ligne, sinon les devis validés du jour.
    devis: signeEnLigne ? (Array.isArray(pv?.devis) ? pv.devis : []) : (Array.isArray(ctx.devis) ? ctx.devis : []),
    declaration: (prepare ? pv!.points_entreprise! : []).map((p) => ({
      texte: p.texte, reponse: libelles[p.reponse] ?? p.reponse,
    })),
    // Points à confirmer, du gabarit de la PRÉPARATION, tant que rien n'est signé.
    points_client: prepare && !signe
      ? pointsDuGabarit(pv!.gabarit).client.map((p) => ({ cle: p.cle, texte: p.texte }))
      : [],
    garanties: GARANTIES_RECEPTION,
    reserves: avecReserves && (pv!.reserves_reponse || pv!.reserves_echeance)
      ? { reponse: pv!.reserves_reponse, echeance: pv!.reserves_echeance }
      : null,
    levee: avecReserves ? {
      demandee: Boolean(pv!.levee_demandee_at),
      signed_at: pv!.levee_signed_at ?? null,
      signataire_nom: pv!.levee_signataire_nom ?? null,
      signature_png: pv!.levee_signature_png ?? null,
    } : null,
    // La signature n'est rendue que si elle a été faite en ligne (le client retélécharge son PV).
    signature: signeEnLigne ? {
      signed_at: pv!.signed_at, signataire_nom: pv!.signataire_nom, signature_png: pv!.signature_png,
      reception_type: pv!.reception_type, reserves_nature: pv!.reserves_nature, reserves_travaux: pv!.reserves_travaux,
      points_client: Array.isArray(pv!.points_client) ? pv!.points_client : [],
      points_entreprise: Array.isArray(pv!.points_entreprise) ? pv!.points_entreprise : [],
      devis: Array.isArray(pv!.devis) ? pv!.devis : [],
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
  const refusSaisie = validerReponsePv(brute);
  if (refusSaisie) return jsonResponse({ error: refusSaisie }, 400, req);
  const { points_confirmes, ...reponse } = normaliserReponsePv(brute) as Json & { points_confirmes: string[] };

  const { ctx, erreur } = await contexte(v.chantierId);
  if (erreur) return jsonResponse({ error: sanitizeError(erreur, "chantier illisible") }, 500, req);
  if (!ctx) return jsonResponse({ error: "chantier_introuvable" }, 404, req);
  if (dejaSigne(ctx)) return jsonResponse({ error: "deja_signe" }, 409, req);
  if (!estPrepare(ctx)) return jsonResponse({ error: "pv_non_prepare" }, 400, req);

  // Points du client validés contre le gabarit RETENU à la préparation, textes repris du module.
  const points = figerPointsClient(ctx.pv!.gabarit, points_confirmes);
  if (!points.ok) return jsonResponse({ error: points.code }, 409, req);

  const { data, error } = await getAdminClient().rpc("chantier_pv_signer", {
    p_chantier_id: v.chantierId, p_payload: { ...reponse, points_client: points.points },
  });
  const refus = refusRpc(req, data, error, "signature");
  if (refus) return refus;
  const r = data as Json;

  // La page réaffiche ce qui vient d'être enregistré (récapitulatif + PDF du client).
  const { ctx: apres } = await contexte(v.chantierId);
  return jsonResponse({
    ok: true,
    passe_en_receptionne: r.passe_en_receptionne === true,
    avec_reserves: r.avec_reserves === true,
    pv: apres ? pourLaPage(apres) : null,
  }, 200, req);
}

async function actionSignerLevee(req: Request, body: Json): Promise<Response> {
  const v = await verifierPv(String(body.token || ""));
  if (!v.ok) return jsonResponse({ error: v.error }, v.status, req);
  if (tropDeRequetes(`levee:${v.chantierId}`)) return jsonResponse({ error: "too_many_requests" }, 429, req);

  const brute = (body.reponse && typeof body.reponse === "object" ? body.reponse : {}) as Json;
  const refusSaisie = validerReponseLevee(brute);
  if (refusSaisie) return jsonResponse({ error: refusSaisie }, 400, req);

  const { data, error } = await getAdminClient().rpc("chantier_pv_signer_levee", {
    p_chantier_id: v.chantierId,
    p_payload: { signataire_nom: String(brute.signataire_nom ?? "").trim(), signature_png: String(brute.signature_png ?? "") },
  });
  const refus = refusRpc(req, data, error, "signature de la levée");
  if (refus) return refus;

  const { ctx } = await contexte(v.chantierId);
  return jsonResponse({ ok: true, pv: ctx ? pourLaPage(ctx) : null }, 200, req);
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
      case "preparer": return await actionPreparer(req, body);
      case "envoyer": return await actionEnvoyer(req, body);
      case "lien": return await actionLien(req, body);
      case "repondre_reserves": return await actionRepondreReserves(req, body);
      case "demander_levee": return await actionDemanderLevee(req, body);
      case "signer": return await actionSigner(req, body);
      case "signer_levee": return await actionSignerLevee(req, body);
      default: return jsonResponse({ error: "action_inconnue" }, 400, req);
    }
  } catch (err) {
    console.error("[chantier-pv]", err);
    return jsonResponse({ error: sanitizeError(err, "erreur interne") }, 500, req);
  }
});
