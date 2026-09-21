/**
 * installOrder.js — commande « personnes × jours » d'une installation ou d'un SAV.
 * ============================================================================
 * Module PUR (aucun import React / Supabase) : testé par `scripts/install-order.test.mjs`
 * (inclus dans `audit:quality`).
 *
 * - `fusionnerCreneau` : dans l'assistant de créneaux, un second clic sur une
 *   journée qui porte déjà un créneau brouillon au même horaire AJOUTE la personne
 *   à ce créneau au lieu d'en créer un second (un jour = un RDV à N techniciens).
 * - `etatCommande` : compare les jours posés (brouillons ou RDV) à la commande
 *   portée par la carte (`planned_team_size` × `planned_days`), pour prévenir sans
 *   bloquer (« on décide sur l'instant »).
 *
 * Spec : docs/superpowers/specs/2026-09-21-chantier-commande-installation-personnes-jours-design.md
 * ============================================================================
 */

/** 'HH:MM' → minutes depuis minuit (NaN si absent). */
function minutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Deux créneaux `{ startTime, endTime }` se chevauchent-ils ? Bornes jointives = non.
 * `endTime` absent ⇒ le créneau est traité comme un instant à `startTime`.
 * @param {{startTime: string, endTime?: string|null}} a
 * @param {{startTime: string, endTime?: string|null}} b
 * @returns {boolean}
 */
export function chevauche(a, b) {
  const aStart = minutes(a?.startTime);
  const bStart = minutes(b?.startTime);
  if (Number.isNaN(aStart) || Number.isNaN(bStart)) return false;
  const aEnd = a?.endTime ? minutes(a.endTime) : aStart;
  const bEnd = b?.endTime ? minutes(b.endTime) : bStart;
  // Instant (durée nulle) : inclus si à l'intérieur de l'autre.
  if (aEnd === aStart) return aStart >= bStart && aStart < bEnd;
  if (bEnd === bStart) return bStart >= aStart && bStart < aEnd;
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Ajoute `slot` aux brouillons : s'il chevauche un brouillon du même jour, les
 * personnes sont réunies sur ce brouillon (horaire existant conservé) ; sinon il
 * est ajouté. Un créneau sans personne est toujours ajouté tel quel (le filet
 * « Qui prend ce RDV ? » de l'assistant le prend en charge). Ne mute rien.
 * @param {Array<{id: string, date: string, startTime: string, endTime?: string|null, technicianIds?: string[]}>} draftSlots
 * @param {{id: string, date: string, startTime: string, endTime?: string|null, technicianIds?: string[]}} slot
 * @returns {Array} nouveau tableau
 */
export function fusionnerCreneau(draftSlots, slot) {
  const list = Array.isArray(draftSlots) ? draftSlots : [];
  const ids = slot?.technicianIds || [];
  if (ids.length === 0) return [...list, slot];
  const idx = list.findIndex((s) => s.date === slot.date && chevauche(s, slot));
  if (idx === -1) return [...list, slot];
  const cible = list[idx];
  const union = Array.from(new Set([...(cible.technicianIds || []), ...ids]));
  return list.map((s, i) => (i === idx ? { ...s, technicianIds: union } : s));
}

/** '2026-09-23' → '23/09'. */
function dateCourte(iso) {
  if (!iso || typeof iso !== 'string') return '?';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function pluriel(n, mot) {
  return `${n} ${mot}${n > 1 ? 's' : ''}`;
}

/**
 * État de la commande par rapport aux jours posés.
 * @param {{teamSize?: number|null, days?: number|null}} commande
 * @param {Array<{date: string, technicianIds?: string[]}>} jours brouillons de l'assistant ou RDV posés
 * @returns {{joursAttendus: number, joursPoses: number, joursIncomplets: Array<{date: string, personnes: number, attendues: number}>, complete: boolean, message: string|null}}
 */
export function etatCommande(commande, jours) {
  const teamSize = Number(commande?.teamSize) || null;
  const days = Number(commande?.days) || null;
  const list = Array.isArray(jours) ? jours : [];

  // Personnes par date (deux passages le même jour = un jour, personnes réunies).
  const parDate = new Map();
  for (const j of list) {
    if (!j?.date) continue;
    const set = parDate.get(j.date) || new Set();
    (j.technicianIds || []).forEach((id) => set.add(id));
    parDate.set(j.date, set);
  }
  const joursPoses = parDate.size;
  const joursAttendus = days ?? joursPoses;

  const joursIncomplets = teamSize
    ? Array.from(parDate.entries())
        .filter(([, set]) => set.size < teamSize)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, set]) => ({ date, personnes: set.size, attendues: teamSize }))
    : [];

  const joursManquants = Math.max(0, joursAttendus - joursPoses);
  const parts = [];
  if (joursManquants > 0) parts.push(pluriel(joursManquants, 'jour'));
  if (joursIncomplets.length > 0) {
    const manque = joursIncomplets.reduce((acc, j) => acc + (j.attendues - j.personnes), 0);
    const dates = joursIncomplets.map((j) => dateCourte(j.date)).join(', ');
    parts.push(`${pluriel(manque, 'personne')} le ${dates}`);
  }
  const complete = parts.length === 0;
  return {
    joursAttendus,
    joursPoses,
    joursIncomplets,
    complete,
    message: complete ? null : `Il manque ${parts.join(' et ')}`,
  };
}

/**
 * Libellé court de la commande : '2 pers. × 3 j', '2 j', '2 pers.' ou null.
 * @param {{teamSize?: number|null, days?: number|null}} commande
 * @returns {string|null}
 */
export function libelleCommande(commande) {
  const teamSize = Number(commande?.teamSize) || null;
  const days = Number(commande?.days) || null;
  const parts = [];
  if (teamSize) parts.push(`${teamSize} pers.`);
  if (days) parts.push(`${days} j`);
  return parts.length ? parts.join(' × ') : null;
}
