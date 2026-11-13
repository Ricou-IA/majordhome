// scripts/catalogue/recherche-pieces.test.mjs
// Classement des pièces d'un catalogue de marchand pour la fiche d'un appareil (src/lib/catalogue/recherchePieces.js),
// sur les 119 lignes réelles de l'extrait du rayon « Pièces détachées Freepoint » mises à la forme de la vue
// `majordhome_pieces_catalogue`. Run : node --test scripts/catalogue/recherche-pieces.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { piecesDepuisReleveWoocommerce } from '../../src/lib/catalogue/woocommercePieces.js';
import {
  MOTS_GENERIQUES, MOTS_VIDES, UNITES_IGNOREES, normaliser, motsDuModele, modeleExploitable, classerPieces,
} from '../../src/lib/catalogue/recherchePieces.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const releve = JSON.parse(readFileSync(path.join(racine, 'scripts', 'catalogue', 'data', 'ebd-pieces-2026-11.json'), 'utf8'));
const { lignes: lignesAdaptateur } = piecesDepuisReleveWoocommerce(releve, { version: 'woocommerce_2026-11-12', releveLe: '2026-11-12T04:00:00Z' });

// Même définition que la vue SQL : lower(unaccent(concat_ws(' ', name, reference, brand, rayons, description_marchand))),
// ponctuation gardée.
function versVue(ligne) {
  const c = ligne.specs.canonical;
  const rayons = c.rayons.join(' | ');
  const recherche = [ligne.name, ligne.reference, ligne.brand, rayons, c.description_marchand].join(' ')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return {
    id: ligne.reference, reference: ligne.reference, name: ligne.name, brand: ligne.brand, rayons,
    prix_public_ttc: c.prix_public_ttc, en_stock: c.stock_releve.en_stock, fiche_url: c.fiche_produit, recherche,
  };
}
const lignes = lignesAdaptateur.map(versVue);
const par = (ref) => lignes.find((l) => l.reference === ref);
const refs = (rows) => rows.map((l) => l.reference);
const fab = (o) => ({ id: o.reference, name: o.reference, brand: 'CADEL', rayons: 'Pièces détachées Freepoint', prix_public_ttc: 10, en_stock: true, recherche: '', ...o });

test('constantes et mots du modèle', () => {
  assert.ok(Object.isFrozen(MOTS_GENERIQUES));
  assert.ok(MOTS_GENERIQUES.includes('one') && MOTS_GENERIQUES.includes('at'));
  assert.deepEqual(motsDuModele('GLOBE AIRTIGHT'), ['globe', 'airtight']);
  assert.deepEqual(motsDuModele('Globe-Globe / Airtight 2 (1200)'), ['globe', 'airtight']);
  assert.deepEqual(motsDuModele('Mika Evo, Évo d’été'), ['mika', 'evo', 'ete']);
  assert.deepEqual(motsDuModele(''), []);
  assert.deepEqual(motsDuModele(null), []);
  assert.equal(modeleExploitable('Globe Airtight'), true);
  for (const m of ['One', 'Evo', 'Joy', 'Evo Plus', 'AT WiFi', '', '12', 'A1']) assert.equal(modeleExploitable(m), false, m);
  assert.equal(modeleExploitable('Mika Evo'), true, 'Mika a 4 lettres et n’est pas générique');
  assert.equal(modeleExploitable('Freepoint', 'FREEPOINT'), false);
  assert.equal(modeleExploitable('Freepoint One', 'Freepoint'), false);
  assert.equal(modeleExploitable('Freepoint Globe', 'Freepoint'), true);
});

