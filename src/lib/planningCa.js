/**
 * planningCa.js — CA HT programmé du Planning (module PUR, testé)
 * ============================================================================
 * « CA HT des affaires programmées » (Eric, 2026-11-14) : un chiffre par jour,
 * et la part de chaque technicien sur sa puce.
 *
 *   - installation : montant du chantier (devis validés, cf. getChantierAmount),
 *     réparti au PRORATA DES JOURNÉES posées du chantier — toutes ses journées,
 *     y compris hors de la plage affichée. Rien n'est stocké : déplacer, ajouter
 *     ou annuler un jour change la part de chaque journée à la lecture suivante.
 *   - entretien : montant du contrat (TTC en base) ramené en HT.
 *   - SAV, visites, congés, tout le reste : 0 pour l'instant.
 *
 * La part d'une journée est partagée à parts égales entre les techniciens de
 * l'affaire ce jour-là : la somme des puces d'un jour donne son total, un
 * chantier à deux ne compte pas double.
 *
 * Test : node --test scripts/planning-ca.test.mjs
 * ============================================================================
 */

/** Statuts d'un RDV qui n'est plus programmé. */
const STATUTS_ANNULES = new Set(['cancelled', 'no_show']);

/** TVA retenue quand la catégorie d'équipement n'en porte pas (convention de la facture d'entretien). */
const TVA_PAR_DEFAUT = 20;

/**
 * Affaire portée par un RDV, ou null s'il ne compte pas dans le CA.
 * @param {{appointment_type?: string, chantier_id?: string|null, intervention_id?: string|null}} rdv
 * @returns {string|null} `chantier:<id>` | `entretien:<id intervention>` | null
 */
export function cleAffaire(rdv) {
  if (!rdv) return null;
  if (rdv.appointment_type === 'installation' && rdv.chantier_id) return `chantier:${rdv.chantier_id}`;
  if (rdv.appointment_type === 'maintenance' && rdv.intervention_id) return `entretien:${rdv.intervention_id}`;
  return null;
}

/** @param {{status?: string}} rdv */
function estProgramme(rdv) {
  return !STATUTS_ANNULES.has(rdv?.status);
}

/**
 * Journées posées de chaque affaire, à partir de TOUS ses RDV (plage affichée ou non).
 * @param {Array<object>} rdvs
 * @returns {Map<string, Set<string>>} clé d'affaire → dates ISO
 */
export function indexerJours(rdvs) {
  const jours = new Map();
  for (const rdv of rdvs || []) {
    const cle = cleAffaire(rdv);
    if (!cle || !rdv.scheduled_date || !estProgramme(rdv)) continue;
    if (!jours.has(cle)) jours.set(cle, new Set());
    jours.get(cle).add(rdv.scheduled_date);
  }
  return jours;
}

/**
 * Taux de TVA d'un contrat d'entretien : celui de la catégorie de ses équipements.
 * Taux différents → moyenne simple (les prix par ligne ne sont pas chargés ici :
 * approximation de quelques euros, 10 contrats sur 488 le 2026-11-14).
 * @param {Array<number|string|null|undefined>} tauxEquipements  un taux (%) par équipement
 * @returns {number} taux en %
 */
export function tauxTvaContrat(tauxEquipements) {
  const taux = (tauxEquipements || []).map((t) => {
    const n = t === null || t === undefined || t === '' ? NaN : Number(t);
    return Number.isFinite(n) ? n : TVA_PAR_DEFAUT;
  });
  if (taux.length === 0) return TVA_PAR_DEFAUT;
  return taux.reduce((s, t) => s + t, 0) / taux.length;
}

/**
 * Montant HT d'un contrat : `contracts.amount` est TTC.
 * @param {number|string|null} montantTtc
 * @param {Array<number|string|null|undefined>} tauxEquipements
 * @returns {number}
 */
export function montantHtContrat(montantTtc, tauxEquipements) {
  const ttc = Number(montantTtc) || 0;
  return ttc / (1 + tauxTvaContrat(tauxEquipements) / 100);
}

