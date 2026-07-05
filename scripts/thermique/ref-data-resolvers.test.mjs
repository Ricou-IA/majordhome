// scripts/thermique/ref-data-resolvers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePeriode, uDefautPour, thetaBasePour, coefficientBPour, chercheCommunes, djuDepartemental, debitVentilationPour, uwDepuisComposants } from '../../src/apps/thermique/lib/refDataResolvers.js';

const uDefauts = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/u-defauts.json', import.meta.url), 'utf8'));
const climat = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/climat.json', import.meta.url), 'utf8'));
const coefB = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/coefficients-b.json', import.meta.url), 'utf8'));
const ventilation = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/ventilation.json', import.meta.url), 'utf8'));

test('resolvePeriode : bornes réelles des périodes 3CL', () => {
  assert.equal(resolvePeriode(1960), 'avant 1974');
  assert.equal(resolvePeriode(1974), 'avant 1974');
  assert.equal(resolvePeriode(1975), '1975-1977');
  assert.equal(resolvePeriode(1980), '1978-1982');
  assert.equal(resolvePeriode(1995), '1989-2000');
  assert.equal(resolvePeriode(2013), 'après 2012');
  assert.equal(resolvePeriode(2024), 'après 2012');
  // année inconnue → « avant 1974 » (sémantique 3CL « avant 1974 ou inconnu »)
  assert.equal(resolvePeriode(null), 'avant 1974');
  assert.equal(resolvePeriode(undefined), 'avant 1974');
  // formulaires HTML : chaînes numériques coercées avant le test de validité
  assert.equal(resolvePeriode('1980'), '1978-1982');
  assert.equal(resolvePeriode(''), 'avant 1974');
  assert.equal(resolvePeriode('abc'), 'avant 1974');
});

test('uDefautPour : lit la vraie table du plan 1', () => {
  assert.equal(uDefautPour(uDefauts, 'mur', 1960), 2.5);
  assert.equal(uDefautPour(uDefauts, 'mur', 2015), 0.23);
  assert.equal(uDefautPour(uDefauts, 'plancherBas', 1995), 0.5);
  assert.equal(uDefautPour(uDefauts, 'plafond', 2008), 0.2);
  assert.equal(uDefautPour(uDefauts, 'fenetre', 1990), null); // pas de table fenêtre (plan 1)
  assert.throws(() => uDefautPour(uDefauts, 'toiture', 1990), /thermique/); // type inconnu ≠ type sans table
});

test('thetaBasePour : valeurs plan 1, sans correction d’altitude (report phase A/B)', () => {
  assert.equal(thetaBasePour(climat, '81', 140).thetaE, -5);
  assert.equal(thetaBasePour(climat, '67', 150).thetaE, -15);
  assert.equal(thetaBasePour(climat, '2A', 50).thetaE, -2);
  assert.equal(thetaBasePour(climat, '81', 140).correctionAltitude, 'non-appliquée');
  assert.throws(() => thetaBasePour(climat, '971', 10), /DOM/);
  assert.throws(() => thetaBasePour(climat, '99', 10), /thermique/);
});

test('coefficientBPour : sélection par libellé (contrat stable, pas d’index)', () => {
  // valeurs vérifiées plan 1 (coefficients-b.json)
  assert.equal(coefficientBPour(coefB, 'Sous-sol', 'Sans fenêtre ni porte extérieure'), 0.5);
  assert.equal(coefficientBPour(coefB, 'Espace sous toiture', 'Toiture isolée'), 0.7);
  // catégorie à valeur unique sans libellé : description = null la sélectionne
  assert.equal(coefficientBPour(coefB, 'Paroi donnant sur un local chauffée à la même température', null), 0);
  assert.throws(() => coefficientBPour(coefB, 'Grenier', 'Sans fenêtre ni porte extérieure'), /thermique/);
  assert.throws(() => coefficientBPour(coefB, 'Sous-sol', 'Libellé inconnu'), /thermique/);
});

test('chercheCommunes : par nom (insensible accents/casse) + dept', () => {
  const communes = [
    { nom: 'Gaillac', insee: '810099', dept: '81', altitude: 134, dju: 1943 },
    { nom: 'Gaillac-Toulza', insee: '310000', dept: '31', altitude: 300, dju: null },
  ];
  const r = chercheCommunes(communes, 'gaillac');
  assert.equal(r.length, 2);
  assert.equal(chercheCommunes(communes, 'gaillac', '81').length, 1);
  assert.equal(chercheCommunes(communes, 'g').length, 0); // < 2 caractères
  assert.equal(chercheCommunes(communes, 'GAILLAC-TOULZA')[0].insee, '310000'); // casse + tiret
  // robustesse : saisie non-chaîne → [] (pas de crash)
  assert.deepEqual(chercheCommunes(communes, null), []);
  assert.deepEqual(chercheCommunes(communes, undefined), []);
  // dept numérique (formulaires/JSON) coercé en chaîne
  assert.equal(chercheCommunes(communes, 'gaillac', 81).length, 1);
});

test('djuDepartemental : médiane des DJU non-null du département', () => {
  const communes = [
    { nom: 'A', dept: '81', dju: 1900 }, { nom: 'B', dept: '81', dju: 2100 },
    { nom: 'C', dept: '81', dju: 2000 }, { nom: 'D', dept: '81', dju: null },
    { nom: 'E', dept: '31', dju: 1500 },
  ];
  assert.equal(djuDepartemental(communes, '81'), 2000);          // médiane impaire
  communes.push({ nom: 'F', dept: '81', dju: 2200 });
  assert.equal(djuDepartemental(communes, '81'), 2050);          // paire → moyenne des 2 centraux
  assert.throws(() => djuDepartemental(communes, '99'), /thermique/); // aucun DJU
});

test('debitVentilationPour : table réglementaire clampée [1, 7]', () => {
  assert.equal(debitVentilationPour(ventilation, 'vmc-sf-auto', 3).debitTotal, 75);
  assert.equal(debitVentilationPour(ventilation, 'vmc-sf-auto', 0).debitTotal, 35);   // clamp bas
  assert.equal(debitVentilationPour(ventilation, 'vmc-sf-auto', 12).debitTotal, 135); // T7 reconduit
  assert.equal(debitVentilationPour(ventilation, 'naturelle', 3).debitTotal, null);   // mode taux
  assert.equal(debitVentilationPour(ventilation, 'naturelle', 3).systeme.mode, 'taux');
  assert.equal(debitVentilationPour(ventilation, 'vmc-df', 4).systeme.rendement, 0.7);
  assert.throws(() => debitVentilationPour(ventilation, 'vmc-triple-flux', 3), /thermique/);
});

test('uwDepuisComposants : forfait 0.7·Ug + 0.3·Uf, volet en résistance additionnelle', () => {
  // Ug 1.1, Uf 1.5 → Uw = 0.7×1.1 + 0.3×1.5 = 0.77 + 0.45 = 1.22
  const r = uwDepuisComposants({ ug: 1.1, uf: 1.5 });
  assert.ok(Math.abs(r.uw - 1.22) < 1e-9);
  assert.equal(r.ujn, null);
  // Avec volet ΔR 0.25 : Ujn = 1/(1/1.22 + 0.25) = 1/1.06967… = 0.93487…
  const v = uwDepuisComposants({ ug: 1.1, uf: 1.5, deltaR: 0.25 });
  assert.ok(Math.abs(v.ujn - 1 / (1 / 1.22 + 0.25)) < 1e-9);
  assert.throws(() => uwDepuisComposants({ ug: 0, uf: 1.5 }), /thermique/);
});
