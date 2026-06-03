/**
 * scheduleConflicts.js — helpers purs pour la dispo & les conflits du picker.
 * Pas d'I/O. Heures au format "HH:MM". Un "busy" = { start, end } sur un même jour.
 */

/** "HH:MM" -> minutes depuis minuit. */
export function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Deux plages [aStart,aEnd) [bStart,bEnd) (minutes) se chevauchent-elles ? */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Un membre (par son id) est-il impliqué dans un RDV, soit comme technicien
 * (via la jointure `technician_ids`), soit comme commercial assigné
 * (`assigned_commercial_id`) ? Prédicat unifié tech-OU-commercial : permet de
 * marquer une colonne occupée/en-conflit quel que soit le rôle du membre.
 * (Pour un technicien, `assigned_commercial_id` ne matchera jamais son id → reste correct.)
 */
export function appointmentInvolvesMember(apt, memberId) {
  if (!apt || !memberId) return false;
  return (apt.technician_ids || []).includes(memberId) || apt.assigned_commercial_id === memberId;
}

/**
 * Un créneau {date, startTime, endTime} entre-t-il en conflit avec les RDV
 * d'un MEMBRE donné (technicien OU commercial assigné) ? `dayAppointments` =
 * appointments du jour. Retourne la liste des RDV en conflit (vide = libre).
 */
export function findMemberConflicts({ date, startTime, endTime }, memberId, dayAppointments) {
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  if (s == null || e == null) return [];
  return (dayAppointments || []).filter((apt) => {
    if (apt.scheduled_date !== date) return false;
    if (apt.status === 'cancelled' || apt.status === 'no_show') return false;
    if (!appointmentInvolvesMember(apt, memberId)) return false;
    const as = timeToMinutes(apt.scheduled_start);
    const ae = timeToMinutes(apt.scheduled_end) ?? (as + (apt.duration_minutes || 60));
    if (as == null) return false;
    return rangesOverlap(s, e, as, ae);
  });
}

/**
 * Conflits d'un créneau pour un technicien donné.
 * Alias de `findMemberConflicts` (le prédicat unifié reste correct pour un tech :
 * `assigned_commercial_id` ne matchera jamais un id de technicien).
 */
export function findTechnicianConflicts(slot, technicianId, dayAppointments) {
  return findMemberConflicts(slot, technicianId, dayAppointments);
}

/** Plage de travail "active" d'un membre pour un jour JS (0=dim..6=sam) depuis default_availability. */
export function memberWorkingHoursForDate(member, dateStr) {
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const jsDay = new Date(dateStr + 'T00:00:00').getDay();
  const cfg = member?.default_availability?.[days[jsDay]];
  if (!cfg || cfg.active === false) return null; // jour off
  return { start: cfg.start || '08:00', end: cfg.end || '18:00' };
}
