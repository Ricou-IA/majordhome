// scripts/specs-canonical-fields.test.mjs
// canonicalFieldsForCategory (src/shared/specs/index.js) : champs de schéma d'une catégorie pour les caractéristiques d'un devis.
// index.js importe ses schémas sans extension (résolution Vite) : un hook de résolution minimal l'accepte sous Node.
// Run : node --test scripts/specs-canonical-fields.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.')) return next(specifier + '.js', context); throw e; }
}`));

const { canonicalFieldsForCategory } = await import('../src/shared/specs/index.js');

test('poêle : liste non vide, sans champ documents', () => {
  const champs = canonicalFieldsForCategory('poele');
  assert.ok(champs.length > 0);
  assert.ok(champs.every((f) => f.group !== 'documents'));
});

test('batterie et photovoltaïque ont aussi leur schéma', () => {
  assert.ok(canonicalFieldsForCategory('batterie').length > 0);
  assert.ok(canonicalFieldsForCategory('photovoltaique').length > 0);
});

test('catégorie sans schéma ou nulle : liste vide', () => {
  assert.deepEqual(canonicalFieldsForCategory('climatisation'), []);
  assert.deepEqual(canonicalFieldsForCategory(null), []);
});

// --- Performances CEE (fiche BAR-TH-112) et sortie des fumées — 2026-11-28 ---
const { lignesCaracteristiques } = await import('../src/lib/devisCaracteristiques.js');

test('poêle : les champs CEE viennent en tête, dans cet ordre', () => {
  const cles = canonicalFieldsForCategory('poele').map((f) => f.key);
  assert.deepEqual(cles.slice(0, 8), ['fuel_type', 'etas_pct', 'pm_mg_nm3', 'cog_mgc_nm3', 'co_mg_nm3', 'nox_mg_nm3', 'norme_mesure', 'flamme_verte']);
});

test('poêle : position de la sortie des fumées juste après son diamètre', () => {
  const cles = canonicalFieldsForCategory('poele').map((f) => f.key);
  assert.equal(cles.indexOf('flue_outlet_position'), cles.indexOf('flue_outlet_diameter_mm') + 1);
});

test('poêle : champs CEE visibles pour tous les combustibles', () => {
  const champs = canonicalFieldsForCategory('poele').filter((f) => f.group === 'cee');
  assert.equal(champs.length, 8);
  assert.ok(champs.every((f) => ['bois', 'granules', 'hybride'].every((c) => f.applies_to.includes(c))));
});

test('poêle CEE : Etas et émissions imprimés en tête, unités en toutes lettres', () => {
  const champsPoele = canonicalFieldsForCategory('poele');
  const lignes = lignesCaracteristiques({ category: 'poele', specs: { canonical: {
    power_nominal_kw: 8, fuel_type: 'bois', etas_pct: 67, pm_mg_nm3: 30, cog_mgc_nm3: 100,
    co_mg_nm3: 1250, nox_mg_nm3: 160, norme_mesure: 'EN 16510-1', flamme_verte: true,
    flue_outlet_diameter_mm: 150, flue_outlet_position: 'Dessus' } } }, champsPoele);
  assert.equal(lignes[0], 'Combustible : Bois');
  assert.equal(lignes[1], 'Efficacité énergétique saisonnière (Etas) : 67 %');
  assert.ok(lignes.includes('Particules (13 % O2) : 30 mg/Nm³'));
  assert.ok(lignes.includes('COG (13 % O2) : 100 mgC/Nm³'));
  assert.ok(lignes.includes('Norme de mesure : EN 16510-1'));
  assert.ok(lignes.includes('Flamme Verte : oui'));
  assert.ok(lignes.includes('Sortie des fumées : Dessus'));
  assert.ok(lignes.indexOf('Sortie des fumées : Dessus') > lignes.indexOf('Puissance nominale : 8 kW'));
});

test('poêle : alias CEE trop larges retirés (relecture 2026-11-28)', async () => {
  const { matchLabelToCanonicalKey } = await import('../src/shared/specs/poele.schema.js');
  assert.notEqual(matchLabelToCanonicalKey('CO à 13 % O2'), 'co_mg_nm3'); // souvent donné en %
  assert.notEqual(matchLabelToCanonicalKey('Émissions de poussières fines'), 'pm_mg_nm3'); // référence d'O2 inconnue
  assert.notEqual(matchLabelToCanonicalKey('Énergie'), 'fuel_type');
  assert.equal(matchLabelToCanonicalKey('Etas'), 'etas_pct');
  assert.equal(matchLabelToCanonicalKey('NOx'), 'nox_mg_nm3');
});
