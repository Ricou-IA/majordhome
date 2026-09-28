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
test('quantité calculée nulle → aucune ligne émise (createQuote ferait 0 || 1)', () => {
  const comp = { repere: 9, ordre: 99, composant_code: 'collier_test', libelle: 'Collier test', troncon: 'sortie_toit', statut: 'provisoire', gammes: ['PTR30'], regle_quantite: 'par_emboitement:sortie_toit' };
  const r = calculerMetre({ ...base, composants: [comp], releve: { ...RELEVE, hSortie: 0 } });
  assert.equal(r.lignes.length, 0);
  assert.ok(!r.alertes.some((a) => a.code === 'article_manquant'));
  // mapping à quantite_par_unite 0 sur une règle unitaire : quantité 0 → pas de ligne non plus
  const unit = { ...comp, composant_code: 'piece_zero', regle_quantite: 'unitaire' };
  const m = [{ composant_code: 'piece_zero', gamme_catalogue: 'PTR30', finition: null, gamme_tarif: 'X', type_piece: 'x', motif_code: '^2PTICHARN{D}NO$', quantite_par_unite: 0 }];
  assert.equal(calculerMetre({ ...base, composants: [unit], mapping: m, releve: RELEVE }).lignes.length, 0);
});
test('plusieurs articles possibles → ligne à chiffrer + alerte article_ambigu listant les références (jamais un choix alphabétique)', () => {
  const sansMotif = MAPPING.map((m) => (m.composant_code === 'collier_jonction_exterieur' ? { ...m, motif_code: null } : m));
  const galva = { ...ARTICLES.find((a) => a.reference === '2PTICOJO150NO'), id: '2PTGCOJO150NO', reference: '2PTGCOJO150NO' };
  const r = calculerMetre({ ...base, mapping: sansMotif, articles: [...ARTICLES, galva], releve: RELEVE });
  const collier = r.lignes.find((l) => l.composant_code === 'collier_jonction_exterieur');
  assert.equal(collier.reference, null); assert.equal(collier.prix_vente_ht, null);
  const a = r.alertes.find((x) => x.code === 'article_ambigu');
  assert.equal(a.niveau, 'warn');
  assert.match(a.message, /2PTGCOJO150NO, 2PTICOJO150NO/);
  assert.ok(!r.alertes.some((x) => x.code === 'article_manquant'));
  // avec le motif, la pièce galva est écartée
  assert.ok(refs(calculerMetre({ ...base, articles: [...ARTICLES, galva], releve: RELEVE }).lignes).includes('2PTICOJO150NO×3'));
});
test('motif : placeholders {LG} inconnu → toute longueur, {D-n} arithmétique', () => {
  const m = [{ composant_code: 'r', gamme_catalogue: 'PTR30', finition: null, gamme_tarif: 'PTR30+ I', type_piece: 'raccord_simple_paroi', motif_code: '^2PTIRASR{D}{D-2}$' }];
  assert.equal(resoudreArticle(ARTICLES, m, { composant_code: 'r', gamme_catalogue: 'PTR30', diametre: 150 }).article.reference, '2PTIRASR150148');
  const e = [{ composant_code: 'e', gamme_catalogue: 'PTR30', finition: 'noir', gamme_tarif: 'PTR30+ LAQ', type_piece: 'element_reglable', motif_code: '^2PTIEL(DR|RE){D}{LG}(NO)?$' }];
  assert.equal(resoudreArticle(ARTICLES, e, { composant_code: 'e', gamme_catalogue: 'PTR30', diametre: 150, finition: 'noir' }).article.reference, '2PTIELRE150500NO');
});
