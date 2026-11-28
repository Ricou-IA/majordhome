// Contrôle, doublons et bilan des articles — scripts/import-articles/controles.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  controlerArticle, classerArticles, aImporter, choixPourTousLesDoublons, bilan, lignesPourEcriture, CLES_ROW_ARTICLE,
} from '../../src/lib/importArticles/controles.js';
import { NATURE_ECARTER } from '../../src/lib/importArticles/valeurs.js';

const MAINTENANT = new Date(2026, 10, 28);
const interp = { nature: { Fourniture: 'main', Ouvrage: NATURE_ECARTER, Truc: '' }, categorie: { Poêle: 'poele', Zzz: '' }, unite: { u: 'pièce', ml: 'ml', Zut: '' } };
const opt = (o = {}) => ({ valeursInterpretees: interp, avecFournisseur: false, maintenant: MAINTENANT, ...o });
const cand = (numero, valeurs) => ({ numero, valeurs });
const vide = { articles: [], lignes: [] };

test('désignation absente ⇒ sans_designation ; nature @ecarter ⇒ ouvrage', () => {
  const a = controlerArticle({ code: 'X' }, opt());
  assert.equal(a.fiche, null); assert.equal(a.raison, 'sans_designation');
  const b = controlerArticle({ designation: 'Lot', nature: 'Ouvrage' }, opt());
  assert.equal(b.fiche, null); assert.equal(b.raison, 'ouvrage');
});

test('valeurs par défaut et corrections', () => {
  const v = controlerArticle({ designation: ' Poêle 8 kW ', marque: 'Invicta', modele: 'ORA-80-X1', code: ' ref-1 ' }, opt());
  assert.equal(v.raison, null);
  assert.equal(v.fiche.name, 'Poêle 8 kW');
  assert.equal(v.fiche.code, 'ref-1');
  assert.equal(v.fiche.product_kind, 'main');
  assert.equal(v.fiche.unit, 'pièce');
  assert.equal(v.fiche.default_tva_rate, 20);
  assert.equal(v.fiche.selling_price_ht, 0);
  assert.equal(v.fiche.modele_brut, 'ORA-80-X1');
  assert.equal(v.fiche.model_key, 'ORA80X1');
  assert.deepEqual(v.corrections, []);
  assert.equal(v.ligneFournisseur, 'non_demandee');

  const w = controlerArticle({ designation: 'A', nature: 'Truc', categorie: 'Zzz', unite: 'Zut', tva: '7', prix_vente: 'abc', ean: '12', date_prix: '01/01/2099' }, opt());
  assert.equal(w.fiche.product_kind, 'main'); assert.equal(w.fiche.category, null);
  assert.equal(w.fiche.unit, 'pièce'); assert.equal(w.fiche.default_tva_rate, 20);
  assert.equal(w.fiche.selling_price_ht, 0); assert.equal(w.fiche.code_ean, null);
  for (const k of ['nature', 'categorie', 'unite', 'tva', 'prix_vente', 'ean', 'date_prix']) assert.ok(w.corrections.includes(k), k);

  const x = controlerArticle({ designation: 'A', nature: 'Fourniture', categorie: 'Poêle', unite: 'ml', tva: '10', prix_vente: '12,5' }, opt());
  assert.equal(x.fiche.category, 'poele'); assert.equal(x.fiche.unit, 'ml');
  assert.equal(x.fiche.default_tva_rate, 10); assert.equal(x.fiche.selling_price_ht, 12.5);
  assert.deepEqual(x.corrections, []);
});

test('ligne fournisseur : oui / sans_prix / sans_reference / sans_fournisseur', () => {
  const base = { designation: 'A', fournisseur: 'Invicta', ref_fournisseur: 'R1', prix_achat: '10', prix_public: '15', date_prix: '15/03/2026' };
  const o = opt({ avecFournisseur: true });
  const ok = controlerArticle(base, o);
  assert.equal(ok.ligneFournisseur, 'oui');
  assert.deepEqual(ok.fiche.fournisseur, { nom: 'Invicta', reference: 'R1', purchase_price_ht: 10, tarif_public: 15, purchase_price_at: '2026-03-15' });
  assert.equal(controlerArticle({ ...base, prix_achat: '0' }, o).ligneFournisseur, 'sans_prix');
  assert.equal(controlerArticle({ ...base, prix_achat: '0' }, o).fiche.name, 'A');
  // Sous 0,005 : arrondi à 0,00 en base ⇒ traité comme absent, l'article reste importable sans ligne fournisseur
  const minuscule = controlerArticle({ ...base, prix_achat: '0,004' }, o);
  assert.equal(minuscule.ligneFournisseur, 'sans_prix');
  assert.equal(minuscule.fiche.fournisseur, null);
  assert.equal(minuscule.fiche.name, 'A');
  assert.equal(controlerArticle({ ...base, prix_achat: '0,005' }, o).ligneFournisseur, 'oui');
  // Prix d'achat hors plafond : illisible (compté), donc sans ligne fournisseur
  const enorme = controlerArticle({ ...base, prix_achat: '100000000' }, o);
  assert.equal(enorme.ligneFournisseur, 'sans_prix');
  assert.ok(enorme.corrections.includes('prix_achat'));
  assert.equal(controlerArticle({ ...base, ref_fournisseur: '' }, o).ligneFournisseur, 'sans_reference');
  assert.equal(controlerArticle({ ...base, fournisseur: '' }, o).ligneFournisseur, 'sans_fournisseur');
  assert.equal(controlerArticle({ ...base, date_prix: '' }, o).fiche.fournisseur.purchase_price_at, null);
});

