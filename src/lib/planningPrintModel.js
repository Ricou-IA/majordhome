/**
 * planningPrintModel.js — Modèle du planning hebdomadaire imprimable (1 personne).
 * ============================================================================
 * Module PUR (aucun import React/Supabase/alias) : met en forme les RDV d'une
 * semaine pour le PDF `PlanningWeekPDF`. Ne calcule rien de métier — il trie,
 * filtre et formate. Testé via `node --test scripts/planning-print-model.test.mjs`.
 *
 * Règles :
 *   - Lundi → vendredi toujours présents (jour vide = « Aucun rendez-vous ») ;
 *     samedi / dimanche seulement s'ils portent un RDV.
 *   - RDV annulés exclus (un sous-traitant n'a rien à en faire sur papier).
 *   - Doublons par id dédupliqués (le calendrier éclate un RDV multi-tech en
 *     1 bloc par technicien, cf. `expandAppointmentBlocks`).
 *   - Objet auto « Type — Client » (généré par EventModal) masqué : redondant
 *     avec la ligne 1 de la carte. Un objet libre est conservé.
 * ============================================================================
 */

// Même override que le calendrier (planningEvents.INVOICED_EVENT_COLOR) —
// recopié pour garder ce module sans import.
const INVOICED_COLOR = '#6D28D9';
const FALLBACK_COLOR = '#94A3B8';

const DAY_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const LONG_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** 'YYYY-MM-DD' → Date locale (pas de dérive UTC). */
function parseISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toISODate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Numéro de semaine ISO 8601 (lundi = 1er jour ; semaine 1 = celle du 1er jeudi). */
export function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/** « 7 au 11 septembre 2026 » / « 28 septembre au 2 octobre 2026 ». */
export function formatWeekRange(startISO, endISO) {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  const endLabel = LONG_FMT.format(end);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()} au ${endLabel}`;
  }
  const startLabel = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(start);
  return `${startLabel} au ${endLabel}`;
}

/** `planning-<slug>-S<n>-<lundi>.pdf` — nom de fichier portable Windows/macOS. */
export function buildPlanningFilename(personName, weekNumber, weekStartISO) {
  const slug = String(personName || 'planning')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'planning';
  return `planning-${slug}-S${weekNumber}-${weekStartISO}.pdf`;
}

/** '08:30:00' → '8:30'. */
function formatTime(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':');
  return `${Number(h)}:${m}`;
}

/** 10 chiffres FR → « 06 12 34 56 78 » ; sinon la valeur brute. */
function formatPhone(p) {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, '');
  if (digits.length === 10) return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
  return String(p);
}

function formatAddress(a) {
  const line2 = [a.postal_code, a.city].filter(Boolean).join(' ');
  return [a.address, line2].filter(Boolean).join(', ') || null;
}

function formatItem(a, { typeLabels, equipmentLabelsByClient, personColor }) {
  const typeLabel = typeLabels?.[a.appointment_type] || a.appointment_type || '';
  const clientName = [a.client_name, a.client_first_name].filter(Boolean).join(' ') || null;
  const start = formatTime(a.scheduled_start);
  const end = formatTime(a.scheduled_end);
  const subjectRaw = (a.subject || '').trim();
  // Objet auto d'EventModal = « Type — Client » ou juste « Type » → masqué.
  const looksAuto = !subjectRaw || subjectRaw === typeLabel || subjectRaw.startsWith(`${typeLabel} —`) || subjectRaw.startsWith(`${typeLabel}—`);
  return {
    id: a.id,
    time: end ? `${start} – ${end}` : start,
    typeLabel,
    clientName,
    sector: a.grand_secteur || null,
    address: formatAddress(a),
    phone: formatPhone(a.client_phone),
    equipments: (a.client_id && equipmentLabelsByClient?.get(a.client_id)) || [],
    subject: looksAuto ? null : subjectRaw,
    description: (a.description || '').trim() || null,
    color: a.target_invoiced === true ? INVOICED_COLOR : (personColor || FALLBACK_COLOR),
  };
}

/**
 * @param {Object} p
 * @param {Array}  p.appointments  lignes RDV brutes (déjà filtrées sur la personne)
 * @param {Object} p.person        { displayName, color }
 * @param {string} p.weekStart     lundi 'YYYY-MM-DD'
 * @param {Object} p.typeLabels    { appointment_type: label }
 * @param {Map}    p.equipmentLabelsByClient  client_id → string[]
 * @param {Date}   [p.now]         date d'édition (injectée : testable)
 */
export function buildWeeklyPlanningModel({
  appointments = [], person, weekStart, typeLabels = {}, equipmentLabelsByClient = new Map(), now = new Date(),
} = {}) {
  const monday = parseISODate(weekStart);
  const dayKeys = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dayKeys.push(toISODate(d));
  }

  const seen = new Set();
  const byDay = new Map(dayKeys.map((k) => [k, []]));
  for (const a of appointments) {
    if (!a || seen.has(a.id) || a.status === 'cancelled') continue;
    if (!byDay.has(a.scheduled_date)) continue; // hors semaine
    seen.add(a.id);
    byDay.get(a.scheduled_date).push(a);
  }

  const ctx = { typeLabels, equipmentLabelsByClient, personColor: person?.color };
  const days = dayKeys
    .map((key, idx) => {
      const items = byDay.get(key)
        .sort((x, y) => String(x.scheduled_start).localeCompare(String(y.scheduled_start)))
        .map((a) => formatItem(a, ctx));
      return { dateISO: key, label: capitalize(DAY_FMT.format(parseISODate(key))), items, isWeekend: idx >= 5 };
    })
    .filter((d) => !d.isWeekend || d.items.length > 0);

  const weekNumber = isoWeekNumber(monday);
  const editedTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  return {
    personName: person?.displayName || 'Planning',
    weekNumber,
    weekLabel: formatWeekRange(dayKeys[0], dayKeys[4]),
    editedLabel: `Édité le ${LONG_FMT.format(now)} à ${editedTime}`,
    days,
    totalCount: days.reduce((n, d) => n + d.items.length, 0),
    filename: buildPlanningFilename(person?.displayName, weekNumber, dayKeys[0]),
  };
}
