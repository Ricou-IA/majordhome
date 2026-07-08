/**
 * planningEvents.js — Helpers PURS du calendrier planning.
 * AUCUN import React/Supabase (node-testable via scripts/planning-events.test.mjs).
 *
 * - Buckets de type (commercial / intervention / autre)
 * - Unification d'identité humaine par profile_key (= team_members.user_id =
 *   commercials.profile_id) pour dédoublonner les personnes présentes dans les
 *   deux tables (Philippe, Michel).
 * - Résolution de la couleur d'un RDV par personne, override violet si facturé.
 * - Prédicats de filtre (bucket + équipe).
 */

export const COMMERCIAL_TYPES = ['rdv_agency', 'rdv_technical', 'rdv_closing'];
export const TECHNICIAN_TYPES = ['installation', 'maintenance', 'service'];

// Violet foncé — RDV facturé (override). Réservé : aucune personne ne doit l'avoir.
export const INVOICED_EVENT_COLOR = '#6D28D9';
// Slate — personne sans couleur définie ou RDV sans assignation.
export const FALLBACK_PERSON_COLOR = '#94A3B8';

/** Bucket d'un RDV selon son type. 'other' = ni commercial ni intervention. */
export function appointmentKind(appointmentType) {
  if (COMMERCIAL_TYPES.includes(appointmentType)) return 'commercial';
  if (TECHNICIAN_TYPES.includes(appointmentType)) return 'intervention';
  return 'other';
}

/**
 * Maps de résolution couleur.
 * @param {Object} p
 * @param {Array}  p.members     team_members [{ id, user_id, calendar_color }]
 * @param {Array}  p.commercials [{ id, profile_id }]
 */
export function buildPersonColorMaps({ members = [], commercials = [] } = {}) {
  const colorByProfile = new Map();  // profile_key -> color
  const techProfileById = new Map(); // team_member.id -> profile_key
  const comProfileById = new Map();  // commercial.id -> profile_key
  for (const m of members) {
    if (!m?.user_id) continue;
    techProfileById.set(m.id, m.user_id);
    if (m.calendar_color) colorByProfile.set(m.user_id, m.calendar_color);
  }
  for (const c of commercials) {
    if (!c?.profile_id) continue;
    comProfileById.set(c.id, c.profile_id);
  }
  return { colorByProfile, techProfileById, comProfileById };
}

/**
 * Couleur d'un RDV : couleur du propriétaire, override violet si facturé.
 * @param {Object} appt { appointment_type, technician_ids[], assigned_commercial_id, target_invoiced }
 * @param {Object} maps issu de buildPersonColorMaps
 */
export function resolveAppointmentColor(appt, maps) {
  if (appt?.target_invoiced === true) return INVOICED_EVENT_COLOR;
  const { colorByProfile, techProfileById, comProfileById } = maps;
  const techId = appt?.technician_ids?.[0];
  const techProfile = techId ? techProfileById.get(techId) : null;
  const comProfile = appt?.assigned_commercial_id ? comProfileById.get(appt.assigned_commercial_id) : null;
  // VT/agence : on préfère le commercial ; sinon (intervention/autre) le technicien.
  const preferCom = COMMERCIAL_TYPES.includes(appt?.appointment_type);
  const profile = preferCom ? (comProfile || techProfile) : (techProfile || comProfile);
  return (profile && colorByProfile.get(profile)) || FALLBACK_PERSON_COLOR;
}

/**
 * Décompose un RDV en blocs à rendre sur le calendrier (1 entrée = 1 bloc coloré).
 * - Facturé → 1 bloc violet (la couleur ne distingue pas les personnes).
 * - Intervention/Autre à ≥2 techniciens → 1 bloc PAR technicien (chacun sa couleur),
 *   restreint aux techniciens visibles si un filtre équipe est actif. C'est ce qui
 *   rend un RDV partagé (ex. Antoine + Ludovic) lisible côte à côte, comme 2 RDV séparés.
 * - Sinon (0-1 technicien, ou RDV commercial) → 1 bloc unique (couleur du propriétaire).
 * `idSuffix` rend l'event FullCalendar unique par bloc ; l'id réel du RDV reste dans
 * extendedProps (cf. toCalendarEvent) pour le drag/resize/clic.
 * @returns {Array<{ color: string, idSuffix: (string|null) }>}
 */
export function expandAppointmentBlocks(appt, maps, selectedRecordIds) {
  if (appt?.target_invoiced === true) {
    return [{ color: INVOICED_EVENT_COLOR, idSuffix: null }];
  }
  const techIds = appt?.technician_ids || [];
  const isCommercial = COMMERCIAL_TYPES.includes(appt?.appointment_type);
  if (!isCommercial && techIds.length >= 2) {
    const hasFilter = selectedRecordIds && selectedRecordIds.size > 0;
    const visible = hasFilter ? techIds.filter((id) => selectedRecordIds.has(id)) : techIds;
    const shown = visible.length ? visible : techIds;
    return shown.map((techId) => ({
      color: maps.colorByProfile.get(maps.techProfileById.get(techId)) || FALLBACK_PERSON_COLOR,
      idSuffix: techId,
    }));
  }
  return [{ color: resolveAppointmentColor(appt, maps), idSuffix: null }];
}

/**
 * Liste équipe unifiée par humain (profile_key) : dédoublonne les personnes
 * présentes en tech ET commercial. recordIds = ids à matcher sur les RDV.
 * Couleur = celle du team_member (source unique) ; fallback sinon.
 */
export function buildTeamList({ members = [], commercials = [] } = {}) {
  const byProfile = new Map();
  const ensure = (key, name) => {
    if (!byProfile.has(key)) {
      byProfile.set(key, {
        profileKey: key, displayName: name || 'Membre', color: FALLBACK_PERSON_COLOR,
        recordIds: [], isTech: false, isCommercial: false,
      });
    }
    return byProfile.get(key);
  };
  for (const m of members) {
    if (!m?.user_id) continue;
    const h = ensure(m.user_id, m.display_name);
    h.recordIds.push(m.id);
    h.isTech = true;
    if (m.calendar_color) h.color = m.calendar_color;
    if (m.display_name) h.displayName = m.display_name;
  }
  for (const c of commercials) {
    if (!c?.profile_id) continue;
    const h = ensure(c.profile_id, c.full_name);
    h.recordIds.push(c.id);
    h.isCommercial = true;
  }
  return Array.from(byProfile.values())
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
}

/** RDV visible selon les toggles de bucket. 'other' toujours visible. */
export function matchesKindFilter(appt, kinds) {
  const k = appointmentKind(appt?.appointment_type);
  if (k === 'other') return true;
  if (k === 'commercial') return !!kinds?.commercial;
  return !!kinds?.intervention;
}

/** RDV visible selon les humains sélectionnés (Set de recordIds). null/vide = tout. */
export function matchesMemberFilter(appt, selectedRecordIds) {
  if (!selectedRecordIds || selectedRecordIds.size === 0) return true;
  if (appt?.assigned_commercial_id && selectedRecordIds.has(appt.assigned_commercial_id)) return true;
  return (appt?.technician_ids || []).some((id) => selectedRecordIds.has(id));
}