test('Globe Airtight + « bougie » : les deux bougies citées, rien d’autre', () => {
  const r = classerPieces({ marque: 'FREEPOINT', modele: 'GLOBE AIRTIGHT', saisie: 'bougie' }, lignes);
  assert.deepEqual(refs(r.citees).sort(), ['4D14513002', '4D145181040']);
  assert.ok(r.memeMarque.length > 0);
  assert.ok(r.memeMarque.every((l) => /bougie/i.test(l.name)));
  assert.equal(r.motif, null);
  // une ligne n'apparaît que dans un groupe
  assert.equal(r.citees.filter((l) => r.memeMarque.includes(l)).length, 0);
});

test('formes d’écriture du modèle', () => {
  const ent = { marque: 'Freepoint', modele: 'Globe Airtight', saisie: '' };
  // vraies fiches : « Globe-Globe Airtight » et « Globe / Globe Airtight »
  assert.match(par('4D145181040').recherche, /globe-globe airtight/);
  assert.match(par('4D14513002').recherche, /globe \/ globe airtight/);
  const r = classerPieces(ent, lignes);
  assert.ok(refs(r.citees).includes('4D145181040'));
  assert.ok(refs(r.citees).includes('4D14513002'));
  // fiche « compatible globe at » seule : même marque, pas citée
  const seule = fab({ reference: 'SEULE', recherche: 'compatible globe at pieces detachees freepoint cadel' });
  const r2 = classerPieces(ent, [seule]);
  assert.deepEqual(refs(r2.citees), []);
  assert.deepEqual(refs(r2.memeMarque), ['SEULE']);
  // apostrophes typographiques : séparateurs
  const l = fab({ reference: 'APOS', recherche: 'bougie de l’allumage poele ete' });
  assert.deepEqual(refs(classerPieces({ marque: 'cadel', modele: 'L’allumage Poêle Été', saisie: '' }, [l]).citees), ['APOS']);
});

test('modèle absent ou générique', () => {
  assert.equal(classerPieces({ marque: 'FREEPOINT', modele: '', saisie: '' }, lignes).motif, 'modele_absent');
  assert.equal(classerPieces({ marque: 'FREEPOINT', modele: 'One', saisie: '' }, lignes).motif, 'modele_generique');
  assert.equal(classerPieces({ marque: 'FREEPOINT', modele: 'One', saisie: '' }, lignes).citees.length, 0);
  const r = classerPieces({ marque: 'FREEPOINT', modele: 'Evo Plus', saisie: '' }, lignes);
  assert.equal(r.motif, 'modele_generique');
  assert.equal(r.citees.length, 0);
  assert.ok(r.memeMarque.length > 0, 'les pièces de la marque restent proposées');
  const a = classerPieces({ marque: 'FREEPOINT', modele: '  ', saisie: '' }, lignes);
  assert.equal(a.motif, 'modele_absent');
  assert.ok(a.memeMarque.length > 0);
});

test('marque saisie dans le champ modèle : modèle générique, rien de cité', () => {
  const r = classerPieces({ marque: 'FREEPOINT', modele: 'Freepoint', saisie: '' }, lignes);
  assert.equal(r.motif, 'modele_generique');
  assert.equal(r.citees.length, 0);
  assert.ok(r.memeMarque.length > 0);
});

test('marque hors catalogue ou vide', () => {
  const r = classerPieces({ marque: 'COLA', modele: 'Elegant', saisie: '' }, lignes);
  assert.equal(r.citees.length + r.memeMarque.length, 0);
  assert.equal(r.motif, 'marque_absente');
  const v = classerPieces({ marque: '  ', modele: 'Globe Airtight', saisie: '' }, lignes);
  assert.equal(v.citees.length + v.memeMarque.length, 0);
  assert.equal(v.motif, 'marque_absente');
  assert.equal(classerPieces({ marque: undefined, modele: 'x', saisie: '' }, lignes).motif, 'marque_absente');
});

