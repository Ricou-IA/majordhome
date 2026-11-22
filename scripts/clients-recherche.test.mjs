// Recherche de clients sans accent (migration 20261122_3) : le service interroge la colonne
// `recherche` de la vue avec un terme normalisé comme `lower(unaccent(...))`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliser } from '../src/lib/catalogue/recherchePieces.js';

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8');

test('un terme saisi avec ou sans accent donne la même recherche', () => {
  assert.equal(normaliser('Hélène'), 'helene');
  assert.equal(normaliser('helene'), 'helene');
  assert.equal(normaliser('JÉRÔME'), 'jerome');
  assert.equal(normaliser('Cœur'), 'coeur');
  assert.equal(normaliser('Saint-Sulpice'), 'saint-sulpice');
});

test('le service cherche nom et ville dans `recherche`, jamais par ilike sur le nom ou la ville', () => {
  const service = lire('../src/shared/services/clients.service.js');
  const recherches = service.match(/`recherche\.ilike\.%\$\{normaliser\(term\)\}%`/g) || [];
  assert.equal(recherches.length, 2, 'la liste des clients et la recherche rapide passent toutes deux par `recherche`');
  assert.ok(!service.includes('display_name.ilike'), 'un ilike sur display_name ne passe pas les accents');
  assert.ok(!service.includes('`city.ilike.%${term}%`'), 'la ville se cherche dans `recherche`');
});

test('la vue des clients porte la colonne `recherche`, en fin de liste', () => {
  const migration = lire('../supabase/migrations/20261122_3_clients_recherche_sans_accent.sql');
  assert.match(migration, /CREATE OR REPLACE VIEW public\.majordhome_clients WITH \(security_invoker = true\)/);
  assert.match(migration, /external_ref,\s+lower\(public\.unaccent\(concat_ws\(' ', display_name, city\)\)\) AS recherche\s+FROM majordhome\.clients/);
});
