// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/leadWelcomeEmail.js — ne pas éditer.
// src/lib/leadWelcomeEmail.js
// ============================================================================
// E-mail d'accueil des leads Meta Ads (2026-10-24). Un prospect qui laisse ses
// coordonnées dans un formulaire Facebook / Instagram reçoit une confirmation
// de prise en charge. Les leads du site vitrine en reçoivent déjà une (envoyée
// par le site) : ils sont hors périmètre.
//
// Même patron que autoRdvEmailTemplates.js : gabarit transactionnel rangé dans
// `majordhome_mail_campaigns` (is_transactional = true, exclu du broadcast),
// créé depuis Settings → Communication → Emails, modifiable dans Mailing →
// Éditeur. Placeholders {{UPPER_SNAKE}} : ceux-ci + le branding
// (mail.ts::brandingReplacements).
//
// Réglage d'org : settings.lead_welcome_email = { enabled, enabled_since }.
// `enabled_since` (posé à l'activation) borne l'envoi : jamais d'envoi
// rétroactif aux leads arrivés avant.
//
// Module PUR, copié pour Deno (PARTAGES de sync-tournee-engine) : l'edge
// lead-welcome-email l'utilise.
// ============================================================================

export const LEAD_WELCOME_TEMPLATE_KEY = 'accueil_lead_meta';

/** Sources de lead concernées (external_source). */
export const LEAD_WELCOME_SOURCES = Object.freeze(['meta_ads']);

/** Fenêtre de rattrapage : un lead plus vieux n'est jamais accueilli (mail périmé). */
export const LEAD_WELCOME_MAX_AGE_HOURS = 72;

/** Au-delà de ce nombre d'échecs Resend pour un lead, on cesse de réessayer. */
export const LEAD_WELCOME_MAX_ECHECS = 3;

export const DEFAULT_LEAD_WELCOME_EMAIL = Object.freeze({
  key: LEAD_WELCOME_TEMPLATE_KEY,
  label: 'Accueil lead Meta — confirmation de la demande',
  subject: 'Nous avons bien reçu votre demande — {{BRAND_NAME}}',
  html_body: [
    '<p>Bonjour {{PRENOM}},</p>',
    '<p>Merci pour votre demande : elle est bien prise en compte. Un conseiller va vous recontacter très rapidement pour échanger sur votre projet.</p>',
    '<p>En attendant, vous pouvez nous joindre au {{ORG_PHONE}} ou par e-mail à {{ORG_EMAIL}}, et découvrir nos réalisations sur <a href="{{ORG_WEBSITE_URL}}">notre site internet</a>.</p>',
    '<p>À très bientôt,<br>{{BRAND_NAME}}</p>',
  ].join(''),
  is_transactional: true,
});

/**
 * Réglage normalisé.
 * @param {Record<string, unknown> | null | undefined} settings
 * @returns {{ enabled: boolean, enabled_since: string | null }}
 */
export function leadWelcomeSettings(settings) {
  const r = /** @type {Record<string, unknown>} */ ((settings && settings.lead_welcome_email) || {});
  const since = typeof r.enabled_since === 'string' && !Number.isNaN(Date.parse(r.enabled_since)) ? r.enabled_since : null;
  return { enabled: r.enabled === true && !!since, enabled_since: since };
}

/**
 * Nouvel objet de réglage après bascule de l'interrupteur. Une activation
 * pose `enabled_since` à maintenant : les leads déjà là ne sont jamais servis.
 * @param {boolean} enabled
 * @param {Date} [now]
 * @returns {{ enabled: boolean, enabled_since: string | null }}
 */
export function toggleLeadWelcome(enabled, now = new Date()) {
  return enabled ? { enabled: true, enabled_since: now.toISOString() } : { enabled: false, enabled_since: null };
}

/**
 * Date à partir de laquelle un lead est éligible : la plus récente entre
 * l'activation et la fenêtre de rattrapage.
 * @param {string} enabledSince ISO
 * @param {Date} [now]
 * @returns {string} ISO
 */
export function borneCreation(enabledSince, now = new Date()) {
  const fenetre = now.getTime() - LEAD_WELCOME_MAX_AGE_HOURS * 3_600_000;
  return new Date(Math.max(Date.parse(enabledSince), fenetre)).toISOString();
}

/**
 * Leads à accueillir parmi les candidats déjà filtrés par source et date.
 * `journal` = lignes de mailing_logs du gabarit pour ces leads.
 * @param {Array<{ id: string, email?: string | null, is_deleted?: boolean, email_unsubscribed_at?: string | null }>} leads
 * @param {Array<{ lead_id: string | null, status: string }>} journal
 * @returns {{ aEnvoyer: typeof leads, exclus: Record<string, number> }}
 */
export function leadsAAccueillir(leads, journal) {
  const envoyes = new Set();
  /** @type {Map<string, number>} */
  const echecs = new Map();
  for (const l of journal || []) {
    if (!l.lead_id) continue;
    if (l.status === 'failed') echecs.set(l.lead_id, (echecs.get(l.lead_id) || 0) + 1);
    else envoyes.add(l.lead_id); // sent, delivered, opened… : déjà parti
  }
  /** @type {Record<string, number>} */
  const exclus = { deja_envoye: 0, sans_email: 0, desinscrit: 0, supprime: 0, trop_d_echecs: 0 };
  const aEnvoyer = [];
  for (const lead of leads || []) {
    if (lead.is_deleted) exclus.supprime += 1;
    else if (envoyes.has(lead.id)) exclus.deja_envoye += 1;
    else if (!lead.email || !String(lead.email).includes('@')) exclus.sans_email += 1;
    else if (lead.email_unsubscribed_at) exclus.desinscrit += 1;
    else if ((echecs.get(lead.id) || 0) >= LEAD_WELCOME_MAX_ECHECS) exclus.trop_d_echecs += 1;
    else aEnvoyer.push(lead);
  }
  return { aEnvoyer, exclus };
}
