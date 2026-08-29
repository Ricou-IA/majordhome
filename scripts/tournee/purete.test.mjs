// scripts/tournee/purete.test.mjs
// Run : node --test scripts/tournee/purete.test.mjs
//
// Garde-fou : le moteur de tournées est destiné à être injecté tel quel dans le
// bundle des edge functions (Deno). Tout import d'alias Vite, de React ou de
// Supabase le rendrait inutilisable côté serveur — et rien d'autre ne le
// détecterait, puisque le front résout ces alias sans erreur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOSSIER = join(process.cwd(), 'src', 'lib', 'tournee');
const INTERDITS = [/from\s+['"]@/, /from\s+['"]react/, /from\s+['"]@supabase/];

test('aucun fichier du moteur n importe d alias, de React ou de Supabase', () => {
  const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.js'));
  assert.ok(fichiers.length > 0, 'le dossier du moteur ne doit pas etre vide');

  for (const fichier of fichiers) {
    const source = readFileSync(join(DOSSIER, fichier), 'utf8');
    for (const motif of INTERDITS) {
      assert.equal(motif.test(source), false, `${fichier} contient un import interdit (${motif})`);
    }
  }
});

test('tous les imports relatifs portent une extension .js (contrainte Deno)', () => {
  const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.js'));
  for (const fichier of fichiers) {
    const source = readFileSync(join(DOSSIER, fichier), 'utf8');
    const imports = source.match(/from\s+['"](\.[^'"]+)['"]/g) || [];
    for (const imp of imports) {
      assert.match(imp, /\.js['"]$/, `${fichier} : import sans extension .js → ${imp}`);
    }
  }
});
