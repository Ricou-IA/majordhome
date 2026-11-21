/**
 * accueil.js - Majord'home
 * ============================================================================
 * Règles de la page d'accueil : quelle plage de RDV lire, quelle journée montrer,
 * qui est sur un RDV, et ce qui attend d'être traité. Module PUR (aucun import
 * React / Supabase / alias), testé par scripts/accueil.test.mjs — la page ne fait
 * qu'assembler.
 *
 * Aucun chiffre n'est calculé ici : le portefeuille vient du Dashboard du pipeline
 * (pipelineDashboard.js), le CA programmé du Planning (planningCa.js). Un chiffre
 * inconnu (chargement, lecture en échec) n'est jamais rendu comme un zéro : la
 * ligne correspondante n'existe pas, et l'écran dit ce qui manque.
 * ============================================================================
 */

import { dateLocale, jourDOuverture } from './planningGestes.js';

/** Jours lus à partir du lundi de la semaine de référence (deux semaines). */
const JOURS_LUS = 14;

const decaler = (date, jours) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + jours);
const depuisIso = (iso) => {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(a, m - 1, j);
};
const pluriel = (n, singulier, plurielMot = `${singulier}s`) => (n > 1 ? plurielMot : singulier);

/**
 * Plage de RDV lue par l'accueil, en dates LOCALES.
 * Semaine de référence = la semaine en cours ; le week-end, la suivante (comme le
 * Planning, qui masque samedi et dimanche).
 * @param {Date} [maintenant]
 * @returns {{ aujourdhui: string, startDate: string, endDate: string,
 *   semaine: { debut: string, finExclue: string } }}
 *   `startDate` / `endDate` : bornes INCLUSES de la lecture (du début de la semaine en
 *   cours, ou d'aujourd'hui le week-end, jusqu'à deux semaines après le lundi de référence).
 */
export function plageAccueil(maintenant = new Date()) {
  const aujourdhui = dateLocale(maintenant);
  const ouverture = jourDOuverture(maintenant);
  const jour = maintenant.getDay(); // 1 = lundi … 5 = vendredi quand `ouverture` est vide
  const lundi = ouverture ? depuisIso(ouverture) : decaler(maintenant, 1 - jour);
  return {
    aujourdhui,
    startDate: ouverture ? aujourdhui : dateLocale(lundi),
    endDate: dateLocale(decaler(lundi, JOURS_LUS - 1)),
    semaine: { debut: dateLocale(lundi), finExclue: dateLocale(decaler(lundi, 7)) },
  };
}

/** Un RDV qui compte : ni annulé, ni des congés. */
const estRdvDeTravail = (rdv) => rdv?.status !== 'cancelled' && rdv?.appointment_type !== 'leave';
const estConge = (rdv) => rdv?.status !== 'cancelled' && rdv?.appointment_type === 'leave';
const parHeure = (a, b) => String(a.scheduled_start || '').localeCompare(String(b.scheduled_start || ''));

/**
 * Journée montrée par l'accueil : aujourd'hui s'il y a des RDV, sinon le prochain
 * jour qui en a (un samedi, un soir de semaine chargé ailleurs : la page n'est pas vide).
 * @param {Array<{ scheduled_date: string, scheduled_start?: string, status?: string, appointment_type?: string }>} rdvs
 * @param {string} aujourdhui  `YYYY-MM-DD`
 * @returns {{ date: string, estAujourdhui: boolean, rdvs: Array<object>, conges: Array<object> }}
 *   `rdvs` triés par heure, hors annulés et hors congés ; `conges` = congés de CE jour.
 */
export function journeeAffichee(rdvs = [], aujourdhui) {
  const aVenir = (rdvs || []).filter((r) => r.scheduled_date >= aujourdhui);
  const jours = aVenir.filter(estRdvDeTravail).map((r) => r.scheduled_date).sort();
  const date = jours[0] || aujourdhui;
  return {
    date,
    estAujourdhui: date === aujourdhui,
    rdvs: aVenir.filter((r) => r.scheduled_date === date && estRdvDeTravail(r)).sort(parHeure),
    conges: aVenir.filter((r) => r.scheduled_date === date && estConge(r)),
  };
}

