// scripts/aspirateur/edges.test.mjs — contrôles statiques des edges de l'aspirateur (lecture des sources, pas d'exécution).
// Run : node --test scripts/aspirateur/edges.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CODES_ASPIRATEUR } from '../../src/lib/aspirateur/codes.js';

const lire = (nom) => readFileSync(new URL(`../../supabase/functions/${nom}/index.ts`, import.meta.url), 'utf8');
/** Codes rendus : `error: "xxx"` ou `erreur("xxx"` dans la source. */
const codesRendus = (src) => [...src.matchAll(/(?:error:\s*|erreur\()\s*["']([a-z_]+)["']/g)].map((m) => m[1]);

test('relais modèle : secret partagé, aucun outil serveur, codes connus', () => {
  const src = lire('fournisseur-aspirer-modele');
  assert.match(src, /requireSharedSecret\(/);
  assert.match(src, /MDH_ASPIRATEUR_KEY/);
  assert.match(src, /outilsValides\(/);
  assert.match(src, /parametresModele\(/);
  assert.doesNotMatch(src, /web_search|web_fetch|code_execution/);
  for (const code of codesRendus(src)) assert.ok(Object.hasOwn(CODES_ASPIRATEUR, code), `code inconnu : ${code}`);
});

test('config : verify_jwt du relais à false', () => {
  const toml = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(toml, /\[functions\.fournisseur-aspirer-modele\]\s*\nverify_jwt = false/);
});

test('écran et retour (quand ils existent) : authentification, codes connus', () => {
  for (const [nom, motif] of [['fournisseur-aspirer', /requiredRole:\s*["']org_admin["']/], ['fournisseur-aspirer-retour', /requireSharedSecret\(/]]) {
    if (!existsSync(new URL(`../../supabase/functions/${nom}/index.ts`, import.meta.url))) continue;
    const src = lire(nom);
    assert.match(src, motif, nom);
    assert.doesNotMatch(src, /console\.(log|info|warn|error)\([^)]*acces/i, `${nom} journalise des accès`);
    for (const code of codesRendus(src)) assert.ok(Object.hasOwn(CODES_ASPIRATEUR, code), `${nom} : code inconnu ${code}`);
  }
});

test('copies du service VPS identiques à leur source (node scripts/sync-aspirateur.mjs)', async () => {
  const { FICHIERS_ASPIRATEUR } = await import('../sync-aspirateur.mjs');
  for (const { source, cible } of FICHIERS_ASPIRATEUR) {
    const norm = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(norm(cible), norm(source), `${cible} diverge : relancer node scripts/sync-aspirateur.mjs`);
  }
});
