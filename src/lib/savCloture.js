/**
 * savCloture.js — « Intervention faite » : clôturer un SAV traité sans avoir été planifié
 * (Eric, 2026-11-09 : un technicien règle le problème entre deux entretiens). Module PUR,
 * testé scripts/sav-cloture.test.mjs.
 *
 * La clôture inscrit l'intervention au planning APRÈS COUP (un RDV « service » terminé, à la
 * date et pour la personne saisies) puis passe la carte en Réalisé : le suivi garde la trace de
 * qui est passé et quand. Écriture : `savService.closeSAVWithoutScheduling`.
 */

/** Statuts depuis lesquels une demande SAV peut être clôturée sans passer par le planning. */
export const STATUTS_CLOTURE_DIRECTE = ['demande', 'devis_envoye', 'pieces_commandees', 'a_planifier'];

/** Durées proposées (minutes). */
export const DUREES_CLOTURE = [15, 30, 45, 60, 90, 120, 180, 240];

const DUREE_DEFAUT = 30;

const deux = (n) => String(n).padStart(2, '0');

/**
 * Date locale au format YYYY-MM-DD (jamais `toISOString` : en UTC, 23 h 30 à Paris tombe la veille).
 * @param {Date} d
 * @returns {string}
 */
export function dateLocale(d) {
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/**
 * "HH:MM" → minutes depuis minuit, `null` si illisible.
 * @param {string | null | undefined} hhmm
 * @returns {number | null}
 */
export function minutesDe(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Minutes depuis minuit → "HH:MM".
 * @param {number} minutes
 * @returns {string}
 */
export function heureDe(minutes) {
  return `${deux(Math.floor(minutes / 60))}:${deux(minutes % 60)}`;
}

/**
 * Une carte peut-elle être clôturée sans planification ? SAV seulement, pas encore au planning.
 * @param {{ intervention_type?: string, workflow_status?: string } | null | undefined} item
 * @returns {boolean}
 */
export function peutCloturerSansPlanifier(item) {
  return !!item && item.intervention_type === 'sav' && STATUTS_CLOTURE_DIRECTE.includes(item.workflow_status);
}

/** Colonnes du kanban qu'un technicien voit pour son propre travail : ce qui est au planning, ce qui est fait. */
export const STATUTS_TECHNICIEN = ['planifie', 'realise'];

/**
 * Colonnes du kanban ouvertes à un technicien : les siennes, plus les demandes SAV en attente
 * (Eric, 2026-11-09 : le technicien clôture lui-même un SAV réglé entre deux entretiens).
 * @returns {string[]}
 */
export function colonnesTechnicien() {
  return [...STATUTS_CLOTURE_DIRECTE, ...STATUTS_TECHNICIEN];
}

/**
 * Un technicien voit-il cette carte ? Son planning comme avant, et les SAV pas encore planifiés —
 * jamais les entretiens « À planifier » ni les demandes de contrat (programmation = bureau).
 * @param {{ intervention_type?: string, workflow_status?: string } | null | undefined} item
 * @returns {boolean}
 */
export function carteVisibleParTechnicien(item) {
  if (!item) return false;
  return STATUTS_TECHNICIEN.includes(item.workflow_status) || peutCloturerSansPlanifier(item);
}

/**
 * Sur une demande SAV en attente, un technicien n'a qu'un geste : « Intervention faite ».
 * Planifier, envoyer un devis ou déplacer la carte restent au bureau.
 * @param {{ intervention_type?: string, workflow_status?: string } | null | undefined} item
 * @param {string | null | undefined} role rôle effectif (`useCanAccess().effectiveRole`)
 * @returns {boolean}
 */
export function limiteALaCloture(item, role) {
  return role === 'technicien' && peutCloturerSansPlanifier(item);
}

/**
 * Peut-on identifier les pièces d'une carte SAV (module « Pièces identifiées ») ? Garde d'écran :
 * SAV seulement, jamais une fois Réalisé ni facturé, et pour qui gère le SAV ou le technicien
 * qui se rend chez le client.
 * @param {{ intervention_type?: string, workflow_status?: string } | null | undefined} item
 * @param {{ role?: string | null, canEditSAV?: boolean }} droits `role` = `useCanAccess().effectiveRole`, `canEditSAV` = droit d'édition SAV
 * @returns {boolean}
 */
export function peutIdentifierPieces(item, { role, canEditSAV }) {
  if (!item || item.intervention_type !== 'sav') return false;
  if (item.workflow_status === 'realise' || item.workflow_status === 'facture') return false;
  return !!canEditSAV || role === 'technicien';
}

/**
 * Peut-on ranger une pièce identifiée sur une demande SAV créée à la volée ? La demande se crée par
 * cette voie sans `sav.create` : `clients.edit` suffit (Eric, 2026-11-12).
 * @param {{ canEditClient?: boolean }} droits `canEditClient` = `can('clients', 'edit')`
 * @returns {boolean}
 */
export function peutRangerSurDemandeSav({ canEditClient }) {
  return !!canEditClient;
}

/**
 * Saisie proposée à l'ouverture : aujourd'hui, une intervention de 30 min qui vient de se
 * terminer (début ramené au quart d'heure, jamais avant minuit).
 * @param {Date} maintenant
 * @returns {{ date: string, startTime: string, durationMinutes: number, technicianIds: string[], workPerformed: string }}
 */
export function clotureParDefaut(maintenant) {
  const fin = maintenant.getHours() * 60 + maintenant.getMinutes();
  const debut = Math.max(0, Math.floor((fin - DUREE_DEFAUT) / 15) * 15);
  return { date: dateLocale(maintenant), startTime: heureDe(debut), durationMinutes: DUREE_DEFAUT, technicianIds: [], workPerformed: '' };
}

/**
 * Contrôle de la saisie. Renvoie la liste des refus, en clair (vide = valide).
 * @param {{ date?: string, startTime?: string, durationMinutes?: number, technicianIds?: string[] }} saisie
 * @param {{ aujourdhui: string }} contexte date du jour, YYYY-MM-DD
 * @returns {string[]}
 */
export function validerCloture(saisie, { aujourdhui }) {
  const erreurs = [];
  const { date, startTime, durationMinutes, technicianIds } = saisie || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) erreurs.push('La date de l’intervention est requise');
  else if (date > aujourdhui) erreurs.push('Une intervention faite ne peut pas être datée dans le futur');
  const debut = minutesDe(startTime);
  if (debut == null) erreurs.push('L’heure de début est requise');
  const duree = Number(durationMinutes);
  if (!Number.isFinite(duree) || duree < 5) erreurs.push('La durée est requise');
  else if (debut != null && debut + duree > 24 * 60) erreurs.push('L’intervention ne peut pas déborder sur le lendemain');
  if (!Array.isArray(technicianIds) || technicianIds.length === 0) erreurs.push('Indiquez qui est intervenu');
  return erreurs;
}

/**
 * RDV à inscrire au planning pour une intervention déjà faite (champs de `majordhome_appointments`,
 * hors `org_id` / `created_by` posés par le service de RDV).
 * @param {object} card carte SAV (ligne de `majordhome_entretien_sav`)
 * @param {{ date: string, startTime: string, durationMinutes: number, workPerformed?: string }} saisie saisie VALIDE
 * @returns {object}
 */
export function construireRdvCloture(card, saisie) {
  const debut = minutesDe(saisie.startTime);
  const duree = Number(saisie.durationMinutes);
  const fait = (saisie.workPerformed || '').trim();
  return {
    appointment_type: 'service',
    subject: card.includes_entretien ? 'SAV + Entretien' : 'SAV',
    scheduled_date: saisie.date,
    scheduled_start: saisie.startTime,
    scheduled_end: heureDe(debut + duree),
    duration_minutes: duree,
    announced_start: saisie.startTime,
    intervention_id: card.id,
    client_id: card.client_id || null,
    client_name: card.client_last_name || card.client_name || 'Sans nom',
    client_first_name: card.client_first_name || null,
    client_phone: card.client_phone || '',
    client_email: card.client_email || null,
    address: card.client_address || null,
    city: card.client_city || null,
    postal_code: card.client_postal_code || null,
    description: card.sav_description || null,
    internal_notes: ['Intervention inscrite après coup (SAV clôturé sans planification).', fait].filter(Boolean).join('\n'),
    // Terminé : rien à organiser, le moteur de tournées ne le déplacera jamais.
    status: 'completed',
    priority: 'normal',
  };
}
