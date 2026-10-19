// ============================================================================
// webshop-process/logic.ts — logique PURE de l'edge (aucun accès base, aucun env) :
// rendu d'un e-mail de commande, destinataires d'une action, émission d'une action
// avec un `send` injecté (Resend en prod, faux en test).
// Testé : deno test supabase/functions/webshop-process/logic.test.ts
// ============================================================================
import {
  applyPlaceholders,
  brandingReplacements,
  escapeHtml,
  wrapWithSkeleton,
} from "../_shared/mail.ts";
import type { OrgBranding, ResendPayload, ResendResult } from "../_shared/mail.ts";
import { ORDER_BOARD_COLUMNS } from "../_shared/webshop/orders.js";

export type ActionKind = "email_client" | "ordre_colis";
export type ActionStatus = "sent" | "failed" | "skipped";

export interface MailTemplate {
  subject: string | null;
  html_body: string | null;
}

export interface ActionOutcome {
  status: ActionStatus;
  error_code: string | null;
  error_message: string | null;
  /** Destinataires (« a@x, b@x »), null si aucun. */
  recipient: string | null;
  provider_id: string | null;
  /** Objet rendu, null si rien n'a été rendu. */
  subject: string | null;
  /** Vrai si Resend a été appelé (à tracer dans mailing_logs). */
  attempted: boolean;
}

/** Clés de marque qui sont du TEXTE (à échapper dans le corps HTML) — jamais URL / couleur. */
const BRAND_TEXT_KEYS = [
  "{{BRAND_NAME}}", "{{ORG_EMAIL}}", "{{ORG_PHONE}}", "{{ORG_ADDRESS}}",
  "{{ORG_POSTAL_CODE}}", "{{ORG_CITY}}", "{{EMAIL_TAGLINE}}",
];

/**
 * Valeur HTML (échappée par `variablesCommande`) → texte brut pour l'objet de l'e-mail : balises
 * retirées (seul le HTML construit par le module en contient, le contenu utilisateur est échappé),
 * puis entités désé-chappées, `&amp;` en DERNIER (sinon « &amp;lt; » deviendrait « < »).
 */
