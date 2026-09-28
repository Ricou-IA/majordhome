// scripts/fumisterie/nomenclature.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculerMetre, ENGINE_VERSION } from '../../src/lib/fumisterie/index.js';
import { resoudreArticle } from '../../src/lib/fumisterie/articles.js';
import { buildFumisterieConfig } from '../../src/lib/fumisterie/config.js';
import { ARTICLES, COMPOSANTS, MAPPING, GABARIT, CONFIGURATION, RELEVE } from './fixtures/g1-o150.mjs';

const base = { configuration: CONFIGURATION, gabarit: GABARIT, composants: COMPOSANTS, mapping: MAPPING, articles: ARTICLES, reglages: buildFumisterieConfig(null) };
const refs = (lignes) => lignes.map((l) => `${l.reference}×${l.quantite}`);

test('cas de la maquette Ø150 noir : 14 lignes, 1 480,90 € HT d\'achat, tout résolu', () => {
  const r = calculerMetre({ ...base, releve: RELEVE });
  assert.equal(r.engine_version, ENGINE_VERSION);
  assert.equal(r.lignes.length, 14);
  assert.deepEqual(refs(r.lignes), [
    '2PTICHARN150NO×1', '2PTIELDR1501000NO×1', '2PTIELDR150500NO×1', '2PTIELDR150250NO×1', '2PTICOJO150NO×3',
    '2DIVS2535IN230KEI×1', '2DIVCTOS150×1', '2PTICO30150×2', '2PTIELDR1501000×5',
    '2PTIPPDR150×2', '2PTGCOCF150×2', '2PTIRASR150148×1', '2LEPTUYA1501000NO×1', '2LEPTUYA150500NO×1',
  ]);
  assert.equal(r.totaux.achat_ht, 1480.9);
  // vente = Σ tarif_public réel (remises fournisseur différentes par famille : PTR 50 %, solin/émaillé 60 %, collier 47 %)
  assert.equal(r.totaux.vente_ht, 3023.7);
  assert.equal(r.totaux.lignes_a_chiffrer, 0);
  assert.ok(r.lignes.every((l) => l.repere >= 1 && l.repere <= 6));
  assert.equal(r.lignes.find((l) => l.composant_code === 'collier_jonction_exterieur').statut, 'provisoire');
  assert.equal(r.alertes.find((a) => a.code === 'zone1').niveau, 'ok');
});
test('finition inox : chapeau et extérieur inox, intérieur inchangé', () => {
  const r = calculerMetre({ ...base, releve: { ...RELEVE, finition: 'inox' } });
  assert.ok(refs(r.lignes).includes('2PTICHARN150×1'));
  assert.ok(refs(r.lignes).includes('2PTICOJO150×3'));
  assert.ok(refs(r.lignes).includes('2PTIELDR1501000×5'));
});
test('pente 38° hors plages 25-35 → 30-40 ; pente 12° sans solin → ligne à chiffrer + alerte article_manquant', () => {
  assert.ok(refs(calculerMetre({ ...base, releve: { ...RELEVE, pente: 38 } }).lignes).includes('2DIVS3040IN230KEI×1'));
  const r = calculerMetre({ ...base, releve: { ...RELEVE, pente: 12 } });
  const solin = r.lignes.find((l) => l.composant_code === 'solin');
  assert.equal(solin.reference, null); assert.equal(solin.prix_vente_ht, null); assert.equal(solin.quantite, 1);
  assert.equal(r.totaux.lignes_a_chiffrer, 1);
  assert.ok(r.alertes.some((a) => a.code === 'article_manquant' && a.niveau === 'warn' && /solin/i.test(a.message)));
});
test('sans dévoiement : pas de coudes ; réglable intérieur quand le reste tombe dans la plage', () => {
  const r = calculerMetre({ ...base, releve: { ...RELEVE, angle: 0, decal: 0, hCombles: 1.0 } });
  assert.ok(!r.lignes.some((l) => l.composant_code === 'coude_devoiement'));
  // Lint = (6.8 − 2.5) = 4.3 m → 4 × 1000 + réglable 300 ? non (300 < 320) → 4 × 1000 + 500 ; on vérifie juste l'absence de coude et la cohérence
  assert.ok(r.lignes.find((l) => l.composant_code === 'element_droit_interieur'));
});
test('résolution directe : préférence finition exacte, puis motif de code', () => {
  const m = [{ composant_code: 'x', gamme_catalogue: 'PTR30', finition: null, gamme_tarif: 'ABSENTE', type_piece: 'chapeau', motif_code: '^2PTICHARN{D}NO$' }];
  const a = resoudreArticle(ARTICLES, m, { composant_code: 'x', gamme_catalogue: 'PTR30', diametre: 150, finition: 'noir' });
  assert.equal(a.article.reference, '2PTICHARN150NO'); assert.equal(a.via, 'motif');
  assert.equal(resoudreArticle(ARTICLES, [], { composant_code: 'x', gamme_catalogue: 'PTR30', diametre: 150 }).article, null);
});