test('doublons forts avec la base', () => {
  const existant = {
    articles: [
      { id: 'a1', code: 'REF-1', code_ean: null, brand: null, model_key: null, name: 'Zzz', product_kind: 'main' },
      { id: 'a2', code: null, code_ean: '3760123456789', brand: null, model_key: null, name: 'Yyy', product_kind: 'main' },
      { id: 'a3', code: null, code_ean: null, brand: 'INVICTA', model_key: 'ORA80X1', name: 'Xxx', product_kind: 'main' },
    ],
    lignes: [{ supplier_id: 's1', reference: 'R-9' }],
  };
  const o = opt({ avecFournisseur: true, fournisseursResolus: { invicta: 's1' } });
  const r = classerArticles([
    cand(2, { designation: 'a', code: ' ref-1 ' }),
    cand(3, { designation: 'b', ean: '3760123456789' }),
    cand(4, { designation: 'c', marque: 'invicta', modele: 'ORA-80-X1' }),
    cand(5, { designation: 'd', fournisseur: 'Invicta', ref_fournisseur: ' r-9 ', prix_achat: '5' }),
  ], existant, o);
  assert.deepEqual(r.map((c) => c.doublon.motif), ['code', 'ean', 'marque_modele', 'ligne_fournisseur']);
  assert.deepEqual(r.map((c) => c.recochable), [false, true, true, true]);
  assert.ok(r.every((c) => c.doublon.force === 'fort'));
  assert.equal(r[0].doublon.articleId, 'a1');
  const choix = { 2: true, 3: true, 4: false, 5: true };
  assert.equal(aImporter(r[0], choix), false); // code : jamais recochable
  assert.equal(aImporter(r[1], choix), true);
  assert.equal(aImporter(r[2], choix), false);
  assert.equal(aImporter(r[3], {}), false);
  const lignes = lignesPourEcriture(r, choix, o.fournisseursResolus);
  assert.deepEqual(lignes.map((l) => l.import_line), [3, 5]);
  assert.equal(lignes[1].fournisseur, null); // ligne fournisseur existante : jamais renvoyée
});

test("désignation : fort si même marque (ou aucune), faible si marque d'un seul côté ou différente", () => {
  const existant = { articles: [
    { id: 'a1', code: null, code_ean: null, brand: null, model_key: null, name: 'Câble 3G2,5', product_kind: 'main' },
    { id: 'a2', code: null, code_ean: null, brand: 'Legrand', model_key: null, name: 'Prise', product_kind: 'main' },
    { id: 'a3', code: null, code_ean: null, brand: null, model_key: null, name: 'Pose', product_kind: 'main_oeuvre' },
  ], lignes: [] };
  const r = classerArticles([
    cand(2, { designation: 'CABLE 3G2.5' }),
    cand(3, { designation: 'Prise', marque: 'legrand' }), // avec marque, sans modèle
    cand(4, { designation: 'Prise' }),
    cand(5, { designation: 'Prise', marque: 'Hager' }),
    cand(6, { designation: 'Pose' }), // autre nature : pas un doublon
  ], existant, opt());
  assert.deepEqual([r[0].doublon.force, r[0].doublon.motif, r[0].recochable], ['fort', 'designation', true]);
  assert.equal(aImporter(r[0], {}), false);
  assert.equal(aImporter(r[0], { 2: true }), true);
  assert.deepEqual([r[1].doublon.force, r[1].doublon.motif], ['fort', 'designation']);
  assert.equal(aImporter(r[1], {}), false);
  for (const k of [2, 3]) { assert.equal(r[k].doublon.force, 'faible'); assert.equal(aImporter(r[k], {}), true); }
  assert.equal(aImporter(r[2], { 4: false }), false);
  assert.equal(r[4].doublon, null);
});

