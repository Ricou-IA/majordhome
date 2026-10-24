// node --test scripts/catalogue/achats.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueDepuisAchats } from './achats.js';

const ligne = (code, designation, quantite, prix, extra = {}) => ({ code, designation, quantite, unite: 'pièce', prix_unitaire_net: prix, montant_ht: Math.round(quantite * prix * 100) / 100, tva_taux: 20, bl: { numero: 'BL1', date: '2026-04-10' }, ...extra });

const documents = [
  { type: 'facture', numero: 'F1', date: '2026-04-30', lignes: [
    ligne('CAB1', 'U 1000 R2V 3G2,5 C50', 50, 1.2823, { prix_base: 2.3, remises: [44.25] }),
    ligne('HAG1', 'Coffret 8 modules', 1, 30.36),
    ligne('KIT1', 'KIT 8 OUTILS', 1, 1699.9, { promo: true, eco: 3.91, ref_fabricant: 'DCK853P4-QW' }),
    ligne('LAMPE', 'LAMPE OFFERTE', 1, 0, { promo: true }),
  ] },
  { type: 'avoir', numero: 'A1', date: '2026-05-02', lignes: [ligne('HAG1', 'Coffret 8 modules', 1, 30.36)] },
  { type: 'facture', numero: 'F2', date: '2026-08-31', lignes: [
    ligne('CAB1', 'U 1000 R2V 3G2,5 C50', 100, 1.3728, { prix_base: 2.4736, remises: [44.5], bl: { numero: 'BL9', date: '2026-08-26' } }),
    ligne('CAB1', 'U 1000 R2V 3G2,5 C50', 50, 1.35, { bl: { numero: 'BL7', date: '2026-08-12' } }),
    ligne('SANS', 'ligne sans quantité', null, 4),
    ligne('TUB', 'TUBE PVC 40', 4, 1.76, { unite: 'm', uf: '4', tva_taux: 10 }),
  ] },
];

test('dernier prix net payé par référence, historique, avoirs ignorés, lignes incomplètes écartées', () => {
  const { lignes, rapport } = catalogueDepuisAchats(documents, { version: 'achats_test_2026-08' });
  assert.equal(rapport.factures, 2);
  assert.deepEqual(rapport.avoirs_ignores, ['avoir A1 du 2026-05-02']);
  assert.equal(rapport.lignes_lues, 8);
  assert.equal(rapport.lignes_ecartees.length, 1);
  assert.equal(rapport.articles, 5);
  assert.equal(rapport.articles_offerts, 1);
  assert.equal(rapport.dernier_achat, '2026-08-31');
  assert.deepEqual(lignes.map((l) => l.reference), ['CAB1', 'HAG1', 'KIT1', 'LAMPE', 'TUB']);

  const cab = lignes.find((l) => l.reference === 'CAB1');
  assert.equal(cab.purchase_price_ht, 1.3728); // BL du 26/08, le plus récent de la facture d'août
  assert.equal(cab.name, 'U 1000 R2V 3G2,5 C50');
  assert.equal(cab.selling_price_ht_defaut, 0);
  assert.equal(cab.category, null);
  assert.equal(cab.product_kind, 'main');
  assert.equal(cab.specs.source_version, 'achats_test_2026-08');
  const c = cab.specs.canonical;
  assert.equal(c.source, 'factures_pennylane');
  assert.equal(c.nb_achats, 3);
  assert.equal(c.quantite_totale, 200);
  assert.equal(c.prix_min, 1.2823);
  assert.equal(c.prix_max, 1.3728);
  assert.equal(c.dernier_achat, '2026-08-31');
  assert.equal(c.derniere_facture, 'F2');
  assert.deepEqual(c.remises_pct, [44.5]);
  assert.equal(c.prix_base, 2.4736);
  assert.deepEqual(c.historique.map((h) => [h.date, h.bl, h.prix_unitaire_net]), [['2026-08-31', 'BL9', 1.3728], ['2026-08-31', 'BL7', 1.35], ['2026-04-30', 'BL1', 1.2823]]);

  const kit = lignes.find((l) => l.reference === 'KIT1');
  assert.equal(kit.specs.canonical.promo, true);
  assert.equal(kit.specs.canonical.ref_fabricant, 'DCK853P4-QW');
  assert.equal(kit.specs.canonical.eco_participation_unitaire, 3.91);

  const lampe = lignes.find((l) => l.reference === 'LAMPE');
  assert.equal(lampe.purchase_price_ht, 0);
  assert.equal(lampe.specs.canonical.offert_dans_pack, true);

  const tube = lignes.find((l) => l.reference === 'TUB');
  assert.equal(tube.unit, 'm');
  assert.equal(tube.default_tva_rate, 10);
  assert.equal(tube.specs.canonical.unite_facturation, '4');
});

test('un prix nul récent n’efface pas un prix connu', () => {
  const docs = [
    { type: 'facture', numero: 'F1', date: '2026-03-31', lignes: [ligne('X', 'Pack', 1, 90)] },
    { type: 'facture', numero: 'F2', date: '2026-06-30', lignes: [ligne('X', 'Pack', 1, 0)] },
  ];
  const { lignes, rapport } = catalogueDepuisAchats(docs, { version: 'v' });
  assert.equal(lignes[0].purchase_price_ht, 90);
  assert.equal(lignes[0].specs.canonical.prix_du, '2026-03-31');
  assert.equal(lignes[0].specs.canonical.dernier_achat, '2026-06-30');
  assert.equal(rapport.articles_offerts, 0);
});

test('version obligatoire', () => {
  assert.throws(() => catalogueDepuisAchats([], {}), /version/);
});
