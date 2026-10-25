// scripts/devis-ordre.test.mjs
// Réordonner un devis par glisser-déposer (src/lib/devisOrdre.js) — chapitres et lignes (demande d'Eric, 2026-10-25 :
// « mieux en drag and drop plutôt qu'avec les + − »). Le devis reste une liste plate : titre de chapitre puis ses lignes.
// Run : node --test scripts/devis-ordre.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocs, aplatir, deplacerLigne, deplacerChapitre, reclasserDansSections } from '../src/lib/devisOrdre.js';

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

test('changer d\'installation : aucune ligne perdue, rangées par titre puis par type, chapitre sans place gardé', () => {
  const avant = { EQUIPEMENT: 'equipement', OPTIONS: 'option', 'POSE ET MISE EN SERVICE': 'main_oeuvre', FUMISTERIE: 'fumisterie' };
  const apres = { 'POMPE A CHALEUR': 'equipement', ACCESSOIRES: 'option', 'POSE ET MISE EN SERVICE': 'main_oeuvre', 'MATERIEL ELECTRIQUE': 'stock' };
  const lignes = [L('orpheline'), T('EQUIPEMENT'), L('UE'), L('UI'), T('OPTIONS'), L('filtre'), T('POSE ET MISE EN SERVICE'), L('pose'), T('FUMISTERIE'), L('tubage'), T('VIDE')];
  const r = reclasserDansSections(lignes, Object.keys(apres).map(T), { typeAvant: (t) => avant[t] || 'equipement', typeApres: (t) => apres[t] });
  assert.deepEqual(noms(r), ['orpheline', '#POMPE A CHALEUR', 'UE', 'UI', '#ACCESSOIRES', 'filtre', 'tubage', '#POSE ET MISE EN SERVICE', 'pose', '#MATERIEL ELECTRIQUE']);
  // toutes les lignes sont là
  assert.equal(r.filter((l) => l.line_type !== 'section_title').length, lignes.filter((l) => l.line_type !== 'section_title').length);
});

test('changer d\'installation : un chapitre sans type acceptable est gardé en fin de devis', () => {
  const r = reclasserDansSections([T('MO'), L('pose')], [T('POELE')], { typeAvant: () => 'main_oeuvre', typeApres: () => 'equipement' });
  assert.deepEqual(noms(r), ['#POELE', '#MO', 'pose']);
});
