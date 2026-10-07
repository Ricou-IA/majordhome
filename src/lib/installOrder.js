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

/**
 * Un clic sur une personne pose (ou retire) SA JOURNÉE : si elle figure déjà sur un
 * brouillon de cette date, elle en est retirée (brouillon supprimé s'il se vide) ;
 * sinon `slot` (sa journée de travail, une seule personne) rejoint les brouillons
 * via `fusionnerCreneau` — un jour = un RDV à N techniciens, l'horaire du premier
 * posé est conservé. Ne mute rien.
 *
 * `regrouper: false` (congés, Eric 2026-10-04) : chaque personne garde SON brouillon,
 * donc son RDV et ses propres horaires. Regrouper un congé sous l'horaire du premier
 * cliqué laissait libre la fin de journée des autres — un lundi férié posé en
 * commençant par Mathis (8 h – 12 h) bloquait les techniciens le matin seulement, et
 * l'agent téléphonique proposait leur après-midi.
 * @param {Array<{id: string, date: string, startTime: string, endTime?: string|null, technicianIds?: string[]}>} draftSlots
 * @param {{id: string, date: string, startTime: string, endTime?: string|null, duration?: number, technicianIds: string[]}} slot  journée entière d'UNE personne
 * @param {{ regrouper?: boolean }} [opts]
 * @returns {Array} nouveau tableau
 */
export function basculerJournee(draftSlots, slot, { regrouper = true } = {}) {
  const list = Array.isArray(draftSlots) ? draftSlots : [];
  const memberId = slot?.technicianIds?.[0];
  if (!memberId) return list;
  const dejaPosee = list.some((s) => s.date === slot.date && (s.technicianIds || []).includes(memberId));
  if (!dejaPosee) return regrouper ? fusionnerCreneau(list, slot) : [...list, slot];
  return list
    .map((s) => (s.date === slot.date && (s.technicianIds || []).includes(memberId)
      ? { ...s, technicianIds: s.technicianIds.filter((id) => id !== memberId) }
      : s))
    .filter((s) => (s.technicianIds || []).length > 0 || s.date !== slot.date);
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
 * RDV persistés (`majordhome_appointments` + `technician_ids` mergés par
 * `useChantierAppointments`) → jours au format attendu par `etatCommande`.
 * Sans cet adaptateur, `etatCommande` reçoit `scheduled_date` / `technician_ids`,
 * ne lit rien et annonce « Il manque N jours » même quand tout est posé
 * (GOUIN BATISTE, prod 2026-09-30).
 * @param {Array<{scheduled_date?: string|null, technician_ids?: string[]|null}>} appointments
 * @returns {Array<{date: string, technicianIds: string[]}>}
 */
export function joursDepuisRdv(appointments) {
  const list = Array.isArray(appointments) ? appointments : [];
  return list.map((apt) => ({
    date: apt?.scheduled_date,
    technicianIds: Array.isArray(apt?.technician_ids) ? apt.technician_ids : [],
  }));
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

/** Réponses qui closent un axe d'appro : reçu, ou « rien à recevoir » (prestation). */
const APPRO_CLOSE = new Set(['recu', 'na']);
/** Statuts chantier où la question des appros ne se pose plus. */
const STATUTS_TERMINES = new Set(['realise', 'facture']);

/**
 * Les deux appros (équipement, matériaux) sont-elles closes ? « N/A » est une
 * réponse qualifiée (pas de matériel à recevoir) ; une case jamais renseignée
 * (NULL) ne l'est pas — on ne sait pas, donc non.
 * @param {string|null|undefined} equipmentStatus 'na' | 'commande' | 'recu' | null
 * @param {string|null|undefined} materialsStatus
 * @returns {boolean}
 */
export function approsRecues(equipmentStatus, materialsStatus) {
  return APPRO_CLOSE.has(equipmentStatus) && APPRO_CLOSE.has(materialsStatus);
}

/**
 * Une pose posée au planning est PROVISOIRE tant que les appros du chantier ne
 * sont pas closes (règle Eric, 2026-10-01 : on programme souvent avant de
 * commander ; le planning hachure le bloc, la carte porte une puce hachurée).
 * Provisoire ne retient pas la carte : depuis le 2026-10-07, tout RDV
 * d'installation posé place le chantier en Planification.
 * Un chantier réceptionné ou facturé n'est jamais provisoire.
 * @param {{chantier_status?: string|null, equipment_order_status?: string|null, materials_order_status?: string|null}|null} chantier
 * @returns {boolean}
 */
export function poseProvisoire(chantier) {
  if (!chantier) return false;
  if (STATUTS_TERMINES.has(chantier.chantier_status)) return false;
  return !approsRecues(chantier.equipment_order_status, chantier.materials_order_status);
}