test('marque en majuscules, avec espace, ou en rayon seulement (pièce commune à plusieurs marques)', () => {
  const base = classerPieces({ marque: 'Freepoint', modele: '', saisie: '' }, lignes);
  for (const marque of ['FREEPOINT', 'freepoint', ' Freepoint ']) {
    assert.deepEqual(refs(classerPieces({ marque, modele: '', saisie: '' }, lignes).memeMarque), refs(base.memeMarque), marque);
  }
  // 4D145181040 a pour marque CADEL mais figure aussi au rayon Freepoint
  assert.equal(par('4D145181040').brand, 'CADEL');
  assert.ok(refs(base.memeMarque).includes('4D145181040'));
  // « pièces détachées » du rayon n'est pas une marque
  assert.equal(classerPieces({ marque: 'Pièces détachées', modele: '', saisie: '' }, lignes).motif, 'marque_absente');
});

test('une fiche qui cite le modèle mais d’une autre marque n’est ni citée ni listée', () => {
  const autre = fab({ reference: 'AUTRE', brand: 'MCZ', rayons: 'Pièces détachées MCZ', recherche: 'compatible globe airtight pieces detachees mcz' });
  const r = classerPieces({ marque: 'Freepoint', modele: 'Globe Airtight', saisie: '' }, [autre]);
  assert.deepEqual([r.citees, r.memeMarque], [[], []]);
  assert.equal(r.motif, 'marque_absente');
});

test('mot entier : « Joy » ne cite pas « Joystick »', () => {
  const joystick = fab({ reference: 'JOYSTICK', recherche: 'manette joystick pour poele' });
  const joy = fab({ reference: 'JOY', recherche: 'cartouche, modele joy, et autres' });
  // « Joy » seul est générique (3 lettres) : rien n'est cité, même la fiche qui dit « joy »
  const g = classerPieces({ marque: 'CADEL', modele: 'Joy', saisie: '' }, [joystick, joy]);
  assert.equal(g.motif, 'modele_generique');
  assert.deepEqual(refs(g.citees), []);
  // modèle exploitable « Joya » : pas cité par « Joyaux », cité par « (joya) »
  const joyaux = fab({ reference: 'JOYAUX', recherche: 'joyaux de la couronne' });
  const juste = fab({ reference: 'JOYA', recherche: 'compatible: joya (2020)' });
  const r = classerPieces({ marque: 'CADEL', modele: 'Joya', saisie: '' }, [joyaux, juste]);
  assert.deepEqual(refs(r.citees), ['JOYA']);
  assert.deepEqual(refs(r.memeMarque), ['JOYAUX']);
  // plusieurs mots : tous requis
  const un = fab({ reference: 'UN', recherche: 'globe seulement' });
  assert.deepEqual(refs(classerPieces({ marque: 'CADEL', modele: 'Globe Airtight', saisie: '' }, [un]).citees), []);
});

test('saisie : mots progressifs, début de mot, référence', () => {
  const m = { marque: 'Freepoint', modele: '' };
  const tout = classerPieces({ ...m, saisie: '' }, lignes).memeMarque.length;
  const boug = classerPieces({ ...m, saisie: 'boug' }, lignes).memeMarque;
  assert.ok(boug.length > 0 && boug.length < tout);
  assert.ok(refs(boug).includes('4D145181040'));
  assert.deepEqual(refs(classerPieces({ ...m, saisie: '4d145181040' }, lignes).memeMarque), ['4D145181040']);
  assert.deepEqual(refs(classerPieces({ ...m, saisie: 'BOUGIE 4D1451' }, lignes).memeMarque).sort(), ['4D14513002', '4D145181040']);
  assert.equal(classerPieces({ ...m, saisie: 'bougiezzz' }, lignes).memeMarque.length, 0);
  assert.equal(classerPieces({ ...m, saisie: 'x' }, lignes).memeMarque.length, tout, 'un seul caractère ne filtre pas');
  // début de mot seulement : « ougie » n'est pas un début de mot
  assert.equal(classerPieces({ ...m, saisie: 'ougie' }, lignes).memeMarque.length, 0);
});

