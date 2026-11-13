// node --test scripts/catalogue/pieces-catalogue-requete.test.mjs — mot de marque qui filtre la lecture de la vue des pièces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as requete from '../../src/lib/catalogue/piecesCatalogueRequete.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliser, classerPieces } from '../../src/lib/catalogue/recherchePieces.js';
import { piecesDepuisReleveWoocommerce } from '../../src/lib/catalogue/woocommercePieces.js';
import { libelleDateReleve, messageSaisieSansResultat } from '../../src/lib/catalogue/piecesAffichage.js';

const motFiltreMarque = (...a) => requete.motFiltreMarque(...a);

test('motFiltreMarque : minuscules, sans accents, premier mot utile', () => {
  assert.equal(motFiltreMarque('Freepoint'), 'freepoint');
  assert.equal(motFiltreMarque('  FREEPOINT '), 'freepoint');
  assert.equal(motFiltreMarque('Godin Éco'), 'godin');
});

test('motFiltreMarque : ignore les mots d’un seul caractère et les articles', () => {
  assert.equal(motFiltreMarque('La Foyère'), 'foyere');
  assert.equal(motFiltreMarque('De Dietrich'), 'dietrich');
  assert.equal(motFiltreMarque('X Poele'), 'poele');
  assert.equal(motFiltreMarque("L'Atelier du feu"), 'atelier');
});

test('motFiltreMarque : vide quand rien d’exploitable', () => {
  assert.equal(motFiltreMarque(''), '');
  assert.equal(motFiltreMarque('   '), '');
  assert.equal(motFiltreMarque(null), '');
  assert.equal(motFiltreMarque(undefined), '');
  assert.equal(motFiltreMarque(42), '');
  assert.equal(motFiltreMarque('a'), '');
  assert.equal(motFiltreMarque('%,()*'), '');
});

test('motFiltreMarque : jamais de caractère propre à PostgREST ni de joker', () => {
  for (const brute of ['Fire,is_active.eq.false', 'a%b', 'x*y', 'foo(bar)', 'pa\\th:val']) {
    const mot = motFiltreMarque(brute);
    assert.doesNotMatch(mot, /[,()*:\\%_\s]/, `« ${brute} » → « ${mot} »`);
  }
});

const motFiltreModele = (...a) => requete.motFiltreModele(...a);

test('motFiltreModele : le mot le plus long de 4 lettres et plus, hors génériques et hors marque', () => {
  assert.equal(motFiltreModele('Globe Airtight', 'Freepoint'), 'airtight');
  assert.equal(motFiltreModele('Moon AT WiFi', 'Freepoint'), 'moon');
  assert.equal(motFiltreModele('Freepoint Globe', 'Freepoint'), 'globe');
  assert.equal(motFiltreModele('Évolution Mika', ''), 'evolution');
  assert.equal(motFiltreModele('Mika Moon', ''), 'mika'); // égalité de longueur : le premier
});

test('motFiltreModele : vide quand le modèle ne prouve rien', () => {
  assert.equal(motFiltreModele('One', 'Freepoint'), '');
  assert.equal(motFiltreModele('700', ''), '');
  assert.equal(motFiltreModele('', ''), '');
  for (const v of [null, undefined, 42, {}, []]) assert.equal(motFiltreModele(v, 'x'), '');
});

test('motFiltreModele : jamais de caractère propre à PostgREST', () => {
  const mot = motFiltreModele('Fire,is_active.eq.false (a%b)*:\\', '');
  assert.doesNotMatch(mot, /[,()*:\\%_.\s]/);
});

// ---- Correctif final : filtre serveur sur la marque et les rayons ----

test('motFiltreMarque : accents et translittérations retirés — « Jotul » et « Jøtul » donnent le même mot', () => {
  assert.equal(motFiltreMarque('Jotul'), 'jotul');
  assert.equal(motFiltreMarque('Jøtul'), 'jotul');
  assert.equal(motFiltreMarque('Stûv'), 'stuv');
  assert.equal(motFiltreMarque('RED'), 'red');
  assert.equal(motFiltreMarque('Röth'), 'roth');
  assert.equal(motFiltreMarque('Cœur de Feu'), 'coeur');
  assert.equal(motFiltreMarque('La Françoise'), 'francoise');
  for (const v of ['Jøtul', 'Stûv', 'Cœur de Feu', 'Ça va']) assert.match(motFiltreMarque(v), /^[a-z]+$/, v);
});

test('motFiltreMarque : sur-ensemble de classerPieces sur l’extrait réel (trois marques)', () => {
  const releve = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'ebd-pieces-2026-11.json'), 'utf8'));
  const { lignes: la } = piecesDepuisReleveWoocommerce(releve, { version: 'v', releveLe: '2026-11-12T04:00:00Z' });
  const lignes = la.map((l) => {
    const c = l.specs.canonical;
    const rayons = c.rayons.join(' | ');
    return { id: l.reference, reference: l.reference, name: l.name, brand: l.brand, rayons, recherche: normaliser([l.name, l.reference, l.brand, rayons, c.description_marchand].join(' ')) };
  });
  const marqueRecherche = (l) => normaliser(`${l.brand} ${l.rayons}`);
  for (const marque of ['FREEPOINT', 'Cadel', 'RED']) {
    const mot = motFiltreMarque(marque);
    const r = classerPieces({ marque, modele: 'Globe Airtight', saisie: '' }, lignes);
    const classees = [...r.citees, ...r.memeMarque];
    assert.ok(classees.length > 0, marque);
    for (const l of classees) assert.ok(marqueRecherche(l).includes(mot), `${marque} : ${l.reference} absente du filtre « ${mot} »`);
    // le filtre serveur reste plus étroit que le texte entier
    assert.ok(lignes.filter((l) => marqueRecherche(l).includes(mot)).length <= lignes.filter((l) => l.recherche.includes(mot)).length);
  }
});

