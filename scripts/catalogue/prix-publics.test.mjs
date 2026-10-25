// scripts/catalogue/prix-publics.test.mjs
// Prix publics TEREVA relevés sur tereva.fr le 2026-10-25 (scripts/catalogue/data/prix-publics/tereva-2026-10-25.json).
// Run : node --test scripts/catalogue/prix-publics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prixAffiche, prixPublicsDuReleve } from './prix-publics.js';

const releve = JSON.parse(readFileSync(new URL('./data/prix-publics/tereva-2026-10-25.json', import.meta.url), 'utf8'));

test('prixAffiche : formats du site', () => {
  assert.equal(prixAffiche('4107,46'), 4107.46);
  assert.equal(prixAffiche('6 601,32'), 6601.32);
  assert.equal(prixAffiche(''), null);
  assert.equal(prixAffiche('0,00'), null);
});

test('relevé TEREVA du 2026-10-25 : 91 prix, 7 écartés et rapportés', () => {
  const { prix, ecartes } = prixPublicsDuReleve(releve);
  assert.equal(releve.articles.length, 98);
  assert.equal(prix.length, 91);
  assert.equal(ecartes.length, 7);
  assert.ok(ecartes.some((e) => e.startsWith('1250006 : produit_different')));
  for (const code of ['4039288', '4150006', '3740000', '3988926', '5647697', '9314133']) assert.ok(ecartes.some((e) => e.startsWith(`${code} : absent_du_site`)), code);
  const somme = Math.round(prix.reduce((s, p) => s + p.prix_public, 0) * 100) / 100;
  assert.equal(somme, 30511.73);
});

test('relevé TEREVA : prix ramenés à l\'unité de la base (kilomètre → mètre, sachet de 100 → pièce)', () => {
  const { prix } = prixPublicsDuReleve(releve);
  const de = (code) => prix.find((p) => p.reference === code);
  assert.equal(de('4514850').prix_public, 4107.46);
  assert.equal(de('1378398').prix_public, 6.6013);
  assert.equal(de('2040463').prix_public, 0.2065);
});

test('relevé invalide ou code en double : échec bruyant', () => {
  assert.throws(() => prixPublicsDuReleve({}), /relevé invalide/);
  assert.throws(() => prixPublicsDuReleve({ fournisseur: 'X', releve: '2026-10-25', articles: [{ code: 'A', statut: 'ok', prix_affiche: '1' }, { code: 'A', statut: 'ok', prix_affiche: '2' }] }), /double/);
});
