// node --test src/apps/chantier-gaillac/lib/chantierGaillacModel.test.mjs
// Le jeu de données est relu depuis la migration : les totaux contrôlés sont ceux de la prod.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  totalMinutes, formatDuree, filterTaches, groupTaches, planningOptions,
  defaultPlanningCode, techSummary, isSecurite, HORS_PERIMETRE_KEY,
} from './chantierGaillacModel.js';

const SQL = readFileSync(new URL('../../../../supabase/migrations/20261017_1_chantier_gaillac.sql', import.meta.url), 'utf8');
const A = '15a68690-1ac5-409e-8c00-c7ba19b40ff3';
const L = '87ba1ecb-0913-4cc0-8755-62c43c153693';

/** Découpe un tuple SQL `('a', 1, NULL, true, 'l''x')` en valeurs JS. */
function parseTuple(line) {
  const s = line.trim().replace(/^\(/, '').replace(/\),?$/, '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === ',') i += 1;
    if (s[i] === "'") {
      let v = '';
      i += 1;
      while (i < s.length) {
        if (s[i] === "'" && s[i + 1] === "'") { v += "'"; i += 2; } else if (s[i] === "'") { i += 1; break; } else { v += s[i]; i += 1; }
      }
      out.push(v);
    } else {
      let j = i;
      while (j < s.length && s[j] !== ',') j += 1;
      const raw = s.slice(i, j).trim();
      i = j;
      if (raw === 'NULL') out.push(null);
      else if (raw === 'true' || raw === 'false') out.push(raw === 'true');
      else if (/^date '/.test(raw)) out.push(raw.slice(6, -1));
      else out.push(Number(raw));
    }
  }
  return out;
}

const blocks = SQL.split('FROM (VALUES');
const tech = (c) => (c === 'A' ? A : c === 'L' ? L : null);
const PLANNING = blocks[1].split('\n').filter((l) => /^\s*\('/.test(l)).map(parseTuple)
  .map(([code, ordre, libelle, t, date]) => ({ code, ordre, libelle, technicien_id: tech(t), date_prevue: date }));
const TACHES = blocks[2].split('\n').filter((l) => /^\s*\('/.test(l)).map(parseTuple)
  .map(([numero, ordre, site, adresse, zone, action, theme, type_ligne, t, duree_min, achat_requis, planning_code, observations]) => ({
    numero, ordre, site, adresse, zone, action, theme, type_ligne, technicien_id: tech(t), duree_min,
    achat_requis, planning_code, observations, fait: false,
  }));

const totalCode = (code) => totalMinutes(TACHES.filter((t) => t.planning_code === code));

test('jeu de données relu : 98 tâches, 21 codes', () => {
  assert.equal(TACHES.length, 98);
  assert.equal(PLANNING.length, 21);
  assert.ok(TACHES.every((t) => t.type_ligne === 'hors_perimetre' || t.technicien_id));
});

test('totaux de la maquette (accès compris)', () => {
  assert.equal(formatDuree(totalCode('MER21')), '7 h 10');
  assert.equal(formatDuree(totalCode('JEU22')), '7 h 10');
  assert.equal(formatDuree(totalCode('VEN23')), '3 h 35');
  assert.equal(formatDuree(totalCode('L5')), '3 h 55');
  assert.equal(formatDuree(totalCode('A10')), '2 h 50');
});

test('aucun code de planning ne dépasse 4 h hors journées datées', () => {
  for (const p of PLANNING.filter((x) => !x.date_prevue)) {
    assert.ok(totalCode(p.code) <= 240, `${p.code} : ${formatDuree(totalCode(p.code))}`);
  }
});

test('formatDuree', () => {
  assert.equal(formatDuree(0), '–');
  assert.equal(formatDuree(45), '45 min');
  assert.equal(formatDuree(120), '2 h');
  assert.equal(formatDuree(65), '1 h 05');
});

test('groupe planning : relevés juste après les actions du même site', () => {
  const g = groupTaches(TACHES, 'planning', PLANNING).find((x) => x.key === 'MER21');
  const nums = g.rows.map((t) => t.numero);
  // Hôtel de Ville : actions 41, 42 puis relevés R1, R2
  assert.deepEqual(nums.slice(0, 4), ['41', '42', 'R1', 'R2']);
  for (let i = 1; i < g.rows.length; i += 1) {
    const prev = g.rows[i - 1];
    const cur = g.rows[i];
    if (prev.site === cur.site) assert.ok(!(prev.type_ligne === 'releve' && cur.type_ligne === 'action'), `${prev.numero} → ${cur.numero}`);
  }
});

test('groupes planning ordonnés, hors périmètre en dernier sans durée', () => {
  const groups = groupTaches(TACHES, 'planning', PLANNING);
  assert.deepEqual(groups.slice(0, 3).map((g) => g.key), ['MER21', 'JEU22', 'VEN23']);
  const last = groups[groups.length - 1];
  assert.equal(last.key, HORS_PERIMETRE_KEY);
  assert.equal(last.count, 3);
  assert.equal(last.totalMin, 0);
});

test('groupe site : un site visité sur deux codes compte deux accès', () => {
  const g = groupTaches(TACHES, 'site', PLANNING).find((x) => x.key === 'Hôtel de Ville');
  const brut = g.rows.reduce((s, t) => s + t.duree_min, 0);
  const codes = new Set(g.rows.map((t) => t.planning_code)).size; // MER21, A2, A3
  assert.equal(g.totalMin, brut + codes * 20);
});

test('filtres : technicien, code, recherche n° exact et texte, masquer validées', () => {
  assert.ok(filterTaches(TACHES, { technicienId: A }).every((t) => t.technicien_id === A));
  assert.equal(filterTaches(TACHES, { q: '31b' }).length, 1);
  assert.equal(filterTaches(TACHES, { q: 'R1' }).length, 1); // n° exact, pas R10..R13
  assert.ok(filterTaches(TACHES, { q: 'wago' }).some((t) => t.numero === '41'));
  assert.equal(filterTaches(TACHES, { planningCode: HORS_PERIMETRE_KEY }).length, 3);
  const fait = TACHES.map((t) => (t.numero === '41' ? { ...t, fait: true } : t));
  assert.ok(!filterTaches(fait, { hideDone: true }).some((t) => t.numero === '41'));
});

test('options de code limitées au technicien', () => {
  const opts = planningOptions(PLANNING, TACHES, L).map((o) => o.code);
  assert.ok(opts.includes('JEU22') && opts.includes('L1'));
  assert.ok(!opts.includes('MER21') && !opts.includes('A1'));
  // L5 contient-il une tâche d'Antoine ? Non ; A11 contient des sites Nord-Est mais reste à Antoine
  assert.ok(!opts.includes('A11'));
});

test('journée par défaut du technicien', () => {
  assert.equal(defaultPlanningCode(PLANNING, TACHES, A, '2026-10-17'), 'MER21');
  assert.equal(defaultPlanningCode(PLANNING, TACHES, L, '2026-10-17'), 'JEU22');
  // JEU22 terminé → VEN23
  const jeuFait = TACHES.map((t) => (t.planning_code === 'JEU22' ? { ...t, fait: true } : t));
  assert.equal(defaultPlanningCode(PLANNING, jeuFait, L, '2026-10-22'), 'VEN23');
  // VEN23 passé et inachevé : on y reste
  assert.equal(defaultPlanningCode(PLANNING, jeuFait, L, '2026-10-26'), 'VEN23');
});

test('synthèse technicien', () => {
  const s = techSummary(TACHES, PLANNING, A);
  assert.equal(s.programmeMin, totalCode('MER21'));
  assert.deepEqual(s.dates, ['2026-10-21']);
  assert.equal(s.done, 0);
  assert.ok(s.total > 0 && s.restantMin > 0);
});

test('badge sécurité sur 23 et 41 uniquement', () => {
  assert.deepEqual(TACHES.filter(isSecurite).map((t) => t.numero).sort(), ['23', '41']);
});