const fusionnerLectures = (...a) => requete.fusionnerLectures(...a);
const mk = (n, debut = 0) => Array.from({ length: n }, (_, i) => ({ id: `id${debut + i}` }));

test('fusionnerLectures : première lecture non tronquée → gardée telle quelle', () => {
  const r = fusionnerLectures(mk(3), null, 5);
  assert.equal(r.lignes.length, 3);
  assert.deepEqual([r.tronque, r.ciblee], [false, false]);
  // une seconde lecture fournie malgré tout est ignorée tant que la première n'est pas tronquée
  assert.equal(fusionnerLectures(mk(3), mk(2, 10), 5).lignes.length, 3);
});

test('fusionnerLectures : tronquée sans seconde lecture (pas de mot de modèle, ou échec)', () => {
  const r = fusionnerLectures(mk(5), null, 5);
  assert.deepEqual([r.lignes.length, r.tronque, r.ciblee], [5, true, false]);
});

test('fusionnerLectures : tronquée + seconde lecture complète → fusion sans doublon, ciblée', () => {
  const r = fusionnerLectures(mk(5), [...mk(2, 3), ...mk(2, 20)], 5);
  assert.equal(r.lignes.length, 7);
  assert.equal(new Set(r.lignes.map((l) => l.id)).size, 7);
  assert.deepEqual([r.tronque, r.ciblee], [true, true]);
});

test('fusionnerLectures : seconde lecture elle-même tronquée → pas ciblée', () => {
  const r = fusionnerLectures(mk(5), mk(5, 100), 5);
  assert.deepEqual([r.lignes.length, r.tronque, r.ciblee], [10, true, false]);
});

test('fusionnerLectures : entrées non tableaux, ne modifie pas ses entrées', () => {
  assert.deepEqual(fusionnerLectures(null, null, 5), { lignes: [], tronque: false, ciblee: false });
  const a = mk(5);
  const copie = JSON.stringify(a);
  fusionnerLectures(a, mk(1, 9), 5);
  assert.equal(JSON.stringify(a), copie);
});

// ---- Affichage : date du relevé et message d'une saisie qui ne retient rien ----

const jour = (iso) => new Date(`${iso}T12:00:00`);

test('libelleDateReleve : sans année dans l’année en cours, âge au-delà de 7 jours', () => {
  const now = jour('2026-11-13');
  assert.equal(libelleDateReleve(jour('2026-11-13').toISOString(), now), 'au relevé du 13/11');
  assert.equal(libelleDateReleve(jour('2026-11-06').toISOString(), now), 'au relevé du 06/11');
  assert.equal(libelleDateReleve(jour('2026-11-05').toISOString(), now), 'au relevé du 05/11 (il y a 8 jours)');
  assert.equal(libelleDateReleve(jour('2026-02-01').toISOString(), now), 'au relevé du 01/02 (il y a 285 jours)');
});

test('libelleDateReleve : année affichée au-delà de 300 jours ou hors de l’année en cours', () => {
  assert.equal(libelleDateReleve(jour('2025-11-12').toISOString(), jour('2026-11-13')), 'au relevé du 12/11/2025 (il y a 366 jours)');
  assert.equal(libelleDateReleve(jour('2025-12-30').toISOString(), jour('2026-01-02')), 'au relevé du 30/12/2025');
  assert.equal(libelleDateReleve(jour('2026-01-02').toISOString(), jour('2026-11-30')), 'au relevé du 02/01/2026 (il y a 332 jours)');
});

test('libelleDateReleve : date absente, illisible ou dans le futur', () => {
  const now = jour('2026-11-13');
  for (const v of [null, undefined, '', 'n’importe quoi', 12]) assert.equal(libelleDateReleve(v, now), 'relevé non daté');
  assert.equal(libelleDateReleve(jour('2026-11-20').toISOString(), now), 'au relevé du 20/11');
});

test('messageSaisieSansResultat : pièces citées d’abord, sinon pièces de la marque, accord au pluriel', () => {
  assert.equal(messageSaisieSansResultat({ citees: 21, memeMarque: 98 }), 'Aucune pièce ne correspond à cette saisie. 21 pièces citées pour ce modèle sans filtre :');
  assert.equal(messageSaisieSansResultat({ citees: 1, memeMarque: 98 }), 'Aucune pièce ne correspond à cette saisie. 1 pièce citée pour ce modèle sans filtre :');
  assert.equal(messageSaisieSansResultat({ citees: 0, memeMarque: 98 }), 'Aucune pièce ne correspond à cette saisie. 98 pièces de la marque sans filtre :');
  assert.equal(messageSaisieSansResultat({ citees: 0, memeMarque: 1 }), 'Aucune pièce ne correspond à cette saisie. 1 pièce de la marque sans filtre :');
});
