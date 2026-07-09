import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPES_PIECE, typePieceInfo, PLAGES_VRAISEMBLANCE, REGIMES_EAU,
  DIMENSIONS_OUVERTURES, DEFAULTS_THERMIQUE, buildThermiqueConfig, LNC_PRESETS, defautSaisie }
  from '../../src/apps/thermique/lib/thermiqueConfig.js';
import { resolvePeriode } from '../../src/apps/thermique/lib/refDataResolvers.js';

test('TYPES_PIECE : flags cohérents avec D1/D2', () => {
  const principaux = TYPES_PIECE.filter((t) => t.principale).map((t) => t.id);
  assert.deepEqual(principaux.sort(), ['chambre', 'sejour']);
  const humides = TYPES_PIECE.filter((t) => t.humide).map((t) => t.id);
  assert.deepEqual(humides.sort(), ['buanderie', 'cuisine', 'sdb', 'wc']);
  assert.equal(typePieceInfo('garage').chauffeeParDefaut, false);
  assert.equal(typePieceInfo('sejour').chauffeeParDefaut, true);
  assert.equal(typePieceInfo('inconnu').id, 'autre'); // fallback sûr
});

test('PLAGES_VRAISEMBLANCE : une plage par période 3CL, min < max, resserrées dans le temps', () => {
  const labels = ['avant 1974', '1975-1977', '1978-1982', '1983-1988', '1989-2000',
    '2001-2005', '2006-2012', 'après 2012'];
  for (const l of labels) {
    const p = PLAGES_VRAISEMBLANCE[l];
    assert.ok(p && p.min > 0 && p.min < p.max, l);
  }
  assert.ok(PLAGES_VRAISEMBLANCE['après 2012'].max < PLAGES_VRAISEMBLANCE['avant 1974'].max);
});

test('PLAGES_VRAISEMBLANCE : chaque label de resolvePeriode a une plage (invariant cross-module)', () => {
  for (const y of [1960, 1976, 1980, 1985, 1995, 2003, 2010, 2020]) {
    assert.ok(PLAGES_VRAISEMBLANCE[resolvePeriode(y)], String(y));
  }
});

test('buildThermiqueConfig : settings.thermique malformé (string/array) → défauts propres', () => {
  assert.deepEqual(buildThermiqueConfig({ thermique: 'nope' }), buildThermiqueConfig(undefined));
  assert.deepEqual(buildThermiqueConfig({ thermique: [1, 2] }), buildThermiqueConfig(undefined));
  const c = buildThermiqueConfig({ thermique: { theta_int_defauts: 'x', delta_utb: [0.1] } });
  assert.equal(c.theta_int_defauts.sejour, 20);   // table malformée ignorée
  assert.equal(c.delta_utb.iti, 0.10);
});

test('buildThermiqueConfig : défauts purs + merge org (deep sur les tables)', () => {
  const d = buildThermiqueConfig(undefined);
  assert.equal(d.theta_int_defauts.sejour, 20);
  assert.equal(d.theta_int_defauts.sdb, 24);
  assert.equal(d.delta_utb['non-isole'], 0.15);
  assert.equal(d.f_rh, 11);
  assert.equal(d.theta_non_chauffage, 16);
  assert.ok(d.prix_kwh > 0.05);
  assert.equal(d.facteur_ajustement, 1.0);
  const c = buildThermiqueConfig({ thermique: { f_rh: 22, theta_int_defauts: { chambre: 19 } } });
  assert.equal(c.f_rh, 22);
  assert.equal(c.theta_int_defauts.chambre, 19);
  assert.equal(c.theta_int_defauts.sejour, 20);   // deep merge : les autres clés survivent
  assert.equal(DEFAULTS_THERMIQUE.f_rh, 11);      // défauts jamais mutés
  assert.deepEqual(REGIMES_EAU, [35, 45, 55]);
  assert.ok(DIMENSIONS_OUVERTURES.fenetre.largeur > 0);
});

test('buildThermiqueConfig : parois_bibliotheque défaut [] et passthrough valide, malformé → []', () => {
  assert.deepEqual(buildThermiqueConfig(undefined).parois_bibliotheque, []);
  assert.deepEqual(
    buildThermiqueConfig({ thermique: { parois_bibliotheque: [{ id: 'a' }] } }).parois_bibliotheque,
    [{ id: 'a' }],
  );
  assert.deepEqual(buildThermiqueConfig({ thermique: { parois_bibliotheque: 'oops' } }).parois_bibliotheque, []);
});

// --- Ajouts saisie paramétrique (2026-07-09) ---

test('foisonnement_emetteur défaut = 1.0', () => {
  const cfg = buildThermiqueConfig(null);
  assert.equal(cfg.foisonnement_emetteur, 1.0);
});

test('foisonnement_emetteur pris depuis settings.thermique', () => {
  const cfg = buildThermiqueConfig({ thermique: { foisonnement_emetteur: 1.2 } });
  assert.equal(cfg.foisonnement_emetteur, 1.2);
});

test('LNC_PRESETS : garage/cellier/veranda ont un b dans [0,1]', () => {
  for (const p of LNC_PRESETS) {
    assert.ok(p.b >= 0 && p.b <= 1, `${p.id} b hors [0,1]`);
    assert.ok(typeof p.label === 'string' && p.label.length > 0);
  }
});

test('defautSaisie : 1 niveau rez avec emprise vide, pièces vide', () => {
  const s = defautSaisie();
  assert.equal(s.modeSaisie, 'parametrique');
  assert.equal(s.niveaux.length, 1);
  assert.equal(s.niveaux[0].rang, 0);
  assert.deepEqual(s.niveaux[0].emprise.polygone, []);
  assert.deepEqual(s.pieces, []);
});