/**
 * CA HT programmé par jour et par technicien × jour.
 *
 * @param {object} p
 * @param {Array<object>} p.rdvs  RDV de la plage affichée, avec `technician_ids`
 * @param {Map<string, Set<string>|string[]>} p.joursParAffaire  cf. indexerJours (toutes les journées)
 * @param {Map<string, number>} p.montantParAffaire  clé d'affaire → montant HT
 * @param {Set<string>|null} [p.technicienIds]  filtre équipe ; null = toute l'équipe
 * @returns {{ parJour: Map<string, number>, parTechnicienJour: Map<string, number>, sansMontantParJour: Map<string, number> }}
 *   `parTechnicienJour` : clé `${date}|${technicienId}`. Avec un filtre équipe, le
 *   total du jour est la part des personnes affichées (ce que montre le calendrier).
 */
export function caProgramme({ rdvs, joursParAffaire, montantParAffaire, technicienIds = null }) {
  // Affaire × jour affiché → techniciens de l'affaire ce jour-là.
  const affairesDuJour = new Map();
  const joursAffiches = new Map();
  for (const rdv of rdvs || []) {
    const cle = cleAffaire(rdv);
    if (!cle || !rdv.scheduled_date || !estProgramme(rdv)) continue;
    const k = `${cle}|${rdv.scheduled_date}`;
    if (!affairesDuJour.has(k)) affairesDuJour.set(k, { cle, date: rdv.scheduled_date, techniciens: new Set() });
    for (const t of rdv.technician_ids || []) affairesDuJour.get(k).techniciens.add(t);
    if (!joursAffiches.has(cle)) joursAffiches.set(cle, new Set());
    joursAffiches.get(cle).add(rdv.scheduled_date);
  }

  const parJour = new Map();
  const parTechnicienJour = new Map();
  const sansMontantParJour = new Map();
  const ajouter = (map, k, v) => map.set(k, (map.get(k) || 0) + v);

  for (const { cle, date, techniciens } of affairesDuJour.values()) {
    const montant = Number(montantParAffaire?.get(cle)) || 0;
    if (montant <= 0) {
      ajouter(sansMontantParJour, date, 1);
      continue;
    }
    // Un jour affiché est forcément une journée de l'affaire : on le réunit à la
    // liste complète (qui peut arriver un instant après le calendrier).
    const jours = new Set([...(joursParAffaire?.get(cle) || []), ...joursAffiches.get(cle)]);
    const partJour = montant / jours.size;
    const partTechnicien = techniciens.size > 0 ? partJour / techniciens.size : 0;
    let partAffichee = technicienIds ? 0 : partJour;
    for (const t of techniciens) {
      if (technicienIds && !technicienIds.has(t)) continue;
      ajouter(parTechnicienJour, `${date}|${t}`, partTechnicien);
      if (technicienIds) partAffichee += partTechnicien;
    }
    if (partAffichee > 0) ajouter(parJour, date, partAffichee);
  }
  return { parJour, parTechnicienJour, sansMontantParJour };
}

/**
 * Cumul de la période affichée (semaine, jour, mois), tous techniciens confondus.
 * @param {Map<string, number>|null|undefined} parJour  cf. caProgramme
 * @param {string} debut  date ISO incluse
 * @param {string} finExclue  date ISO exclue (convention FullCalendar)
 * @returns {number}
 */
export function cumulPeriode(parJour, debut, finExclue) {
  let total = 0;
  for (const [date, montant] of parJour || []) {
    if (date >= debut && date < finExclue) total += montant;
  }
  return total;
}

/**
 * Montant affiché : euros entiers, espaces ordinaires.
 * @param {number} montant
 * @returns {string}
 */
export function formatCa(montant) {
  return `${Math.round(Number(montant) || 0).toLocaleString('fr-FR').replace(/\s/g, ' ')} €`;
}
