// Tests du tarif NET Invicta (scripts/catalogue/invicta-tarif.js) sur les tarifs réels transcrits.
// node --test scripts/catalogue/invicta-tarif.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lignesDepuisTarifInvicta, correctionsDePrix, ecartsArticle, gammeNormalisee, categorieDeGamme } from './invicta-tarif.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`./data/${f}`, import.meta.url), 'utf8'));
const T2026 = lire('invicta-tarif-2026-03.json');
const T2025 = lire('invicta-tarif-2025-04.json');
const A = (extra = {}) => ({ reference: 'P942111', name: 'OVE PLUG-IN', gamme: 'Poêles à Granulés Plug-In', ean: '3244339421113', marqueurs: ['Exc'], brut_ht: 4237.62, remise_pct: 35, net_ht: 2754.45, public_ttc: 5085, ...extra });

test('ecartsArticle : cohérent, net faux, public qui n’est pas le brut TTC, EAN invalide', () => {
  assert.deepEqual(ecartsArticle(A()), []);
  assert.match(ecartsArticle(A({ net_ht: 3305.25 }))[0], /net 3305.25 ≠ brut/);           // l'erreur de mars 2026 : achat calculé sur le TTC
  assert.match(ecartsArticle(A({ public_ttc: 4237.62 }))[0], /public TTC/);
  assert.match(ecartsArticle(A({ ean: '12' }))[0], /EAN/);
  assert.match(ecartsArticle(A({ brut_ht: 0 }))[0], /prix brut ou net absent/);
});

test('rangement des prix : vente = brut HT (jamais le public TTC), achat = net HT', () => {
  const { lignes } = lignesDepuisTarifInvicta({ articles: [A()] }, { version: 'invicta-tarif_2026-03' });
  assert.equal(lignes.length, 1);
  const l = lignes[0];
  assert.equal(l.selling_price_ht_defaut, 4237.62);
  assert.equal(l.tarif_public, 4237.62);
  assert.equal(l.purchase_price_ht, 2754.45);
  assert.equal(l.taux_remise, 35);
  assert.equal(l.specs.canonical.prix_public_ttc, 5085);
  assert.equal(l.specs.canonical.exclusivite, true);
  assert.equal(l.specs.source_version, undefined); // pas de source_version : le tarif porte des références en double en base
  assert.equal(l.brand, 'INVICTA');
  assert.equal(l.category, 'poele');
});

test('gammes et catégories', () => {
  assert.equal(gammeNormalisee('Poêles à Bûches en Fonte Etanches'), 'Poêles à Bûches en Fonte Étanches');
  assert.equal(gammeNormalisee('Poêles à Bûches en Fonte Raccordable'), 'Poêles à Bûches en Fonte Raccordables');
  assert.equal(gammeNormalisee('Insert à Granulés'), 'Insert à Granulés');
  assert.equal(categorieDeGamme('Accessoires'), null);
  assert.equal(categorieDeGamme('Foyers à Bûches en Fonte'), 'poele');
});

test('référence répétée : une seule ligne ; deux prix pour la même référence ou article incohérent : refus', () => {
  const r = lignesDepuisTarifInvicta({ articles: [A(), A({ name: 'OVE autre désignation' })] }, { version: 'v' });
  assert.equal(r.lignes.length, 1);
  assert.deepEqual(r.doublons, ['P942111']);
  assert.equal(r.lignes[0].name, 'OVE PLUG-IN');
  assert.throws(() => lignesDepuisTarifInvicta({ articles: [A(), A({ brut_ht: 4000, net_ht: 2600, public_ttc: 4800 })] }, { version: 'v' }), /deux prix différents/);
  assert.throws(() => lignesDepuisTarifInvicta({ articles: [A({ net_ht: 1 })] }, { version: 'v' }), /Tarif incohérent/);
  assert.throws(() => lignesDepuisTarifInvicta({ articles: [] }, { version: 'v' }), /vide/);
  assert.throws(() => lignesDepuisTarifInvicta({ articles: [A()] }, {}), /version/);
});

test('correctionsDePrix : tarif courant d’abord, ancien tarif pour les références disparues, TTC cumulés', () => {
  const c = correctionsDePrix(
    { articles: [A()] },
    { articles: [A({ brut_ht: 4100, net_ht: 2665, public_ttc: 4920 }), A({ reference: 'P1', brut_ht: 100, net_ht: 65, public_ttc: 120 })] },
  );
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { reference: 'P942111', vente_ht: 4237.62, achat_ht: 2754.45, remise_pct: 35, ean: '3244339421113', anciens_ttc: [5085, 4920], au_tarif: true });
  assert.deepEqual([c[1].reference, c[1].vente_ht, c[1].au_tarif, c[1].anciens_ttc], ['P1', 100, false, [120]]);
});

// Tarifs RÉELS : chiffres pinnés (transcription PyMuPDF des PDF du fabricant).
test('tarif réel 2026-2027 (ATRIERS Invicta Net, valable du 01/03/2026 au 28/02/2027)', () => {
  assert.equal(T2026.valable_du, '01/03/2026');
  const { lignes, doublons, compteRendu } = lignesDepuisTarifInvicta(T2026, { version: 'invicta-tarif_2026-03' });
  assert.deepEqual([compteRendu.lignes_pdf, compteRendu.references, compteRendu.somme_brut_ht, compteRendu.somme_net_ht], [162, 155, 240463.81, 157345.27]);
  assert.deepEqual(doublons, ['P696128', 'P696131', 'P696200', 'P699701A']);
  const ove = lignes.find((l) => l.reference === 'P942111');
  assert.deepEqual([ove.selling_price_ht_defaut, ove.purchase_price_ht, ove.specs.canonical.prix_public_ttc], [4237.62, 2754.45, 5085]);
  assert.ok(lignes.every((l) => l.purchase_price_ht < l.tarif_public));
  assert.equal(new Set(lignes.map((l) => l.reference)).size, lignes.length);
});

test('tarif réel 2025-2026 (DISTRIBUTEUR Invicta Net) et table de correction', () => {
  const { compteRendu } = lignesDepuisTarifInvicta(T2025, { version: 'invicta-tarif_2025-04' });
  assert.deepEqual([compteRendu.lignes_pdf, compteRendu.references, compteRendu.somme_brut_ht, compteRendu.somme_net_ht], [160, 155, 239828.37, 156864.54]);
  const c = correctionsDePrix(T2026, T2025);
  assert.equal(c.length, 191);
  assert.equal(c.filter((x) => x.au_tarif).length, 155);
  assert.ok(c.every((x) => x.vente_ht > 0 && x.achat_ht > 0 && x.achat_ht < x.vente_ht && x.anciens_ttc.every((t) => t > x.vente_ht)));
});
