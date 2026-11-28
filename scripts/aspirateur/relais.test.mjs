// scripts/aspirateur/relais.test.mjs — règles du relais modèle de l'aspirateur (src/lib/aspirateur/relais.js).
// Run : node --test scripts/aspirateur/relais.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTILS_AGENT, coutUsd, outilsValides, parametresModele } from '../../src/lib/aspirateur/relais.js';

test('coût : tarifs Sonnet 5.5 et Haiku 5.5, cache compris', () => {
  // Sonnet 5.5 : 2 $ / 10 $ par million, lecture de cache 0,10 $, écriture de cache 1,25 × entrée
  assert.equal(coutUsd('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 }), 3);
  assert.equal(coutUsd('claude-sonnet-5-5', { cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }), 2.6);
  // Haiku 5.5 : 0,10 $ / 0,50 $
  assert.equal(coutUsd('claude-haiku-5-5', { input_tokens: 2_000_000, output_tokens: 1_000_000 }), 0.7);
});

test('coût : modèle inconnu (repli) compté au tarif le plus haut connu, jamais à zéro', () => {
  assert.ok(coutUsd('claude-inconnu', { input_tokens: 1_000_000 }) >= 5);
  assert.equal(coutUsd('claude-haiku-5-5', null), 0);
});

test('outils : seuls les six outils de l’agent, sans outil serveur', () => {
  const t = OUTILS_AGENT.map((name) => ({ name, description: 'x', input_schema: { type: 'object', properties: {} } }));
  assert.equal(outilsValides(t), true);
  assert.equal(outilsValides(undefined), true);
  assert.equal(outilsValides([...t, { name: 'executer_code', description: 'x', input_schema: { type: 'object' } }]), false);
  assert.equal(outilsValides([{ type: 'web_search_20260209', name: 'web_search' }]), false);
  assert.equal(outilsValides([{ name: 'aller', type: 'bash_20250124' }]), false);
  assert.equal(outilsValides('aller'), false);
});

test('paramètres : modèle fixé par l’usage, effort, plafond de tokens, repli de refus pour Sonnet', () => {
  const p = parametresModele('apprendre', { system: 's', messages: [{ role: 'user', content: 'x' }], max_tokens: 99_999 }, {});
  assert.equal(p.model, 'claude-sonnet-5-5');
  assert.equal(p.max_tokens, 4000);
  assert.deepEqual(p.output_config, { effort: 'medium' });
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.fallbacks, 'default');
  assert.equal(p.thinking, undefined);
  const l = parametresModele('lire', { system: 's', messages: [] }, {});
  assert.equal(l.model, 'claude-haiku-5-5');
  assert.deepEqual(l.output_config, { effort: 'low' });
  assert.equal(l.fallbacks, undefined);
  assert.equal(parametresModele('apprendre', { system: 's', messages: [] }, { apprendre: 'claude-opus-5-5' }).model, 'claude-opus-5-5');
  assert.equal(parametresModele('autre', { system: 's', messages: [] }, {}), null);
});
