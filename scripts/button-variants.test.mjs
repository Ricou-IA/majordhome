import test from 'node:test';
import assert from 'node:assert/strict';
import { buttonVariants } from '../src/components/ui/buttonVariants.js';

test('alias de variantes : les anciens noms rendent les nouveaux', () => {
  assert.equal(buttonVariants({ variant: 'default' }), buttonVariants({ variant: 'primary' }));
  assert.equal(buttonVariants({ variant: 'outline' }), buttonVariants({ variant: 'secondary' }));
  assert.equal(buttonVariants({ variant: 'destructive' }), buttonVariants({ variant: 'danger' }));
  assert.equal(buttonVariants({}), buttonVariants({ variant: 'primary', size: 'md' }));
});

test('alias de tailles', () => {
  assert.equal(buttonVariants({ size: 'default' }), buttonVariants({ size: 'md' }));
  assert.equal(buttonVariants({ size: 'lg' }), buttonVariants({ size: 'md' }));
});

test('valeur inconnue : repli sur primary / md, sans erreur', () => {
  assert.equal(buttonVariants({ variant: 'followup', size: 'xl' }), buttonVariants({ variant: 'primary', size: 'md' }));
});

test('styles de la direction artistique', () => {
  assert.match(buttonVariants({ variant: 'primary' }), /bg-primary-600/);
  assert.match(buttonVariants({ variant: 'primary' }), /hover:bg-primary-700/);
  assert.match(buttonVariants({ variant: 'danger' }), /text-st-alerte/);
  assert.match(buttonVariants({ variant: 'danger' }), /hover:bg-st-alerte-bg/);
  assert.match(buttonVariants({ size: 'md' }), /h-\[38px\]/);
  assert.match(buttonVariants({ size: 'sm' }), /h-8/);
  assert.match(buttonVariants({}), /disabled:opacity-50/);
  assert.match(buttonVariants({}), /disabled:pointer-events-none/);
});

test('className passe en dernier', () => {
  assert.match(buttonVariants({ className: 'w-full' }), /w-full$/);
});
