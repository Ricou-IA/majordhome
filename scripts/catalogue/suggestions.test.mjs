// scripts/catalogue/suggestions.test.mjs
// Suggestions de « Rattacher une ligne fournisseur » (src/lib/catalogue/suggestions.js) — module PUR.
// Décision d'Eric (2026-10-25) : « ici l'outil devrait proposer une ou des correspondances ».
// Run : node --test scripts/catalogue/suggestions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jetons, comparerReferences, scorerCandidat, suggestions } from '../../src/lib/catalogue/suggestions.js';

const article = {
  id: 'art-1', name: 'V2C Chargeur Trydan 7,4 kW avec prise T2S (TRY32-1-SO-F)', brand: 'V2C', model_key: 'TRY321SOF',
  references: ['41-122029'], prix: 400,
};
const ligne = (o) => ({ id: o.id, name: o.name, brand: o.brand ?? 'V2C', reference: o.reference ?? '', model_key: o.model_key ?? null, purchase_price_ht: o.prix ?? 400, catalog_item_id: o.item ?? 'autre', supplier_name: o.sup ?? 'ECOSTAL' });

test('jetons : minuscules sans accents, décimales gardées (« 7,4 » ⇒ « 7.4 »)', () => {
  assert.deepEqual([...jetons('Borne V2C Trydan 7,4 kW mono – prise T2S')].sort(), ['7.4', 'borne', 'kw', 'mono', 'prise', 't2s', 'trydan', 'v2c'].sort());
  assert.deepEqual([...jetons('')], []);
});

test('comparerReferences : identique, proche (suffixe d\'une ou deux lettres), sinon rien', () => {
  assert.equal(comparerReferences('TRY32-1-SO-F', 'TRY321SOF'), 'identique');
  assert.equal(comparerReferences('TRY32-1-SO', 'TRY321SOF'), 'proche');
  assert.equal(comparerReferences('TRY321SOF', 'TRY32-1-SO'), 'proche');
  assert.equal(comparerReferences('TRY32-1-OL5', 'TRY321SOF'), null);
  assert.equal(comparerReferences('AB1', 'AB1X'), null, 'clé trop courte : pas de rapprochement par suffixe');
  assert.equal(comparerReferences('', 'TRY321SOF'), null);
});

test('scorerCandidat : même marque + référence fabricant proche + libellé proche ⇒ score élevé, raisons lisibles', () => {
  const r = scorerCandidat(article, ligne({ id: 'e1', name: 'Borne V2C Trydan 7,4 kW mono – prise T2S', reference: 'TRY32-1-SO', prix: 376.47 }));
  assert.ok(r.score >= 8, `score ${r.score}`);
  assert.ok(r.raisons.includes('même marque'));
  assert.ok(r.raisons.includes('référence fabricant proche'));
});

test('scorerCandidat : marques différentes ⇒ écarté (score 0)', () => {
  assert.equal(scorerCandidat(article, ligne({ id: 'x', name: 'Wallbox Pulsar 7,4 kW prise T2S', brand: 'Wallbox', reference: 'PLP1' })).score, 0);
});

test('suggestions : classées, la bonne Trydan d\'abord, la ligne déjà rattachée exclue, sous le seuil écartées', () => {
  const lignes = [
    ligne({ id: 'e-ol10', name: 'Borne V2C Trydan 7,4 kW mono – câble T2S 10 m', reference: 'TRY32-1-OL10', prix: 587 }),
    ligne({ id: 'e-so', name: 'Borne V2C Trydan 7,4 kW mono – prise T2S', reference: 'TRY32-1-SO', prix: 376.47 }),
    ligne({ id: 'b-so', name: 'V2C Chargeur Trydan 7,4 kW avec prise T2S (TRY32-1-SO-F)', reference: '41-122029', model_key: 'TRY321SOF', item: 'art-1', sup: 'BAYWA' }),
    ligne({ id: 'e-abri', name: 'Abri métallique de protection V2C Trydan', reference: 'V2C-TRY-COVER', prix: 89 }),
    ligne({ id: 'w', name: 'Wallbox Pulsar', brand: 'Wallbox' }),
  ];
  const s = suggestions(article, lignes, { max: 5 });
  assert.equal(s[0].ligne.id, 'e-so');
  assert.ok(!s.some((x) => x.ligne.id === 'b-so'), 'déjà rattachée à cet article');
  assert.ok(!s.some((x) => x.ligne.id === 'w'), 'autre marque');
  const abri = s.findIndex((x) => x.ligne.id === 'e-abri');
  const ol10 = s.findIndex((x) => x.ligne.id === 'e-ol10');
  assert.ok(ol10 === -1 || ol10 > 0, 'le câble 10 m après la prise');
  assert.ok(abri === -1 || abri > ol10, 'l\'abri (accessoire, prix 5× moindre) en dernier ou écarté');
});

test('suggestions : article sans marque ⇒ libellé et référence seuls', () => {
  const s = suggestions({ id: 'a', name: 'Disjoncteur 1P+N 16A courbe C', brand: null, model_key: null, references: [], prix: 9 },
    [ligne({ id: 'h', name: 'Disjoncteur 1P+N 16A courbe C Hager', brand: 'Hager', reference: 'MFN716', prix: 9.8 }), ligne({ id: 'c', name: 'Câble R2V 3G2,5', brand: 'Nexans', reference: 'R2V3G25', prix: 1.2 })]);
  assert.equal(s[0].ligne.id, 'h');
  assert.ok(!s.some((x) => x.ligne.id === 'c'));
});