test('doublons dans le fichier', () => {
  const r = classerArticles([
    cand(2, { designation: 'a', code: 'C1' }),
    cand(3, { designation: 'b', code: ' c1 ' }),
    cand(4, { designation: 'c', marque: 'Invicta', modele: 'ORA-80-X1' }),
    cand(5, { designation: 'd', marque: 'INVICTA', modele: 'ora-80-x1' }),
  ], vide, opt());
  assert.equal(r[0].doublon, null);
  assert.deepEqual([r[1].doublon.motif, r[1].recochable], ['fichier_code', false]);
  assert.equal(r[2].doublon, null);
  assert.deepEqual([r[3].doublon.motif, r[3].recochable], ['fichier', true]);
  const d = classerArticles([cand(2, { designation: 'Prise', marque: 'Legrand' }), cand(3, { designation: 'PRISE', marque: 'legrand' }), cand(4, { designation: 'Prise', marque: 'Hager' })], vide, opt());
  assert.deepEqual([d[0].doublon, d[1].doublon.motif, d[1].doublon.force, d[1].recochable, d[2].doublon], [null, 'fichier', 'fort', true, null]);
  assert.equal(aImporter(r[1], { 3: true }), false);
  assert.equal(aImporter(r[3], { 5: true }), true);
});

const JEU = () => [
  cand(2, { designation: 'Poêle', marque: 'Invicta', modele: 'ORA-80-X1', code: 'P1', fournisseur: 'Invicta', ref_fournisseur: 'R1', prix_achat: '10' }),
  cand(3, { designation: '' }),
  cand(4, { designation: 'Lot', nature: 'Ouvrage' }),
  cand(5, { designation: 'Autre', code: 'P1' }),
  cand(6, { designation: 'Même', ean: '3760123456789' }),
  cand(7, { designation: 'Même bis', ean: '3760123456789' }),
  cand(8, { designation: 'Existant code', code: 'DEJA' }),
  cand(9, { designation: 'Existant ean', ean: '4006381333931' }),
  cand(10, { designation: 'Câble' }),
  cand(11, { designation: 'Ligne', fournisseur: 'Invicta', ref_fournisseur: 'EXI', prix_achat: '3' }),
  cand(12, { designation: 'Sans prix', fournisseur: 'Invicta', ref_fournisseur: 'R2', prix_achat: '0' }),
  cand(13, { designation: 'Simple' }),
];
const EXISTANT = {
  articles: [
    { id: 'e1', code: 'deja', code_ean: null, brand: null, model_key: null, name: 'x', product_kind: 'main' },
    { id: 'e2', code: null, code_ean: '4006381333931', brand: null, model_key: null, name: 'y', product_kind: 'main' },
    { id: 'e3', code: null, code_ean: null, brand: 'Acme', model_key: null, name: 'Cable', product_kind: 'main' },
  ],
  lignes: [{ supplier_id: 's1', reference: 'EXI' }],
};

test('invariant : lues = importées + doublons + écartées, comptés directement', () => {
  const o = opt({ avecFournisseur: true, fournisseursResolus: { invicta: 's1' } });
  const n = JEU().length;
  const r = classerArticles(JEU(), EXISTANT, o);
  assert.equal(r.length, n);
  assert.deepEqual(r.map((c) => c.numero), JEU().map((c) => c.numero)); // aucune ligne perdue ni doublée
  const tousOui = Object.fromEntries(r.map((c) => [c.numero, true]));
  const tousNon = Object.fromEntries(r.map((c) => [c.numero, false]));
  const attendus = [
    [{}, { importees: 5, doublons: 5, ecartees: 2 }],
    [tousOui, { importees: 8, doublons: 2, ecartees: 2 }],
    [tousNon, { importees: 4, doublons: 6, ecartees: 2 }],
  ];
  for (const [choix, att] of attendus) {
    const b = bilan(r, choix);
    assert.equal(b.lues, n);
    assert.deepEqual({ importees: b.importees, doublons: b.doublons, ecartees: b.ecartees }, att);
    assert.equal(b.importees + b.doublons + b.ecartees, n);
    assert.equal(lignesPourEcriture(r, choix, o.fournisseursResolus).length, b.importees);
  }
  for (const choix of [choixPourTousLesDoublons(r, {}, true), choixPourTousLesDoublons(r, tousOui, false)]) {
    const b = bilan(r, choix);
    assert.equal(b.importees + b.doublons + b.ecartees, n);
  }
  // Par défaut : 2, 6, 10 (doublon faible, repris), 12 et 13. Ligne fournisseur créée : la ligne 2 seulement.
  assert.equal(bilan(r, {}).lignesFournisseur, 1);
  // Une ligne perdue ou comptée deux fois dans le classement romprait l'égalité avec le nombre de lignes lues du fichier.
  const perdue = bilan(r.slice(1), {});
  assert.notEqual(perdue.importees + perdue.doublons + perdue.ecartees, n);
});