test('tri : en stock d’abord, prix croissant (sans prix en dernier), puis référence', () => {
  const rows = [
    fab({ reference: 'D', en_stock: false, prix_public_ttc: 1 }),
    fab({ reference: 'C', prix_public_ttc: 20 }),
    fab({ reference: 'B', prix_public_ttc: 10 }),
    fab({ reference: 'A', prix_public_ttc: 10 }),
    fab({ reference: 'E', prix_public_ttc: null }),
    fab({ reference: 'F', en_stock: false, prix_public_ttc: 0.5 }),
  ];
  const r = classerPieces({ marque: 'CADEL', modele: '', saisie: '' }, rows);
  assert.deepEqual(refs(r.memeMarque), ['A', 'B', 'C', 'E', 'F', 'D']);
  // même tri dans le groupe des citées
  const cit = rows.map((x) => ({ ...x, recherche: 'poele globe airtight' }));
  assert.deepEqual(refs(classerPieces({ marque: 'CADEL', modele: 'Globe Airtight', saisie: '' }, cit).citees), ['A', 'B', 'C', 'E', 'F', 'D']);
});

test('pièce commune à plusieurs marques : trouvée pour Freepoint bien que sa marque soit CADEL', () => {
  const r = classerPieces({ marque: 'Freepoint', modele: 'Globe Airtight', saisie: 'bougie' }, lignes);
  assert.ok(refs(r.citees).includes('4D145181040'));
  const v = classerPieces({ marque: 'Cadel', modele: '', saisie: 'bougie' }, lignes);
  assert.ok(refs(v.memeMarque).includes('4D145181040'));
});

test('entrée hostile : sans exception et rapide', () => {
  const t0 = Date.now();
  for (const e of [
    { marque: '(.*)+[', modele: '(.*)+[', saisie: '\\' },
    { marque: 'Freepoint', modele: '(.*)+[ a+ *? "x"', saisie: '(((' },
    { marque: 'x'.repeat(500), modele: 'y'.repeat(500), saisie: 'z'.repeat(500) },
    { marque: 'Freepoint', modele: 'globe '.repeat(80), saisie: 'boug '.repeat(100) },
    { marque: 12, modele: {}, saisie: [] },
    {},
  ]) {
    const r = classerPieces(e, lignes);
    assert.ok(Array.isArray(r.citees) && Array.isArray(r.memeMarque));
  }
  assert.ok(Date.now() - t0 < 200, `trop lent : ${Date.now() - t0} ms`);
});

test('entrées non modifiées, nouveaux tableaux, lignes absentes ou bancales', () => {
  const copie = JSON.stringify(lignes);
  const entree = { marque: 'Freepoint', modele: 'Globe Airtight', saisie: 'bougie' };
  const e0 = JSON.stringify(entree);
  const r = classerPieces(entree, lignes);
  assert.equal(JSON.stringify(lignes), copie);
  assert.equal(JSON.stringify(entree), e0);
  assert.notEqual(r.citees, lignes);
  assert.deepEqual(classerPieces({ marque: 'Freepoint', modele: 'Globe', saisie: '' }, null), { citees: [], memeMarque: [], motif: 'marque_absente', total: { citees: 0, memeMarque: 0 } });
  assert.deepEqual(classerPieces({ marque: 'Freepoint', modele: 'Globe', saisie: '' }, []), { citees: [], memeMarque: [], motif: 'marque_absente', total: { citees: 0, memeMarque: 0 } });
  assert.deepEqual(classerPieces(null, lignes).citees, []);
  const bancales = [null, undefined, 3, 'x', {}, { reference: 'Z' }, { rayons: null, brand: null, recherche: null }];
  assert.doesNotThrow(() => classerPieces({ marque: 'Freepoint', modele: 'Globe', saisie: 'a' }, bancales));
});

// ---- Correctif 1 : « cité » exige les mots du modèle à la suite et dans l'ordre ----

