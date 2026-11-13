// Tests des règles du lecteur de documents d'appareil (src/lib/catalogue/documentsAppareil.js).
// node --test scripts/catalogue/documents-appareil.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { natureDocument, ongletsAtelier } from '../../src/lib/catalogue/documentsAppareil.js';

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
