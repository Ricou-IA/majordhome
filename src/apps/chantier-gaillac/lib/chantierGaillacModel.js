/**
 * chantierGaillacModel.js — modèle PUR du suivi « Chantier Gaillac » (module provisoire).
 *
 * Aucun import React / Supabase / alias : filtres, regroupements et totaux se testent ici
 * (`node --test src/apps/chantier-gaillac/lib/chantierGaillacModel.test.mjs`), jamais dans le JSX.
 *
 * Règle de durée (maquette suivi-gaillac.html) : somme des `duree_min` + 20 min par passage
 * sur un site (couple site × code de planning) — trajet, accès et rangement. Dans un groupe
 * « Planning », un passage = un site distinct ; dans un groupe « Site » ou « Thème », un même
 * site visité sur deux codes compte deux accès.
 */

export const ACCESS_MIN = 20;
export const HORS_PERIMETRE = 'hors_perimetre';
export const HORS_PERIMETRE_KEY = '__hors_perimetre__';
export const HORS_PERIMETRE_LABEL = 'Hors périmètre Mayer Énergie';
export const GROUP_MODES = ['planning', 'site', 'theme'];

const THEME_ORDER = [
  'Signalétique', 'Peinture gaz RAL 1023', 'Antirouille', 'Contrôles chauffage', 'Plomberie / ECS',
  'Clim / ventilation', 'Électricité', 'Divers', 'Relevé pour commande', 'Hors périmètre',
];

/** @param {{ type_ligne: string }} t */
export const isHorsPerimetre = (t) => t.type_ligne === HORS_PERIMETRE;
/** @param {{ type_ligne: string }} t */
export const isReleve = (t) => t.type_ligne === 'releve';
/** @param {{ observations?: string|null }} t */
export const isSecurite = (t) => /^sécurité/i.test((t.observations || '').trim());

/**
 * Durée lisible : 0/null → « – », 45 → « 45 min », 430 → « 7 h 10 », 120 → « 2 h ».
 * @param {number|null|undefined} min
 * @returns {string}
 */
