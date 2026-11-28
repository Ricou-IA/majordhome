// scripts/aspirateur/lecture.test.mjs — lecture des caractéristiques d'une page ou d'un PDF (src/lib/aspirateur/lecture.js).
// Run : node --test scripts/aspirateur/lecture.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirePromptLecture, lireReponse, fusionnerLectures } from '../../src/lib/aspirateur/lecture.js';

const champs = [
  { key: 'etas_pct', label: 'Etas', unit: '%', type: 'number' },
  { key: 'norme_mesure', label: 'Norme', type: 'enum', options: ['EN 13240', 'EN 16510-1'] },
  { key: 'fuel_type', label: 'Combustible', type: 'enum', options: [{ value: 'bois', label: 'Bois' }, { value: 'granules', label: 'Granulés' }] },
  { key: 'flamme_verte', label: 'Flamme Verte', type: 'boolean' },
];

test('lecture tolérante : nombre à virgule, enum sans casse, enum objet par libellé, booléen oui, clé inconnue ignorée', () => {
  const r = lireReponse('Voici :\n{"valeurs":{"etas_pct":"67,5","norme_mesure":"en 16510-1","fuel_type":"Bois","flamme_verte":"oui","inconnu":3},"reference_fabricant":"C07768-06","marque":"Deville"} merci', champs);
  assert.deepEqual(r.valeurs, { etas_pct: 67.5, norme_mesure: 'EN 16510-1', fuel_type: 'bois', flamme_verte: true });
  assert.equal(r.reference_fabricant, 'C07768-06');
  assert.equal(r.marque, 'Deville');
  assert.deepEqual(r.ecartees, []);
});

test('valeurs illisibles écartées avec raison ; null ignoré', () => {
  const r = lireReponse('{"valeurs":{"etas_pct":"élevé","norme_mesure":"EN 99999","flamme_verte":"peut-être","fuel_type":null}}', champs);
  assert.deepEqual(r.valeurs, {});
  assert.deepEqual(r.ecartees, [
    { cle: 'etas_pct', raison: 'nombre attendu' },
    { cle: 'norme_mesure', raison: 'valeur hors liste' },
    { cle: 'flamme_verte', raison: 'oui ou non attendu' },
  ]);
});

test('nombre négatif ou non fini écarté', () => {
  assert.deepEqual(lireReponse('{"valeurs":{"etas_pct":-3}}', champs).ecartees, [{ cle: 'etas_pct', raison: 'nombre attendu' }]);
});

test('pas de JSON : rien de lu ; référence vide : null', () => {
  assert.deepEqual(lireReponse('pas de json', champs), { valeurs: {}, ecartees: [], reference_fabricant: null, marque: null });
  assert.equal(lireReponse('{"valeurs":{},"reference_fabricant":"  "}', champs).reference_fabricant, null);
});

test('une valeur du PDF prime sur celle de la page', () => {
  assert.deepEqual(fusionnerLectures({ etas_pct: 66, flamme_verte: true }, { etas_pct: 67 }), { etas_pct: 67, flamme_verte: true });
  assert.deepEqual(fusionnerLectures(null, { etas_pct: 67 }), { etas_pct: 67 });
});

test('prompt : texte tronqué, encadré comme donnée, champs et options listés', () => {
  const { systeme, utilisateur } = construirePromptLecture({ champs, texte: 'x'.repeat(40_000), source: 'pdf' });
  assert.ok(utilisateur.length < 32_000);
  assert.match(systeme, /aucune instruction/);
  assert.match(utilisateur, /etas_pct/);
  assert.match(utilisateur, /bois \| granules/);
  assert.doesNotMatch(utilisateur, /\[object Object\]/);
});
