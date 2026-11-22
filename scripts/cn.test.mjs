import test from 'node:test';
import assert from 'node:assert/strict';
import { cn } from '../src/lib/classes.js';
import { buttonVariants } from '../src/components/ui/buttonVariants.js';

test('une taille de texte sur mesure ne chasse pas la couleur du texte', () => {
  assert.equal(cn('text-body-sm text-white'), 'text-body-sm text-white');
  assert.equal(cn('text-body-sm', 'text-st-alerte'), 'text-body-sm text-st-alerte');
});

test('deux tailles sur mesure : la dernière gagne', () => {
  assert.equal(cn('text-body-sm', 'text-cell'), 'text-cell');
});

test('une taille sur mesure remplace une taille standard, et inversement', () => {
  assert.equal(cn('text-sm', 'text-body'), 'text-body');
  assert.equal(cn('text-body', 'text-lg'), 'text-lg');
});

test('les neuf tailles sur mesure sont connues', () => {
  for (const t of ['caption', 'label', 'body-sm', 'cell', 'body', 'section', 'count', 'title', 'kpi']) {
    assert.equal(cn(`text-${t} text-white`), `text-${t} text-white`, t);
  }
});

test('un bouton garde sa taille de texte et son ombre après cn()', () => {
  for (const variant of ['primary', 'secondary', 'ghost', 'link', 'danger']) {
    const sortie = cn(buttonVariants({ variant }));
    assert.match(sortie, /text-body-sm/, variant);
    assert.match(sortie, /focus-visible:shadow-ring/, variant);
  }
  assert.match(cn(buttonVariants({ variant: 'primary' })), /shadow-xs/);
});