test('séquence : mots séparés dans la fiche ⇒ pas citée', () => {
  const eloignes = fab({ reference: 'ELOIGNES', recherche: 'compatible mika, mika hydro, indigo evo' });
  const suite = fab({ reference: 'SUITE', recherche: 'compatible mika evo (2020)' });
  const r = classerPieces({ marque: 'CADEL', modele: 'Mika Evo', saisie: '' }, [eloignes, suite]);
  assert.deepEqual(refs(r.citees), ['SUITE']);
  assert.deepEqual(refs(r.memeMarque), ['ELOIGNES']);
});

test('séquence : ordre inversé ⇒ pas citée ; séparateurs variés ⇒ citée', () => {
  const inverse = fab({ reference: 'INVERSE', recherche: 'compatible airtight globe' });
  const tiret = fab({ reference: 'TIRET', recherche: 'globe-globe airtight' });
  const barre = fab({ reference: 'BARRE', recherche: 'globe / globe airtight' });
  const r = classerPieces({ marque: 'CADEL', modele: 'Globe Airtight', saisie: '' }, [inverse, tiret, barre]);
  assert.deepEqual(refs(r.citees).sort(), ['BARRE', 'TIRET']);
  assert.deepEqual(refs(r.memeMarque), ['INVERSE']);
});

test('séquence : un nombre dans le modèle ne casse pas la suite', () => {
  const fiche = fab({ reference: 'SUITECA', recherche: 'compatible suite comfort air 14 m2 et autres' });
  const r = classerPieces({ marque: 'CADEL', modele: 'Suite Comfort Air 14 M2', saisie: '' }, [fiche]);
  assert.deepEqual(refs(r.citees), ['SUITECA']);
  // le nombre intercalé dans la fiche est ignoré des deux côtés
  const autre = fab({ reference: 'AUTRE2', recherche: 'suite comfort 14 air m2' });
  assert.deepEqual(refs(classerPieces({ marque: 'CADEL', modele: 'Suite Comfort Air M2', saisie: '' }, [autre]).citees), ['AUTRE2']);
});

test('séquence sur l’extrait réel : faux positifs retirés, bougies conservées', () => {
  const c = (modele) => classerPieces({ marque: 'FREEPOINT', modele, saisie: '' }, lignes);
  const glo = c('Globe Airtight');
  assert.ok(refs(glo.citees).includes('4D145181040') && refs(glo.citees).includes('4D14513002'));
  const moon = c('Moon AT WiFi');
  assert.ok(!refs(moon.citees).includes('4D145158020'));
  assert.ok(refs(moon.memeMarque).includes('4D145158020'));
  const mika = c('Mika Evo');
  for (const ref of ['4D14513031', '4D14513004']) {
    assert.ok(!refs(mika.citees).includes(ref), ref);
    assert.ok(refs(mika.memeMarque).includes(ref), ref);
  }
});

// ---- Correctif final : totaux avant filtre, marque recopiée, symétrie, unités, normalisation, articles ----

test('totaux avant filtre : la saisie ne les change jamais', () => {
  const m = { marque: 'FREEPOINT', modele: 'Globe Airtight' };
  const sans = classerPieces({ ...m, saisie: '' }, lignes);
  assert.equal(sans.citees.length, 21);
  assert.equal(sans.memeMarque.length, 98);
  assert.deepEqual(sans.total, { citees: 21, memeMarque: 98 });
  // une phrase rédigée vide les deux groupes…
  const phrase = classerPieces({ ...m, saisie: 'le poêle s’éteint après 10 minutes' }, lignes);
  assert.equal(phrase.citees.length + phrase.memeMarque.length, 0);
  // …mais les totaux restent ceux du catalogue pour cet appareil
  assert.deepEqual(phrase.total, { citees: 21, memeMarque: 98 });
  const bougie = classerPieces({ ...m, saisie: 'bougie' }, lignes);
  assert.deepEqual(bougie.total, { citees: 21, memeMarque: 98 });
  assert.ok(bougie.citees.length + bougie.memeMarque.length < 119);
});

