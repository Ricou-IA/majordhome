// node --test scripts/page-publique.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teintesDeMarque, prenomLisible, contraste, ACCENT_NEUTRE } from '../src/lib/pagePublique.js';

test('teintesDeMarque — couleur absente ou illisible : teinte neutre, texte blanc', () => {
  for (const c of [null, undefined, '', 'orange', '#12', 'rgb(1,2,3)']) {
    const t = teintesDeMarque(c);
    assert.equal(t.accent, ACCENT_NEUTRE);
    assert.equal(t.surAccent, '#ffffff');
  }
});

test('teintesDeMarque — accepte #rgb, #rrggbb, sans dièse, en capitales', () => {
  assert.equal(teintesDeMarque('#F60').accent, '#ff6600');
  assert.equal(teintesDeMarque('0284C7').accent, '#0284c7');
});

test('teintesDeMarque — le texte posé sur la couleur se lit toujours', () => {
  // Couleurs sombres : blanc. Couleurs claires (orange, jaune) : sombre.
  assert.equal(teintesDeMarque('#0f172a').surAccent, '#ffffff');
  assert.equal(teintesDeMarque('#0369a1').surAccent, '#ffffff');
  assert.equal(teintesDeMarque('#f59e0b').surAccent, '#020617');
  assert.equal(teintesDeMarque('#fde047').surAccent, '#020617');
  for (const c of ['#000', '#fff', '#e8731c', '#f59e0b', '#22c55e', '#0284c7', '#7c3aed', '#64748b', '#ef4444']) {
    const t = teintesDeMarque(c);
    assert.ok(contraste(t.accent, t.surAccent) >= 4.5, `${c} : ${contraste(t.accent, t.surAccent).toFixed(2)}`);
  }
});

test('teintesDeMarque — fond doux : très clair, texte sombre lisible dessus', () => {
  for (const c of ['#000', '#e8731c', '#0284c7', '#7c3aed']) {
    const { doux } = teintesDeMarque(c);
    assert.match(doux, /^#[0-9a-f]{6}$/);
    assert.ok(contraste(doux, '#0f172a') >= 12, `${c} → ${doux}`);
  }
  assert.equal(teintesDeMarque('#fff').doux, '#ffffff');
});

test('prenomLisible — capitales et minuscules deviennent un prénom', () => {
  assert.equal(prenomLisible('JULIEN'), 'Julien');
  assert.equal(prenomLisible('julien'), 'Julien');
  assert.equal(prenomLisible('JEAN-PIERRE'), 'Jean-Pierre');
  assert.equal(prenomLisible('  marie   claire '), 'Marie Claire');
  assert.equal(prenomLisible('ÉLODIE'), 'Élodie');
  assert.equal(prenomLisible("D'ARTAGNAN"), "D'Artagnan");
});

test('prenomLisible — casse mixte conservée, vide rendu vide', () => {
  assert.equal(prenomLisible('McKenzie'), 'McKenzie');
  assert.equal(prenomLisible('Jean-Pierre'), 'Jean-Pierre');
  assert.equal(prenomLisible(null), '');
  assert.equal(prenomLisible('   '), '');
});
