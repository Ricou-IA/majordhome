// Moteur indépendant du fabricant : le même relevé chez MODINOX (tarif réel) et chez DINAK (extrait réel,
// attributs lus par le parseur, PRIX FICTIFS : l'extrait n'en porte pas), et la règle de comparaison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parserDinak } from './lib/dinak-designation.js';
import { chargerTarif, lireData, articlesPour, MAPPING_COMPLET } from './lib/tarifReel.mjs';
import { comparerFabricants, equivalencePour, choisirColonne } from '../../src/lib/fumisterie/index.js';
import { buildFumisterieConfig, reglagesDuFabricant } from '../../src/lib/fumisterie/config.js';

const { articles: extrait } = JSON.parse(readFileSync(new URL('./data/dinak-extrait-2026-11.json', import.meta.url), 'utf8'));
const DINAK = extrait.map((a, i) => ({ id: `d${i}`, reference: a.reference, name: a.name, unit: 'pièce', is_active: true, tarif_public: 100, purchase_price_ht: 35,
  sur_mesure: false, hors_perimetre: false, ...parserDinak(a) })).filter((a) => a.type_piece);
const MAPPING_DINAK = lireData('dinak-cfg24-mapping.json');
const EQUIVALENCES = lireData('equivalences-gammes.json').filter((e) => e.configuration_code === 'CFG-24');
const reglages = buildFumisterieConfig(null);
const RELEVE = { diametre: 150, finition: 'noir', hBuse: 1.05, hsp1: 2.5, epPl: 0.25, nbEtages: 1, hsp2: 2.5, hCombles: 1.4, pente: 35, epToit: 0.3, dFaitage: 1.6, angle: 30, decal: 0.4, hSortie: 1.6 };
const base = (releve) => ({ configuration: { code: 'CFG-24', gabarit_code: 'G1' }, gabarit: lireData('gabarit-g1.json'), composants: lireData('cfg24-composants.json'), reglages, releve });
const dinakPour = (diametre) => articlesPour(DINAK, MAPPING_DINAK, diametre);
const modinox = (tarif, diametre) => ({ supplierId: 'modinox', nom: 'MODINOX / ALTEMA', mapping: MAPPING_COMPLET, articles: articlesPour(tarif, MAPPING_COMPLET, diametre), historique: true });
const dinak = (diametre) => ({ supplierId: 'dinak', nom: 'DINAK', mapping: MAPPING_DINAK, articles: dinakPour(diametre), equivalences: EQUIVALENCES, prixVerifies: false });

test("réglages du fabricant : longueurs et réglable de l'équivalence, le reste inchangé", () => {
  const r = reglagesDuFabricant(reglages, equivalencePour(EQUIVALENCES, RELEVE));
  assert.deepEqual(r.longueurs_elements_mm, [940, 440, 270]);
  assert.deepEqual(r.longueurs_raccordement_mm, [950, 450, 285]);
  assert.deepEqual(r.reglable, { min: 350, max: 530 });
  assert.equal(r.zone1, reglages.zone1);
  assert.equal(reglagesDuFabricant(reglages, null), reglages);
  assert.deepEqual(reglages.longueurs_raccordement_mm, [1000, 500, 250]);
  assert.equal(equivalencePour(EQUIVALENCES, { finition: 'inox' }).gamme_tarif, 'DW BOIS 316L / 304');
});

test('maquette G1 Ø150 : la nomenclature DINAK est complète, en noir et en inox', async () => {
  const tarif = await chargerTarif();
  for (const finition of ['noir', 'inox']) {
    const releve = { ...RELEVE, finition };
    const cmp = comparerFabricants(base(releve), [modinox(tarif, 150), dinak(150)]);
    const d = cmp.colonnes.find((c) => c.supplierId === 'dinak');
    const manquants = d.resultat.alertes.filter((a) => /article_/.test(a.code)).map((a) => a.message);
    assert.deepEqual(manquants, [], `${finition} : ${manquants.join(' | ')}`);
    assert.ok(d.resultat.lignes.every((l) => l.article_id));
    assert.equal(d.validee, false);
    assert.equal(d.prixVerifies, false);
    // Découpage propre au fabricant : raccordement DEKO série D1N (950 mm en tête).
    assert.ok(d.resultat.lignes.some((l) => l.reference === '039A15020D1N'), d.resultat.lignes.map((l) => l.reference).join(','));
    // MODINOX a trois solins possibles à 35° en Ø150 (2DIVS2535IN230/250/280KEI) : la comparaison est incomplète,
    // aucun fabricant n'est désigné « moins cher ».
    assert.equal(cmp.colonnes.find((c) => c.supplierId === 'modinox').ambigus, 1);
    assert.equal(cmp.complete, false);
    assert.equal(cmp.moinsCher, null);
  }
});

test('relevé où les deux nomenclatures sont complètes (Ø180, pente 23°) : un « moins cher » est désigné', async () => {
  const tarif = await chargerTarif();
  const releve = { ...RELEVE, diametre: 180, pente: 23, angle: 45 };
  const cmp = comparerFabricants(base(releve), [modinox(tarif, 180), dinak(180)]);
  for (const c of cmp.colonnes) assert.equal(c.aChiffrer + c.ambigus, 0, `${c.nom} : ${c.resultat.alertes.filter((a) => /article_/.test(a.code)).map((a) => a.message).join(' | ')}`);
  assert.equal(cmp.complete, true);
  const attendu = cmp.colonnes.reduce((a, b) => (b.totaux.vente_ht < a.totaux.vente_ht ? b : a)).supplierId;
  assert.equal(cmp.moinsCher, attendu);
});

test('comparaison incomplète : jamais de « moins cher » quand une colonne a une ligne à chiffrer', async () => {
  const tarif = await chargerTarif();
  const releve = { ...RELEVE, diametre: 80 }; // pas de DW BOIS en Ø80
  const cmp = comparerFabricants(base(releve), [modinox(tarif, 80), dinak(80)]);
  assert.ok(cmp.colonnes.find((c) => c.supplierId === 'dinak').aChiffrer > 0);
  assert.equal(cmp.complete, false);
  assert.equal(cmp.moinsCher, null);
});

test('choisirColonne : le choix, sinon le fabricant historique, sinon la première colonne', () => {
  const cmp = { colonnes: [{ supplierId: 'dinak' }, { supplierId: 'modinox' }] };
  const fabs = [{ supplierId: 'dinak' }, { supplierId: 'modinox', historique: true }];
  assert.equal(choisirColonne(cmp, 'dinak', fabs).supplierId, 'dinak');
  assert.equal(choisirColonne(cmp, 'inconnu', fabs).supplierId, 'modinox');
  assert.equal(choisirColonne(cmp, null, []).supplierId, 'dinak');
  assert.equal(choisirColonne({ colonnes: [] }, 'dinak', fabs), null);
});

test('fabricant sans mapping pour la configuration : pas de colonne ; un seul fabricant : pas de gagnant', async () => {
  const tarif = await chargerTarif();
  const cmp = comparerFabricants(base(RELEVE), [modinox(tarif, 150), { supplierId: 'autre', nom: 'AUTRE', mapping: [{ composant_code: 'sans_rapport' }], articles: [] }]);
  assert.deepEqual(cmp.colonnes.map((c) => c.supplierId), ['modinox']);
  assert.equal(cmp.complete, false);
  assert.equal(cmp.moinsCher, null);
});