test('liste des articles existants inconnue : le classement refuse', () => {
  assert.throws(() => classerArticles(JEU(), null, opt()), /inconnue/);
  assert.throws(() => classerArticles(JEU(), undefined, opt()), /inconnue/);
  assert.throws(() => classerArticles(JEU(), { articles: [] }, opt()), /inconnue/);
});

test('ligne fournisseur existante : jamais renvoyée, quel que soit le motif du doublon', () => {
  const existant = {
    articles: [{ id: 'a2', code: null, code_ean: '3760123456789', brand: null, model_key: null, name: 'Zzz', product_kind: 'main' }],
    lignes: [{ supplier_id: 's1', reference: 'R1' }, { supplier_id: 's1', reference: 'R2' }],
  };
  const o = opt({ avecFournisseur: true, fournisseursResolus: { invicta: 's1' } });
  const r = classerArticles([
    cand(2, { designation: 'a', ean: '3760123456789', fournisseur: 'Invicta', ref_fournisseur: 'R1', prix_achat: '5' }),
    cand(3, { designation: 'b', marque: 'Invicta', modele: 'ORA-80-X1', fournisseur: 'Invicta', ref_fournisseur: 'R2', prix_achat: '5' }),
    cand(4, { designation: 'c', marque: 'Invicta', modele: 'ORA-80-X1', fournisseur: 'Invicta', ref_fournisseur: 'R2', prix_achat: '5' }),
  ], existant, o);
  assert.equal(r[0].doublon.motif, 'ean'); assert.equal(r[0].ligneExistante, true);
  assert.equal(r[2].doublon.motif, 'fichier'); assert.equal(r[2].ligneExistante, true);
  const choix = choixPourTousLesDoublons(r, {}, true);
  const l = lignesPourEcriture(r, choix, o.fournisseursResolus);
  assert.equal(l.length, 3);
  assert.ok(l.every((x) => x.fournisseur === null));
  assert.equal(bilan(r, choix).lignesFournisseur, 0);
});

test('choixPourTousLesDoublons ne touche pas aux non recochables', () => {
  const r = classerArticles(JEU(), EXISTANT, opt());
  const choix = choixPourTousLesDoublons(r, {}, true);
  assert.equal(aImporter(r.find((c) => c.numero === 5), choix), false); // fichier_code
  assert.equal(aImporter(r.find((c) => c.numero === 8), choix), false); // code existant
  assert.equal(aImporter(r.find((c) => c.numero === 9), choix), true);
  assert.equal(aImporter(r.find((c) => c.numero === 7), choix), true);
});

test('lignesPourEcriture : clés exactes, sans org_id ; fournisseur non résolu ⇒ absent', () => {
  const o = opt({ avecFournisseur: true, fournisseursResolus: { invicta: 's1' } });
  const r = classerArticles([cand(2, { designation: 'A', fournisseur: 'Invicta', ref_fournisseur: 'R1', prix_achat: '10', prix_public: '12' }), cand(3, { designation: 'B', fournisseur: 'Autre', ref_fournisseur: 'R2', prix_achat: '4' })], vide, o);
  const l = lignesPourEcriture(r, {}, o.fournisseursResolus);
  for (const x of l) { assert.deepEqual(Object.keys(x), CLES_ROW_ARTICLE); assert.ok(!('org_id' in x)); }
  assert.deepEqual(l[0].fournisseur, { supplier_id: 's1', reference: 'R1', purchase_price_ht: 10, tarif_public: 12, purchase_price_at: null });
  assert.equal(l[1].fournisseur, null);
  assert.equal(l[0].import_line, 2);
  assert.deepEqual(CLES_ROW_ARTICLE.slice(0, 3), ['import_line', 'name', 'code']);
});

test('même fichier deux fois : tout est doublon fort (marque + modèle, désignation + marque, désignation seule)', () => {
  const lignes = [
    cand(2, { designation: 'Poêle', code: 'P1' }),
    cand(3, { designation: 'Ballon', ean: '3760123456789' }),
    cand(4, { designation: 'Pompe', marque: 'Invicta', modele: 'ORA-80-X1' }),
    cand(5, { designation: 'Vase', marque: 'Zilmet' }),
    cand(6, { designation: 'Joint' }),
  ];
  const premier = classerArticles(lignes, vide, opt());
  assert.ok(premier.every((c) => c.doublon === null));
  const articles = lignesPourEcriture(premier, {}, {}).map((l, i) => ({ id: `n${i}`, code: l.code, code_ean: l.code_ean, brand: l.brand, model_key: l.model_key, name: l.name, product_kind: l.product_kind }));
  const second = classerArticles(lignes, { articles, lignes: [] }, opt());
  assert.ok(second.every((c) => c.doublon?.force === 'fort'), JSON.stringify(second.map((c) => c.doublon)));
  assert.equal(bilan(second, {}).importees, 0);
});
