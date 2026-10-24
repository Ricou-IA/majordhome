// node --test scripts/catalogue/ecostal.test.mjs — pinne la transcription du tarif Ecostal (grille HESIA / V2C
// du 04/04/2026) : 37 références, prix d'achat de la grille, fiches techniques couvrant chaque gamme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lignesDepuisTarifEcostal } from './ecostal-tarif.js';

const tarif = JSON.parse(readFileSync(new URL('./data/ecostal-2026-04.json', import.meta.url), 'utf8'));

test('tarif Ecostal 2026-04 : 37 références uniques, toutes avec un prix', () => {
  const { fournisseur, lignes } = lignesDepuisTarifEcostal(tarif, { version: 'ecostal_2026-04' });
  assert.equal(fournisseur.nom, 'ECOSTAL');
  assert.equal(lignes.length, 37);
  assert.equal(new Set(lignes.map((l) => l.reference)).size, 37);
  assert.ok(lignes.every((l) => l.purchase_price_ht > 0 && l.selling_price_ht_defaut === null && l.category === 'borne_recharge' && l.brand === 'V2C'));
  const total = lignes.reduce((s, l) => s + l.purchase_price_ht, 0);
  assert.equal(Math.round(total * 100) / 100, 27220.84); // somme des 37 prix de la grille, vérifiée à la main
});

test('prix pinnés sur la grille (une borne par gamme + le badge RFID commun)', () => {
  const { lignes } = lignesDepuisTarifEcostal(tarif, { version: 'v' });
  const prix = Object.fromEntries(lignes.map((l) => [l.reference, l.purchase_price_ht]));
  assert.equal(prix['TRY32-1-OL5-P-F'], 481.17);
  assert.equal(prix['TRYPRO32-3-OL10'], 639.47);
  assert.equal(prix['POLEPRO-OX2-32-3-CLOUD-F'], 2300.98);
  assert.equal(prix['DENKA-40'], 5772.82);
  assert.equal(prix['TRFID'], 3.17);
  const denka = lignes.find((l) => l.reference === 'DENKA-20');
  assert.equal(denka.specs.canonical.puissance_kw, 20);
  assert.equal(denka.specs.canonical.date_tarif, '2026-04-04');
  assert.equal(denka.specs.source_version, 'v');
});

test('nature des articles : 22 bornes, 15 accessoires', () => {
  const { lignes } = lignesDepuisTarifEcostal(tarif, { version: 'v' });
  assert.equal(lignes.filter((l) => l.product_kind === 'main').length, 22);
  assert.equal(lignes.filter((l) => l.product_kind === 'accessory').length, 15);
});

test('chaque fiche technique couvre au moins un article, et chaque borne a une fiche', () => {
  const bornes = tarif.articles.filter((a) => a.kind === 'main');
  for (const b of bornes) {
    assert.ok(tarif.fiches.some((f) => f.prefixes.some((p) => b.reference.startsWith(p))), `${b.reference} sans fiche`);
  }
  assert.throws(() => lignesDepuisTarifEcostal({ ...tarif, fiches: [{ fichier: 'x.pdf', prefixes: ['ZZZ-'] }] }, { version: 'v' }), /aucun article/);
});

test('refus bruyant : référence en double, prix manquant', () => {
  const double = { ...tarif, articles: [...tarif.articles, tarif.articles[0]] };
  assert.throws(() => lignesDepuisTarifEcostal(double, { version: 'v' }), /double/);
  const sansPrix = { ...tarif, articles: [{ ...tarif.articles[0], prix: null }] };
  assert.throws(() => lignesDepuisTarifEcostal(sansPrix, { version: 'v' }), /sans prix/);
});