/**
 * Nombre de RDV de travail aujourd'hui et sur la semaine de référence.
 * @param {Array<object>} rdvs
 * @param {{ aujourdhui: string, semaine: { debut: string, finExclue: string } }} plage  cf. plageAccueil
 * @returns {{ aujourdhui: number, semaine: number }}
 */
export function compterRdv(rdvs = [], plage) {
  const actifs = (rdvs || []).filter(estRdvDeTravail);
  return {
    aujourdhui: actifs.filter((r) => r.scheduled_date === plage.aujourdhui).length,
    semaine: actifs.filter((r) => r.scheduled_date >= plage.semaine.debut && r.scheduled_date < plage.semaine.finExclue).length,
  };
}

/**
 * Personnes d'un RDV : ses techniciens et son commercial, chacun une fois (une
 * personne présente dans les deux référentiels porte un seul nom, cf. buildTeamList).
 * @param {{ technician_ids?: string[], assigned_commercial_id?: string|null }} rdv
 * @param {Array<{ profileKey: string, displayName: string, color: string, recordIds: string[] }>} equipe
 * @returns {Array<{ cle: string, nom: string, couleur: string }>}  vide si personne n'est résolu
 */
export function personnesDuRdv(rdv, equipe = []) {
  const ids = new Set([...(rdv?.technician_ids || []), rdv?.assigned_commercial_id].filter(Boolean));
  if (ids.size === 0) return [];
  return (equipe || [])
    .filter((h) => (h.recordIds || []).some((id) => ids.has(id)))
    .map((h) => ({ cle: h.profileKey, nom: h.displayName, couleur: h.color }));
}

/**
 * Ce qui attend d'être traité, en lignes prêtes à afficher. Une source inconnue
 * (`null` : chargement, lecture en échec, pas le droit) ne produit aucune ligne.
 * @param {object} p
 * @param {{ aContacter: number, rdvAReplanifier: number, devisEnAttente: number, devisSansRelance: number }|null} [p.portefeuille]
 *   total du portefeuille ouvert (pipelineDashboard.js)
 * @param {{ commandeAFaire: number, aPlanifier: number }|null} [p.chantiers]
 * @param {number} p.seuilRelance  jours sans relance (SEUIL_RELANCE_JOURS)
 * @returns {Array<{ cle: string, nombre: number, texte: string, href: string, attention: boolean }>}
 *   lignes à nombre > 0 seulement ; `attention` = retard à signaler (libellé, pas seulement couleur).
 */
export function lignesATraiter({ portefeuille = null, chantiers = null, seuilRelance }) {
  const lignes = [];
  const ajouter = (cle, nombre, texte, href, attention = false) => {
    const n = Number(nombre) || 0;
    if (n > 0) lignes.push({ cle, nombre: n, texte, href, attention });
  };
  if (portefeuille) {
    const { aContacter, rdvAReplanifier, devisSansRelance } = portefeuille;
    ajouter('a-contacter', aContacter, `${pluriel(aContacter, 'lead')} à contacter`, '/pipeline?tab=kanban');
    ajouter('rdv-a-replanifier', rdvAReplanifier,
      `${pluriel(rdvAReplanifier, 'RDV commercial', 'RDV commerciaux')} à replanifier`, '/pipeline?tab=kanban');
    ajouter('devis-sans-relance', devisSansRelance,
      `devis sans relance depuis plus de ${seuilRelance} jours`, '/pipeline?tab=dashboard', true);
  }
  if (chantiers) {
    ajouter('commandes', chantiers.commandeAFaire, `${pluriel(chantiers.commandeAFaire, 'commande')} à passer`, '/chantiers');
    ajouter('a-planifier', chantiers.aPlanifier, `${pluriel(chantiers.aPlanifier, 'chantier')} à planifier`, '/chantiers');
  }
  return lignes;
}
