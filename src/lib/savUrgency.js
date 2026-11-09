/**
 * savUrgency.js — degré d'urgence d'une demande SAV (module PUR, testé scripts/sav-urgency.test.mjs).
 *
 * Source unique des niveaux (colonne `interventions.sav_urgency`, migration 20261109_1) : la
 * création, la fiche, la carte et le tri du kanban lisent tous ici. Une valeur absente se lit
 * « normal » : les SAV ouverts avant la colonne ne sont pas réécrits.
 */

/** @typedef {'urgent' | 'normal' | 'peut_attendre'} SavUrgence */

/** @type {Array<{ value: SavUrgence, label: string, description: string }>} */
export const SAV_URGENCES = [
  { value: 'urgent', label: 'Urgent', description: 'Client sans chauffage, panne totale' },
  { value: 'normal', label: 'Normal', description: 'À traiter dans le flux habituel' },
  { value: 'peut_attendre', label: 'Peut attendre', description: 'Sans gêne pour le client' },
];

/** @type {SavUrgence} */
export const SAV_URGENCE_DEFAUT = 'normal';

// Une demande n'est plus « urgente » une fois posée au planning ou traitée : la date fait foi.
const STATUTS_OUVERTS = ['demande', 'devis_envoye', 'pieces_commandees', 'a_planifier'];

/**
 * Urgence d'une carte. `null` pour tout ce qui n'est pas un SAV.
 * @param {{ intervention_type?: string, sav_urgency?: string | null } | null | undefined} item
 * @returns {SavUrgence | null}
 */
export function urgenceDe(item) {
  if (!item || item.intervention_type !== 'sav') return null;
  return SAV_URGENCES.some((u) => u.value === item.sav_urgency) ? item.sav_urgency : SAV_URGENCE_DEFAUT;
}

/**
 * Libellé d'un niveau (valeur inconnue ou vide → libellé du défaut).
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function libelleUrgence(value) {
  const niveau = SAV_URGENCES.find((u) => u.value === value) || SAV_URGENCES.find((u) => u.value === SAV_URGENCE_DEFAUT);
  return niveau.label;
}

/**
 * Vrai si la carte est un SAV urgent encore à traiter (ni planifié, ni réalisé) : c'est ce
 * qui la fait remonter en tête de colonne.
 * @param {{ intervention_type?: string, sav_urgency?: string | null, workflow_status?: string } | null | undefined} item
 * @returns {boolean}
 */
export function estUrgentATraiter(item) {
  return urgenceDe(item) === 'urgent' && STATUTS_OUVERTS.includes(item.workflow_status);
}

/**
 * Le niveau s'affiche-t-il sur la carte ? « Normal » ne s'affiche jamais (pas de bruit), et
 * plus rien une fois l'intervention réalisée.
 * @param {{ intervention_type?: string, sav_urgency?: string | null, workflow_status?: string } | null | undefined} item
 * @returns {boolean}
 */
export function urgenceVisible(item) {
  const niveau = urgenceDe(item);
  if (!niveau || niveau === SAV_URGENCE_DEFAUT) return false;
  return !['realise', 'facture'].includes(item.workflow_status);
}

/**
 * Date affichée sur la carte : prochain RDV, sinon date prévue, sinon création.
 * @param {{ next_rdv_date?: string | null, scheduled_date?: string | null, created_at?: string | null }} item
 * @returns {string}
 */
export function dateDeCarte(item) {
  return String(item.next_rdv_date || item.scheduled_date || item.created_at || '9999-12-31');
}

/**
 * Ordre des cartes du kanban : SAV urgents à traiter en tête, puis par date croissante.
 * Ne modifie pas le tableau reçu.
 * @template {object} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function trierCartes(items) {
  return [...(items || [])].sort((a, b) => {
    const ua = estUrgentATraiter(a) ? 0 : 1;
    const ub = estUrgentATraiter(b) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return dateDeCarte(a).localeCompare(dateDeCarte(b));
  });
}
