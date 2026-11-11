// src/lib/deplacementRdv.js
// ============================================================================
// Déplacer un RDV existant en le glissant dans la grille de la fenêtre « Nouveau RDV »
// (Eric 2026-11-11 : « pouvoir faire glisser des RDV pour améliorer le planning »).
// Module PUR, testé : node --test scripts/deplacement-rdv.test.mjs
// ============================================================================

/**
 * Un RDV se glisse-t-il ? Non s'il est facturé (violet, la journée est close) ou si son heure
 * a été communiquée au client (`hour_confirmed_at` : figé, cf. Module Tournées) — ceux-là se
 * changent depuis le planning, en connaissance de cause.
 * @param {object} apt  ligne de `getTeamDayAvailability`
 * @returns {{ ok: boolean, raison: string|null }}
 */
export function peutDeplacer(apt) {
  if (!apt) return { ok: false, raison: null };
  if (apt.target_invoiced === true) return { ok: false, raison: 'RDV facturé' };
  if (apt.hour_confirmed_at) return { ok: false, raison: 'Heure communiquée au client (RDV figé)' };
  return { ok: true, raison: null };
}

/**
 * Ce qu'il faut écrire pour un déplacement : l'horaire (toujours) et, si le RDV change de
 * colonne, la réaffectation — la personne d'origine remplacée par la nouvelle parmi les
 * techniciens, ou le commercial assigné. Un RDV à plusieurs techniciens garde les autres.
 * @param {object} apt  { technician_ids, assigned_commercial_id }
 * @param {{ fromMemberId: string, toMemberId: string, date: string, startTime: string, endTime: string, duration: number }} d
 * @returns {{ horaire: object, reaffectation: object|null, inchange: boolean }}
 */
export function patchDeplacement(apt, { fromMemberId, toMemberId, date, startTime, endTime, duration }) {
  const horaire = { scheduled_date: date, scheduled_start: startTime, scheduled_end: endTime, duration_minutes: duration };
  let reaffectation = null;
  if (toMemberId && fromMemberId && toMemberId !== fromMemberId) {
    const techs = apt?.technician_ids || [];
    if (techs.includes(fromMemberId)) {
      const suivants = techs.map((id) => (id === fromMemberId ? toMemberId : id));
      reaffectation = { technicianIds: [...new Set(suivants)] };
    } else if (apt?.assigned_commercial_id === fromMemberId) {
      reaffectation = { assigned_commercial_id: toMemberId };
    }
  }
  const memeHoraire = String(apt?.scheduled_start || '').slice(0, 5) === startTime
    && apt?.scheduled_date === date;
  return { horaire, reaffectation, inchange: memeHoraire && !reaffectation };
}

/**
 * Patch qui remet le RDV dans son état d'avant (bouton « Annuler » du déplacement).
 * @param {object} apt  état d'origine
 * @param {object|null} reaffectation  celle qui a été appliquée
 * @returns {{ horaire: object, reaffectation: object|null }}
 */
export function patchRetour(apt, reaffectation) {
  return {
    horaire: {
      scheduled_date: apt.scheduled_date,
      scheduled_start: String(apt.scheduled_start || '').slice(0, 5),
      scheduled_end: apt.scheduled_end ? String(apt.scheduled_end).slice(0, 5) : null,
      duration_minutes: apt.duration_minutes,
    },
    reaffectation: !reaffectation ? null
      : ('technicianIds' in reaffectation
        ? { technicianIds: apt.technician_ids || [] }
        : { assigned_commercial_id: apt.assigned_commercial_id || null }),
  };
}