export function texteDepuisHtml(v: string): string {
  return String(v ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Rend un gabarit `mail_campaigns` : objet avec des valeurs TEXTE (table dérivée de `varsHtml`,
 * jamais de « &amp; » dans un objet), corps habillé du squelette de l'org avec les valeurs HTML.
 * Les variables de commande priment sur celles de la marque.
 */
export function construireEmail(
  template: MailTemplate,
  branding: OrgBranding,
  varsHtml: Record<string, string>,
): { subject: string; html: string } {
  const marque = brandingReplacements(branding);
  const marqueHtml: Record<string, string> = { ...marque };
  for (const k of BRAND_TEXT_KEYS) if (k in marqueHtml) marqueHtml[k] = escapeHtml(marqueHtml[k]);

  const varsTexte: Record<string, string> = {};
  for (const [k, v] of Object.entries(varsHtml)) varsTexte[k] = texteDepuisHtml(v);

  const subject = applyPlaceholders(template.subject || "", { ...marque, ...varsTexte }).trim();
  const html = applyPlaceholders(wrapWithSkeleton(branding, template.html_body || ""), { ...marqueHtml, ...varsHtml });
  return { subject, html };
}

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

/**
 * Destinataires d'une action. Client : `order.email` (jamais un override du payload).
 * Ordre colis : e-mails du prestataire colis, e-mails internes de l'org en copie (sans doublon).
 */
export function destinatairesAction(action: ActionKind, order: AnyRecord | null, cfg: AnyRecord | null): { to: string[]; cc: string[] } {
  const propre = (l: unknown): string[] =>
    (Array.isArray(l) ? l : []).map((e) => String(e ?? "").trim()).filter(Boolean);
  if (action === "email_client") {
    const e = String(order?.email ?? "").trim();
    return { to: e ? [e] : [], cc: [] };
  }
  const to = propre(cfg?.colis?.prestataire?.emails);
  const cc = propre(cfg?.emails?.interne).filter((e) => !to.includes(e));
  return { to, cc };
}

const RANG = new Map<string, number>(
  (ORDER_BOARD_COLUMNS as Array<{ id: string }>).map((c, i) => [c.id, i]),
);

/** Vrai si `to` est un pas EN ARRIÈRE sur le board : la transition se pose sans action. */
export function estRetour(from: string, to: string): boolean {
  const a = RANG.get(from);
  const b = RANG.get(to);
  return a !== undefined && b !== undefined && b < a;
}

/**
 * Émet UNE action (après réservation par l'appelant). Ordre des refus :
 * destinataire (client sans e-mail → skipped `no_email` ; pas de prestataire → failed
 * `prestataire_missing`), gabarit absent → failed `template_missing`, pas d'expéditeur →
 * failed `no_from_email`, puis envoi : erreur Resend → failed `resend_failed`.
 * Ne throw jamais (`send` ne throw pas : `sendResendEmail`).
 */
export async function issueAction(
  input: {
    action: ActionKind;
    template: MailTemplate | null;
    to: string[];
    cc: string[];
    branding: OrgBranding;
    varsHtml: Record<string, string>;
  },
  send: (p: ResendPayload) => Promise<ResendResult>,
): Promise<ActionOutcome> {
  const { action, template, to, cc, branding, varsHtml } = input;
  const recipient = to.length ? to.join(", ") : null;
  const base: ActionOutcome = {
    status: "failed", error_code: null, error_message: null, recipient, provider_id: null, subject: null, attempted: false,
  };

  if (to.length === 0) {
    return action === "email_client"
      ? { ...base, status: "skipped", error_code: "no_email", error_message: "Commande sans e-mail client" }
      : { ...base, error_code: "prestataire_missing", error_message: "Aucun e-mail de prestataire colis dans les réglages" };
  }
  if (!template) return { ...base, error_code: "template_missing", error_message: "Gabarit d'e-mail absent ou archivé" };
  if (!branding.fromEmail) return { ...base, error_code: "no_from_email", error_message: "Adresse d'expédition de l'org non renseignée" };

  const { subject, html } = construireEmail(template, branding, varsHtml);
  const from = branding.fromName ? `${branding.fromName} <${branding.fromEmail}>` : branding.fromEmail;
  const r = await send({ from, to, cc: cc.length ? cc : undefined, replyTo: branding.replyTo, subject, html });
  if (!r.ok) {
    return { ...base, subject, attempted: true, error_code: "resend_failed", error_message: r.message };
  }
  return { ...base, status: "sent", subject, attempted: true, provider_id: r.id };
}

/**
 * Ordre imposé d'une requête qui pose un statut : TOUTES les lectures (`lire`, peut lever : rien
 * n'est alors écrit), puis l'écriture (`ecrire` → null = rien d'écrit, on n'agit pas), puis les
 * actions (`agir`, qui ne doit pas lever). Une lecture en échec après l'écriture laisserait un
 * statut posé sans action réservée : e-mail perdu sans trace ni rejeu.
 */
export async function lireEcrireAgir<C, W, R>(etapes: {
  lire: () => Promise<C>;
  ecrire: (c: C) => Promise<W | null>;
  agir: (c: C, w: W) => Promise<R>;
}): Promise<{ ecrit: W; resultat: R } | null> {
  const c = await etapes.lire();
  const ecrit = await etapes.ecrire(c);
  if (ecrit === null || ecrit === undefined) return null;
  return { ecrit, resultat: await etapes.agir(c, ecrit) };
}

/**
 * Finalise une action réservée (`webshop_order_action_record`). Une erreur autre que
 * `not_reserved` (ou une exception) est réessayée UNE fois : sinon la ligne resterait `pending`,
 * serait reprise après 10 min et l'e-mail repartirait. `not_reserved` = réservation reprise par
 * un autre appel : non réessayé. Ne throw jamais.
 */
export async function finaliserAction(
  record: () => Promise<{ error: { message: string } | null }>,
): Promise<{ ok: boolean; tentatives: number; erreur: string | null }> {
  let erreur: string | null = null;
  for (let tentative = 1; tentative <= 2; tentative++) {
    try {
      const { error } = await record();
      if (!error) return { ok: true, tentatives: tentative, erreur: null };
      erreur = error.message;
    } catch (err) {
      erreur = err instanceof Error ? err.message : String(err);
    }
    if (erreur === "not_reserved") return { ok: false, tentatives: tentative, erreur };
  }
  return { ok: false, tentatives: 2, erreur };
}
