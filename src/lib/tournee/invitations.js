// ============================================================================
// Invitations auto-RDV — module PUR (spec 2026-09-29 § 4.1 étape 1, § 6).
// Qui inviter pour un mois, et à quelle étape de relance en est une invitation.
// Aucune écriture ici : l'edge auto-rdv-cron lit, décide avec ce module, écrit.
// ============================================================================

import { retardStatus } from './eligibilite.js';

const RAISONS_EXCLUSION = ['deja_planifie', 'deja_invite', 'archive', 'optout', 'desinscrit', 'sans_email', 'hors_periode'];

/** `YYYY-MM` d'une date ISO. */
function moisDe(iso) {
  return String(iso || '').slice(0, 7);
}

/**
 * Contrats à inviter pour un mois : actifs, sans visite cette année, sans carte
 * d'entretien en cours, pas déjà invités ce mois, un par client, dont
 * l'anniversaire tombe dans le mois — ou en retard (anniversaire passé sans
 * visite) si `reglages.auto_rdv.inclure_retardataires`. Les clients sans e-mail,
 * désinscrits, opt-out ou archivés sont comptés `exclus` (ils vont en liste
 * d'appels, pas au mail) — sauf `sans_email`, renvoyé à part pour créer une
 * invitation `outcome = 'phone'`.
 *
 * @param {{
 *   contrats: Array<{ id: string, client_id: string, start_date?: string|null, current_year_visit_status?: string|null, status?: string }>,
 *   clients: Map<string, { email?: string|null, first_name?: string|null, last_name?: string|null, phone?: string|null,
 *     mail_optin?: boolean|null, email_unsubscribed_at?: string|null, is_archived?: boolean|null,
 *     latitude?: number|null, longitude?: number|null, postal_code?: string|null }>,
 *   cartesEnCours: Set<string>, dejaInvites: Set<string>, mois: string, reglages: { auto_rdv?: { inclure_retardataires?: boolean }, tolerance_anniversaire_mois?: number }
 * }} p  `mois` = `YYYY-MM`
 * @returns {{ aInviter: Array<{ contractId: string, clientId: string, email: string, prenom: string|null, nom: string|null, telephone: string|null, raison: 'anniversaire'|'retard' }>,
 *   sansEmail: Array<{ contractId: string, clientId: string, raison: 'anniversaire'|'retard' }>, exclus: Record<string, number> }}
 */
export function contratsAInviter({ contrats, clients, cartesEnCours, dejaInvites, mois, reglages }) {
  const exclus = Object.fromEntries(RAISONS_EXCLUSION.map((r) => [r, 0]));
  const moisCible = Number(String(mois).slice(5, 7));
  const inclureRetard = reglages?.auto_rdv?.inclure_retardataires !== false;
  const tolerance = reglages?.tolerance_anniversaire_mois ?? 2;
  const aInviter = [];
  const sansEmail = [];
  const clientsVus = new Set();
  const tries = [...(contrats || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const c of tries) {
    if (c.status && c.status !== 'active') continue;
    if (c.current_year_visit_status != null) continue;
    if (!c.client_id || clientsVus.has(c.client_id)) continue;
    if (cartesEnCours?.has(c.id)) { exclus.deja_planifie += 1; continue; }
    if (dejaInvites?.has(c.id)) { exclus.deja_invite += 1; continue; }
    const moisAnniv = c.start_date ? Number(String(c.start_date).slice(5, 7)) : null;
    let raison = null;
    if (moisAnniv === moisCible) raison = 'anniversaire';
    else if (inclureRetard && moisAnniv != null && retardStatus(moisAnniv, moisCible, tolerance) === 'en_retard') raison = 'retard';
    if (!raison) { exclus.hors_periode += 1; continue; }
    const cl = clients?.get(c.client_id);
    if (!cl || cl.is_archived) { exclus.archive += 1; continue; }
    clientsVus.add(c.client_id);
    if (cl.mail_optin === false) { exclus.optout += 1; continue; }
    if (cl.email_unsubscribed_at) { exclus.desinscrit += 1; continue; }
    const email = String(cl.email || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      exclus.sans_email += 1;
      sansEmail.push({ contractId: c.id, clientId: c.client_id, raison });
      continue;
    }
    aInviter.push({
      contractId: c.id, clientId: c.client_id, email,
      prenom: cl.first_name || null, nom: cl.last_name || null, telephone: cl.phone || null, raison,
    });
  }
  return { aInviter, sansEmail, exclus };
}

/**
 * Étape de relance d'une invitation, un jour donné. `null` = rien à faire.
 *
 * @param {{ mois: string, sent_at?: string|null, booked_at?: string|null, sms_relance_at?: string|null, escalade_appel_at?: string|null, outcome?: string|null }} inv
 *   `mois` = `YYYY-MM-DD` (1er du mois) ou `YYYY-MM`
 * @param {string} aujourdhui  `YYYY-MM-DD`
 * @param {{ auto_rdv?: { relance_sms_jours?: number, escalade_appel_jours?: number } }} reglages
 * @returns {'sms'|'appel'|'expire'|null}
 */
export function etapeRelance(inv, aujourdhui, reglages) {
  if (!inv || inv.booked_at || inv.outcome === 'booked' || inv.outcome === 'expired') return null;
  const finMois = (() => {
    const [y, m] = String(inv.mois).split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  })();
  if (aujourdhui > finMois) return 'expire';
  if (!inv.sent_at) return null; // jamais envoyée (sans e-mail) : rien à relancer
  const jours = Math.floor((Date.UTC(...aujourdhui.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))))
    - Date.parse(String(inv.sent_at).slice(0, 10) + 'T00:00:00Z')) / 86_400_000);
  const smsJ = reglages?.auto_rdv?.relance_sms_jours ?? 7;
  const appelJ = reglages?.auto_rdv?.escalade_appel_jours ?? 15;
  if (jours >= appelJ && !inv.escalade_appel_at) return 'appel';
  if (jours >= smsJ && !inv.sms_relance_at && !inv.escalade_appel_at) return 'sms';
  return null;
}

/** Mois d'une date ISO, exporté pour l'edge. */
export { moisDe };