test('totaux : marque absente ou modèle absent', () => {
  assert.deepEqual(classerPieces({ marque: 'COLA', modele: 'x', saisie: '' }, lignes).total, { citees: 0, memeMarque: 0 });
  assert.deepEqual(classerPieces({ marque: '', modele: 'x', saisie: '' }, lignes).total, { citees: 0, memeMarque: 0 });
  assert.deepEqual(classerPieces({ marque: 'RED', modele: '', saisie: 'zzz' }, lignes).total, { citees: 0, memeMarque: 55 });
  assert.deepEqual(classerPieces({ marque: 'Freepoint', modele: 'Globe' }, null).total, { citees: 0, memeMarque: 0 });
});

test('modèle qui recopie la marque : mêmes citées que sans la marque', () => {
  const sans = classerPieces({ marque: 'Freepoint', modele: 'Globe Airtight', saisie: '' }, lignes);
  const avec = classerPieces({ marque: 'Freepoint', modele: 'Freepoint Globe Airtight', saisie: '' }, lignes);
  assert.deepEqual(refs(avec.citees), refs(sans.citees));
  assert.equal(avec.citees.length, 21);
  assert.equal(avec.motif, null);
  // la marque en tête seulement
  const fiche = fab({ reference: 'TETE', recherche: 'poele globe airtight' });
  assert.deepEqual(refs(classerPieces({ marque: 'CADEL', modele: 'Cadel Globe Airtight', saisie: '' }, [fiche]).citees), ['TETE']);
  // « Freepoint » seul reste générique
  assert.equal(classerPieces({ marque: 'Freepoint', modele: 'Freepoint', saisie: '' }, lignes).motif, 'modele_generique');
});

test('filtre symétrique : la suite de la fiche subit le même filtre que le modèle', () => {
  const ete = fab({ reference: 'ETE', recherche: 'bougie poele d ete compatible' });
  assert.deepEqual(refs(classerPieces({ marque: 'CADEL', modele: 'Poêle d’été', saisie: '' }, [ete]).citees), ['ETE']);
  // « Globe® » devient « globe(r) » après unaccent : mots globe, r, airtight
  const reg = fab({ reference: 'REG', recherche: 'joint de globe(r) airtight' });
  assert.deepEqual(refs(classerPieces({ marque: 'CADEL', modele: 'Globe Airtight', saisie: '' }, [reg]).citees), ['REG']);
  assert.deepEqual(refs(classerPieces({ marque: 'CADEL', modele: 'Globe® Airtight', saisie: '' }, [reg]).citees), ['REG']);
});

test('unités : kw kg mm cm toujours écartées, m2 m3 seulement après un nombre', () => {
  assert.ok(Object.isFrozen(UNITES_IGNOREES));
  assert.deepEqual([...UNITES_IGNOREES].sort(), ['cm', 'kg', 'kw', 'm2', 'm3', 'mm']);
  const globe = classerPieces({ marque: 'Freepoint', modele: 'GLOBE AIRTIGHT 9 kW', saisie: '' }, lignes);
  const ref = classerPieces({ marque: 'Freepoint', modele: 'Globe Airtight 9', saisie: '' }, lignes);
  assert.deepEqual(refs(globe.citees), refs(ref.citees));
  assert.equal(globe.citees.length, 21);
  assert.deepEqual(motsDuModele('GLOBE AIRTIGHT 9 kW'), ['globe', 'airtight']);
  assert.deepEqual(motsDuModele('Insert 80 m2'), ['insert']);
  assert.deepEqual(motsDuModele('Hotte M2 Pro'), ['hotte', 'm2', 'pro'], 'm2 sans nombre devant : un nom de version');
  assert.deepEqual(motsDuModele('Suite Comfort Air 14 M2'), ['suite', 'comfort', 'air', 'm2'], 'nombre inférieur à 20 : numéro de version, m2 gardé');
  assert.deepEqual(motsDuModele('Cuve 300 m3'), ['cuve']);
  // la fiche subit le même écart
  const fiche = fab({ reference: 'KW', recherche: 'bougie globe airtight 9 kw 12 mm' });
  assert.deepEqual(refs(classerPieces({ marque: 'CADEL', modele: 'Globe Airtight 9 kW', saisie: '' }, [fiche]).citees), ['KW']);
  assert.deepEqual(refs(classerPieces({ marque: 'CADEL', modele: 'Globe Airtight', saisie: '' }, [fiche]).citees), ['KW']);
});

