// Tests des règles du lecteur de documents d'appareil (src/lib/catalogue/documentsAppareil.js).
// node --test scripts/catalogue/documents-appareil.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { natureDocument, ongletsAtelier, ongletActif, vuesDeclarees, PART_DOCUMENT, bornerPartDocument,
  MAX_PIXELS_CANVAS, echelleRendu, texteDePagePdf, normaliserRecherchePdf } from '../../src/lib/catalogue/documentsAppareil.js';

test('natureDocument', () => {
  assert.equal(natureDocument({ mime_type: 'application/pdf' }), 'pdf');
  assert.equal(natureDocument({ storage_path: 'a/b/doc-1.PDF' }), 'pdf');
  assert.equal(natureDocument({ file_name: 'vue.webp' }), 'image');
  assert.equal(natureDocument({ file_name: 'cablage.docx' }), 'autre');
});
test('ongletsAtelier : vues d\'abord, procédures en dernier, rien d\'absent', () => {
  const o = ongletsAtelier({ vues: [{ url: 'u1' }, { url: 'u2' }], documents: [{ id: 'p', document_type: 'procedure', label: 'Mise en service' }, { id: 'n', document_type: 'notice', label: 'Notice' }] });
  assert.deepEqual(o.map((x) => x.id), ['vue:0', 'vue:1', 'doc:n', 'doc:p']);
  assert.equal(o[0].libelle, 'Vue éclatée 1/2');
  assert.deepEqual(ongletsAtelier({ vues: [], documents: [] }), []);
});
test('ongletsAtelier : une seule vue, libellés et types', () => {
  const o = ongletsAtelier({ vues: [{ url: 'u', width: 10, height: 5 }], documents: [{ id: 'n', document_type: 'notice', label: 'Notice' }, { id: 'x', document_type: 'autre', label: 'Schéma' }] });
  assert.equal(o[0].libelle, 'Vue éclatée');
  assert.deepEqual(o[0].source, { kind: 'vue', url: 'u', width: 10, height: 5 });
  assert.equal(o[1].libelle, 'Notice technique');
  assert.equal(o[1].type, 'notice');
  assert.equal(o[2].type, 'autre');
});
test('ongletsAtelier : vue tirée de la notice signalée', () => {
  const o = ongletsAtelier({ vues: [{ url: 'a', origine: 'site' }, { url: 'b', origine: 'notice', page: 12 }] });
  assert.deepEqual(o.map((x) => x.vueDeNotice), [false, true]);
});
test('ongletActif : demandé s\'il existe, sinon le premier, sinon rien', () => {
  const o = [{ id: 'vue:0' }, { id: 'doc:n' }];
  assert.equal(ongletActif(o, 'doc:n').id, 'doc:n');
  assert.equal(ongletActif(o, 'doc:disparu').id, 'vue:0');
  assert.equal(ongletActif(o, null).id, 'vue:0');
  assert.equal(ongletActif([], 'vue:0'), null);
  assert.equal(ongletActif(undefined, null), null);
});
test('vuesDeclarees : vues avec chemin seulement', () => {
  assert.equal(vuesDeclarees({ exploded_views: [{ path: 'a' }, { url: 'x' }, null, { path: 'b' }] }), 2);
  assert.equal(vuesDeclarees({}), 0);
  assert.equal(vuesDeclarees(null), 0);
});
test('bornerPartDocument : bornes 30 % – 75 %, départ 60 %', () => {
  assert.equal(PART_DOCUMENT.defaut, 0.6);
  assert.equal(bornerPartDocument(0.5), 0.5);
  assert.equal(bornerPartDocument(0.1), 0.3);
  assert.equal(bornerPartDocument(0.9), 0.75);
  assert.equal(bornerPartDocument(Number.NaN), 0.6);
  assert.equal(bornerPartDocument(undefined), 0.6);
});

test('echelleRendu : densité d’écran tant que le canvas tient sous 16 Mpx', () => {
  assert.equal(MAX_PIXELS_CANVAS, 16777216);
  assert.equal(echelleRendu({ largeur: 800, hauteur: 1131, zoom: 1, dpr: 2 }), 2);
  assert.equal(echelleRendu({ largeur: 800, hauteur: 1131, dpr: undefined }), 1);
});
test('echelleRendu : zoom 4 sur tablette plafonné à 16 Mpx, taille CSS inchangée', () => {
  // ~1000 px CSS de large × 4 × densité 2 = 31 Mpx sans plafond
  const p = { largeur: 1000, hauteur: 1414, zoom: 4, dpr: 2 };
  const e = echelleRendu(p);
  assert.ok(e < 2);
  const w = Math.floor(p.largeur * p.zoom * e);
  const h = Math.floor(p.hauteur * p.zoom * e);
  assert.ok(w * h <= MAX_PIXELS_CANVAS, `${w}×${h} = ${w * h}`);
  assert.ok(w * h > MAX_PIXELS_CANVAS * 0.99);
  assert.ok(echelleRendu({ ...p, maxPixels: 1e6 }) < e);
});
test('echelleRendu : valeurs absurdes → densité d’écran', () => {
  assert.equal(echelleRendu({ largeur: 0, hauteur: 0, zoom: 1, dpr: 2 }), 2);
  assert.equal(echelleRendu({ largeur: Number.NaN, hauteur: 10, dpr: 1.5 }), 1.5);
});
const el = (str, x, y = 100, width = str.length * 5) => ({ str, transform: [1, 0, 0, 1, x, y], width });
test('texteDePagePdf : jamais deux espaces de suite', () => {
  const { texte } = texteDePagePdf([el('Joint ', 0), el(' ', 40), el('  de   porte', 60), el('', 200), el('Écrou', 0, 80)]);
  assert.equal(texte, 'joint de porte ecrou');
  assert.ok(!/ {2}/.test(texte));
});
test('texteDePagePdf : éléments collés sur la même ligne, segments sur les indices d’origine', () => {
  const { texte, segments } = texteDePagePdf([el('Ré', 0, 100, 10), el('f', 10, 100, 5), el('   ', 15), el('42', 30)]);
  assert.equal(texte, 'ref 42');
  assert.deepEqual(segments.map((s) => s.item), [0, 1, 3]);
  assert.deepEqual(segments[2], { item: 3, debut: 4, fin: 6 });
});
test('normaliserRecherchePdf : même normalisation que le texte', () => {
  assert.equal(normaliserRecherchePdf('  Joint  de  PORTE '), 'joint de porte');
  assert.equal(normaliserRecherchePdf(undefined), '');
  const { texte } = texteDePagePdf([el('Joint  de porte', 0)]);
  assert.ok(texte.includes(normaliserRecherchePdf('joint de  porte')));
});
