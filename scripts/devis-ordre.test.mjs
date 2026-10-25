// scripts/devis-ordre.test.mjs
// Réordonner un devis par glisser-déposer (src/lib/devisOrdre.js) — chapitres et lignes (demande d'Eric, 2026-10-25 :
// « mieux en drag and drop plutôt qu'avec les + − »). Le devis reste une liste plate : titre de chapitre puis ses lignes.
// Run : node --test scripts/devis-ordre.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocs, aplatir, deplacerLigne, deplacerChapitre } from '../src/lib/devisOrdre.js';

const T = (d) => ({ line_type: 'section_title', designation: d });
const L = (d) => ({ line_type: 'product', designation: d });
const noms = (lines) => lines.map((l) => (l.line_type === 'section_title' ? `#${l.designation}` : l.designation));
const devis = [L('orpheline'), T('EQ'), L('borne'), T('SECU'), L('diff'), L('disj'), L('rj45'), T('POSE'), L('pose'), L('mes')];

test('blocs / aplatir : aller-retour exact, lignes avant le premier chapitre dans un bloc sans titre', () => {
  const b = blocs(devis);
  assert.equal(b.length, 4);
  assert.equal(b[0].titre, null);
  assert.deepEqual(b[2].lignes.map((l) => l.designation), ['diff', 'disj', 'rj45']);
  assert.deepEqual(noms(aplatir(b)), noms(devis));
  assert.deepEqual(blocs([]), []);
});

test('deplacerLigne : dans un chapitre, et d\'un chapitre à un autre', () => {
  assert.deepEqual(noms(deplacerLigne(devis, { deBloc: 2, deRang: 2, versBloc: 2, versRang: 0 })),
    ['orpheline', '#EQ', 'borne', '#SECU', 'rj45', 'diff', 'disj', '#POSE', 'pose', 'mes']);
  assert.deepEqual(noms(deplacerLigne(devis, { deBloc: 2, deRang: 0, versBloc: 3, versRang: 2 })),
    ['orpheline', '#EQ', 'borne', '#SECU', 'disj', 'rj45', '#POSE', 'pose', 'mes', 'diff']);
  assert.deepEqual(noms(deplacerLigne(devis, { deBloc: 1, deRang: 0, versBloc: 2, versRang: 1 })),
    ['orpheline', '#EQ', '#SECU', 'diff', 'borne', 'disj', 'rj45', '#POSE', 'pose', 'mes'], 'un chapitre peut se vider');
});

test('deplacerChapitre : le chapitre part avec ses lignes, le bloc sans titre reste en tête', () => {
  // rangs = chapitres titrés seulement (0 = EQ, 1 = SECU, 2 = POSE)
  assert.deepEqual(noms(deplacerChapitre(devis, 2, 0)),
    ['orpheline', '#POSE', 'pose', 'mes', '#EQ', 'borne', '#SECU', 'diff', 'disj', 'rj45']);
  assert.deepEqual(noms(deplacerChapitre(devis, 0, 2)),
    ['orpheline', '#SECU', 'diff', 'disj', 'rj45', '#POSE', 'pose', 'mes', '#EQ', 'borne']);
});

test('déplacement hors bornes ou sur place : liste inchangée (même contenu), jamais d\'exception', () => {
  assert.deepEqual(noms(deplacerLigne(devis, { deBloc: 9, deRang: 0, versBloc: 1, versRang: 0 })), noms(devis));
  assert.deepEqual(noms(deplacerChapitre(devis, 1, 1)), noms(devis));
  assert.deepEqual(noms(deplacerChapitre(devis, 5, 0)), noms(devis));
});