export function formatDuree(min) {
  if (!min) return '–';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/**
 * Durée totale d'un ensemble de tâches, accès compris (hors périmètre ignoré).
 * @param {Array<{ type_ligne: string, duree_min: number|null, site: string, planning_code: string|null }>} taches
 * @returns {number} minutes
 */
export function totalMinutes(taches) {
  const passages = new Set();
  let total = 0;
  for (const t of taches) {
    if (isHorsPerimetre(t)) continue;
    total += t.duree_min || 0;
    passages.add(`${t.site}|${t.planning_code || ''}`);
  }
  return total + passages.size * ACCESS_MIN;
}

/**
 * Index des codes de planning.
 * @param {Array<{ code: string }>} planning
 * @returns {Map<string, object>}
 */
export function indexPlanning(planning) {
  return new Map((planning || []).map((p) => [p.code, p]));
}

/**
 * Filtre la liste.
 * @param {Array<object>} taches
 * @param {{ techId?: string, planningCode?: string, hideDone?: boolean, q?: string }} f
 *   même forme que l'état de filtres de la page (passé tel quel)
 * @returns {Array<object>}
 */
export function filterTaches(taches, f = {}) {
  const q = (f.q || '').trim().toLowerCase();
  // Un n° exact (« R1 ») l'emporte sur la recherche texte (« (R13) » dans une observation)
  const numeroExact = q && taches.some((t) => String(t.numero).toLowerCase() === q);
  return taches.filter((t) => {
    if (f.techId && t.technicien_id !== f.techId) return false;
    if (f.planningCode) {
      if (f.planningCode === HORS_PERIMETRE_KEY) {
        if (!isHorsPerimetre(t)) return false;
      } else if (t.planning_code !== f.planningCode) return false;
    }
    if (f.hideDone && t.fait) return false;
    if (numeroExact) return String(t.numero).toLowerCase() === q;
    if (q) {
      const hay = `${t.site} ${t.adresse || ''} ${t.action} ${t.observations || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Tri dans un groupe : code de planning, puis site (ordre Veolia de sa 1ʳᵉ tâche),
 * puis actions avant relevés, puis ordre.
 */
function sortInGroup(rows, planningIndex) {
  const siteRank = new Map();
  for (const t of rows) {
    const r = siteRank.get(t.site);
    if (r === undefined || t.ordre < r) siteRank.set(t.site, t.ordre);
  }
  const pOrdre = (t) => planningIndex.get(t.planning_code)?.ordre ?? 9999;
  return [...rows].sort((a, b) =>
    pOrdre(a) - pOrdre(b)
    || siteRank.get(a.site) - siteRank.get(b.site)
    || Number(isReleve(a)) - Number(isReleve(b))
    || a.ordre - b.ordre);
}

/**
 * Regroupe les tâches.
 * @param {Array<object>} taches  tâches déjà filtrées
 * @param {'planning'|'site'|'theme'} mode
 * @param {Array<object>} planning
 * @returns {Array<{ key: string, label: string, planning: object|null, isHorsPerimetre: boolean,
 *   rows: Array<object>, count: number, done: number, totalMin: number }>}
 */
export function groupTaches(taches, mode, planning) {
  const pIndex = indexPlanning(planning);
  const groups = new Map();
  const keyOf = (t) => {
    if (mode === 'site') return t.site;
    if (mode === 'theme') return t.theme || 'Autre';
    return isHorsPerimetre(t) ? HORS_PERIMETRE_KEY : (t.planning_code || 'Non planifié');
  };
  for (const t of taches) {
    const k = keyOf(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }

  const out = [...groups.entries()].map(([key, rows]) => {
    const hp = key === HORS_PERIMETRE_KEY;
    const p = mode === 'planning' ? pIndex.get(key) || null : null;
    let label = key;
    if (hp) label = HORS_PERIMETRE_LABEL;
    else if (p) label = p.libelle;
    else if (mode === 'site') {
      const f = rows[0];
      label = [f.site, f.adresse, f.zone].filter(Boolean).join(' · ');
    }
    return {
      key,
      label,
      planning: p,
      isHorsPerimetre: hp,
      rows: sortInGroup(rows, pIndex),
      count: rows.length,
      done: rows.filter((t) => t.fait).length,
      totalMin: totalMinutes(rows),
    };
  });

  const rank = (g) => {
    if (g.isHorsPerimetre) return 1e6;
    if (mode === 'planning') return g.planning?.ordre ?? 9e5;
    if (mode === 'theme') {
      const i = THEME_ORDER.indexOf(g.key);
      return i === -1 ? 900 : i;
    }
    return 0;
  };
  return out.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'fr'));
}

/**
 * Options du sélecteur « Journée / code », limitées au technicien choisi.
 * @returns {Array<{ code: string, label: string, totalMin: number, date: string|null }>}
 */
export function planningOptions(planning, taches, technicienId) {
  const opts = [...(planning || [])]
    .sort((a, b) => a.ordre - b.ordre)
    .filter((p) => !technicienId || taches.some((t) => t.planning_code === p.code && t.technicien_id === technicienId))
    .map((p) => ({
      code: p.code,
      label: p.libelle,
      date: p.date_prevue || null,
      totalMin: totalMinutes(taches.filter((t) => t.planning_code === p.code)),
    }));
  if (!technicienId && taches.some(isHorsPerimetre)) {
    opts.push({ code: HORS_PERIMETRE_KEY, label: HORS_PERIMETRE_LABEL, date: null, totalMin: 0 });
  }
  return opts;
}

/**
 * Prochaine journée datée du technicien qui a encore une tâche à faire (date ≥ aujourd'hui en priorité,
 * sinon la plus ancienne journée datée restée inachevée). '' si aucune.
 * @param {string} today  YYYY-MM-DD
 * @returns {string}
 */
export function defaultPlanningCode(planning, taches, technicienId, today) {
  const candidates = (planning || [])
    .filter((p) => p.date_prevue && taches.some((t) => t.planning_code === p.code
      && t.technicien_id === technicienId && !t.fait && !isHorsPerimetre(t)))
    .sort((a, b) => a.date_prevue.localeCompare(b.date_prevue));
  const late = candidates.filter((p) => p.date_prevue < today);
  const next = candidates.find((p) => p.date_prevue >= today);
  return (late[0] || next)?.code || '';
}

/**
 * Synthèse d'un technicien : temps programmé (codes datés), temps restant à programmer,
 * tâches validées / total (hors périmètre exclu).
 */
export function techSummary(taches, planning, technicienId) {
  const pIndex = indexPlanning(planning);
  const mine = taches.filter((t) => t.technicien_id === technicienId && !isHorsPerimetre(t));
  const dated = mine.filter((t) => pIndex.get(t.planning_code)?.date_prevue);
  const undated = mine.filter((t) => !pIndex.get(t.planning_code)?.date_prevue);
  const dates = [...new Set(dated.map((t) => pIndex.get(t.planning_code).date_prevue))].sort();
  const done = mine.filter((t) => t.fait).length;
  return {
    programmeMin: totalMinutes(dated),
    restantMin: totalMinutes(undated),
    dates,
    done,
    total: mine.length,
    pct: mine.length ? Math.round((done * 100) / mine.length) : 0,
  };
}

/**
 * Découpe un texte en segments, en isolant les références à d'autres tâches entre parenthèses :
 * « (36 à 39) », « (40) », « (5, 6) », « (77, 79, 80, 80b) », « (R3) ».
 * Une parenthèse n'est une référence que si CHAQUE élément est un n° existant ou une plage
 * « a à b » : « (5 RDC, 6 R+1) », « (maxi 35 kg) », « (RAL 1023) » restent du texte.
 * @param {string|null} text
 * @param {string[]} numeros  n° existants, dans l'ordre de la liste Veolia
 * @returns {Array<{ type: 'text', value: string } | { type: 'ref', value: string, numeros: string[] }>}
 */
export function splitReferences(text, numeros) {
  if (!text) return [];
  const known = new Set(numeros.map((n) => String(n).toLowerCase()));
  const segments = [];
  let last = 0;
  for (const m of text.matchAll(/\(([^()]+)\)/g)) {
    const refs = [];
    const ok = m[1].split(',').map((s) => s.trim()).every((item) => {
      const range = item.match(/^(\d+)\s*à\s*(\d+)$/);
      if (range) {
        const [lo, hi] = [Number(range[1]), Number(range[2])];
        const inRange = numeros.filter((n) => {
          const v = parseInt(n, 10);
          return /^\d/.test(n) && v >= lo && v <= hi;
        });
        refs.push(...inRange);
        return inRange.length > 0;
      }
      if (known.has(item.toLowerCase())) {
        refs.push(numeros.find((n) => String(n).toLowerCase() === item.toLowerCase()));
        return true;
      }
      return false;
    });
    if (!ok || !refs.length) continue;
    if (m.index > last) segments.push({ type: 'text', value: text.slice(last, m.index) });
    segments.push({ type: 'ref', value: m[0], numeros: [...new Set(refs)] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) });
  return segments;
}

/** « 2026-10-21 » → « 21/10 ». */
export function formatDateCourte(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

/** Lien Google Maps d'une adresse à Gaillac. */
export function mapsUrl(t) {
  const q = [t.adresse, '81600 Gaillac'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${t.site}, ${q}`)}`;
}