test('« Suite Comfort Air 14 M2 » : même résultat qu’avant l’écart des unités (m2 gardé dans la séquence)', () => {
  const r = classerPieces({ marque: 'FREEPOINT', modele: 'Suite Comfort Air 14 M2', saisie: '' }, lignes);
  assert.equal(r.citees.length, 1);
  assert.equal(r.total.memeMarque, 118);
  const fiche = fab({ reference: 'SCA', recherche: 'compatible suite comfort air 14 m2' });
  assert.deepEqual(refs(classerPieces({ marque: 'CADEL', modele: 'Suite Comfort Air 14 M2', saisie: '' }, [fiche]).citees), ['SCA']);
});

test('normalisation alignée sur unaccent de PostgreSQL', () => {
  assert.equal(normaliser('Jøtul'), 'jotul');
  assert.equal(normaliser('JØTUL'), 'jotul');
  assert.equal(normaliser('Cœur'), 'coeur');
  assert.equal(normaliser('ÆTHER Straße Łódź'), 'aether strasse lodz');
  assert.equal(normaliser('Éléphant'), 'elephant');
  assert.equal(normaliser(null), '');
  assert.deepEqual(motsDuModele('Jøtul Cœur'), ['jotul', 'coeur']);
  const f = fab({ reference: 'JO', recherche: 'poele jotul coeur' });
  assert.deepEqual(refs(classerPieces({ marque: 'CADEL', modele: 'Jøtul Cœur', saisie: '' }, [f]).citees), ['JO']);
});

test('articles de la marque ignorés (même liste que le filtre serveur)', () => {
  assert.ok(MOTS_VIDES.has('la') && MOTS_VIDES.has('de') && MOTS_VIDES.has('des'));
  const nordica = fab({ reference: 'NOR', brand: 'NORDICA', rayons: 'Pièces détachées Nordica', recherche: 'bougie nordica' });
  const r = classerPieces({ marque: 'La Nordica', modele: '', saisie: '' }, [nordica]);
  assert.deepEqual(refs(r.memeMarque), ['NOR']);
  assert.notEqual(r.motif, 'marque_absente');
  const dd = fab({ reference: 'DD', brand: 'DIETRICH', rayons: 'Pièces détachées Dietrich', recherche: 'x' });
  assert.deepEqual(refs(classerPieces({ marque: 'De Dietrich', modele: '', saisie: '' }, [dd]).memeMarque), ['DD']);
});

test('performance : 500 lignes de ~3000 mots classées 20 fois (index réutilisé)', () => {
  const gros = Array.from({ length: 500 }, (_, i) => fab({
    reference: `P${i}`,
    recherche: Array.from({ length: 3000 }, (__, j) => `mot${(i * 7 + j * 13) % 900}`).join(' ') + (i % 5 === 0 ? ' globe airtight' : ''),
  }));
  const critere = { marque: 'CADEL', modele: 'Globe Airtight', saisie: '' };
  const premier = classerPieces(critere, gros);
  assert.equal(premier.citees.length, 100);
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 20; k++) classerPieces({ ...critere, saisie: k % 2 ? 'mot1' : '' }, gros);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1000, `trop lent : ${ms.toFixed(0)} ms`);
});
