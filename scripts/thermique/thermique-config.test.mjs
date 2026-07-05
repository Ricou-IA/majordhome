import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPES_PIECE, typePieceInfo, PLAGES_VRAISEMBLANCE, REGIMES_EAU,
  DIMENSIONS_OUVERTURES, DEFAULTS_THERMIQUE, buildThermiqueConfig }
  from '../../src/apps/thermique/lib/thermiqueConfig.js';

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
