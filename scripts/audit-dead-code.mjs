#!/usr/bin/env node
/**
 * audit-dead-code.mjs — Détecte les fichiers sources jamais importés
 * ============================================================================
 * Lance : `npm run audit:dead-code`
 *
 * Heuristique simple :
 * 1. Liste tous les .js / .jsx / .ts / .tsx de src/
 * 2. Pour chaque fichier, grep des imports/from pointant vers son basename
 *    dans le reste du codebase
 * 3. Si 0 référence (hors self-import), c'est un candidat orphelin
 *
 * Exclusions : index, routes, App, main, setup, config, *.test, *.spec,
 * fichiers de pages (auto-routés), workers, types.
 *
 * Limites :
 * - Faux positifs si import par chemin absolu de package ou via aliasing
 *   exotique. Vérifier manuellement avant suppression.
 * - Ne détecte pas les exports inutilisés AU SEIN d'un fichier utilisé
 *   (utiliser ESLint no-unused-vars pour ça).
 *
 * Codes de sortie :
 *   0 — aucun orphelin
 *   1 — orphelins détectés (utile en CI pour fail si du code mort apparaît)
 * ============================================================================
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const IGNORE_BASENAMES = new Set([
  'index', 'routes', 'App', 'main', 'setup',
]);
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', 'public']);
const IGNORE_PATH_PATTERNS = [
  /\.test\./, /\.spec\./, /pages[/\\][^/\\]+\.(js|jsx)$/,
  /\.config\./, /\.d\.ts$/, /worker/i,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (EXTENSIONS.has(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

function shouldIgnore(file) {
  const name = basename(file, extname(file));
  if (IGNORE_BASENAMES.has(name)) return true;
  const rel = relative(ROOT, file);
  return IGNORE_PATH_PATTERNS.some((p) => p.test(rel));
}

function isReferenced(targetFile, allFiles) {
  const name = basename(targetFile, extname(targetFile));
  // Cherche `(from|import)\s+['"\`].*[/.]${name}(\.ext)?['"\`/]`
  // Le délimiteur de fin (['"\`/] OR EOL) évite les faux positifs où `name`
  // est sous-chaîne d'un identifiant plus long (ex `CardSkeleton` matche
  // dans `ClientCardSkeleton` sans cette borne).
  const re = new RegExp(
    `(?:from|import)\\s*[(]?\\s*['"\`][^'"\`]*[/.]${name}(?:\\.[a-z]+)?['"\`/]`,
  );
  for (const other of allFiles) {
    if (other === targetFile) continue;
    try {
      const content = readFileSync(other, 'utf8');
      if (re.test(content)) return true;
    } catch {
      // Skip read errors
    }
  }
  return false;
}

// Whitelist : fichiers récemment créés non encore propagés.
// À retirer une fois les imports en place.
const ALLOW_ORPHAN = new Set([
  'src/lib/logger.js', // P1.7 — wrapper créé, migration au fil de l'eau
]);

const allFiles = walk(SRC);
const orphans = [];

for (const file of allFiles) {
  if (shouldIgnore(file)) continue;
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (ALLOW_ORPHAN.has(rel)) continue;
  if (!isReferenced(file, allFiles)) {
    const loc = readFileSync(file, 'utf8').split('\n').length;
    orphans.push({ file: rel, loc });
  }
}

if (orphans.length === 0) {
  console.log('✅ Aucun fichier orphelin détecté.');
  process.exit(0);
}

console.log(`⚠️  ${orphans.length} fichier(s) orphelin(s) détecté(s) :\n`);
let totalLoc = 0;
for (const { file, loc } of orphans.sort((a, b) => b.loc - a.loc)) {
  console.log(`  ${String(loc).padStart(5)} LOC  ${file}`);
  totalLoc += loc;
}
console.log(`\n  Total : ${totalLoc} LOC de code potentiellement mort.`);
console.log(`\n  ⚠️  Vérifier manuellement avant suppression (faux positifs possibles via aliasing).`);
process.exit(1);
