// scripts/fumisterie/releve.test.mjs — validation du relevé contre les paramètres du gabarit G1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validerReleve, calculerMetre } from '../../src/lib/fumisterie/index.js';
import { buildFumisterieConfig } from '../../src/lib/fumisterie/config.js';
import { ARTICLES, COMPOSANTS, MAPPING, GABARIT, CONFIGURATION, RELEVE } from './fixtures/g1-o150.mjs';

const base = { configuration: CONFIGURATION, gabarit: GABARIT, composants: COMPOSANTS, mapping: MAPPING, articles: ARTICLES, reglages: buildFumisterieConfig(null) };

test('relevé de la maquette : valide', () => {
  assert.deepEqual(validerReleve(GABARIT, RELEVE), { ok: true, erreurs: [] });
});
test('pente vidée → erreur nommée, et calculerMetre refuse de calculer (pas de 0 silencieux)', () => {
  const v = validerReleve(GABARIT, { ...RELEVE, pente: '' });
  assert.equal(v.ok, false);
  assert.equal(v.erreurs.length, 1);
  assert.match(v.erreurs[0], /Pente de toiture \(non renseigné\)/);
  assert.throws(() => calculerMetre({ ...base, releve: { ...RELEVE, pente: '' } }), /Relevé incomplet : Pente de toiture/);
});
test('pente 12° : valide (dans 0–60)', () => {
  assert.equal(validerReleve(GABARIT, { ...RELEVE, pente: 12 }).ok, true);
});
test('hors plage et choix invalide', () => {
  const v = validerReleve(GABARIT, { ...RELEVE, hBuse: 0.1, diametre: 155, finition: 'rouge' });
  assert.equal(v.erreurs.length, 3);
  assert.ok(v.erreurs.some((e) => /Hauteur de buse \(0,1 m hors plage 0,3–2 m\)/.test(e)));
  assert.ok(v.erreurs.some((e) => /Diamètre conduit/.test(e)));
  assert.ok(v.erreurs.some((e) => /Finition extérieure/.test(e)));
});
test('paramètres conditionnels : hsp2 masqué sans étage, decal masqué sans dévoiement → non exigés', () => {
  assert.equal(validerReleve(GABARIT, { ...RELEVE, nbEtages: 0, hsp2: '' }).ok, true);
  assert.equal(validerReleve(GABARIT, { ...RELEVE, angle: 0, decal: null }).ok, true);
  assert.equal(validerReleve(GABARIT, { ...RELEVE, nbEtages: 1, hsp2: '' }).ok, false);
});
test('gabarit absent → invalide (jamais de calcul sans paramètres à contrôler)', () => {
  assert.equal(validerReleve(null, RELEVE).ok, false);
});
