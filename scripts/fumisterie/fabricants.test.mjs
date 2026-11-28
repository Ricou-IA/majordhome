// Moteur indépendant du fabricant : le même relevé chez MODINOX (tarif réel) et chez DINAK (extrait réel,
// attributs lus par le parseur, PRIX FICTIFS : l'extrait n'en porte pas), et la règle de comparaison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parserDinak } from './lib/dinak-designation.js';
import { chargerTarif, lireData, articlesPour, MAPPING_COMPLET, GABARIT_FICHIER } from './lib/tarifReel.mjs';
import { comparerFabricants, equivalencePour, choisirColonne } from '../../src/lib/fumisterie/index.js';
import { choisirCouronnes } from '../../src/lib/fumisterie/nomenclature.js';
import { resoudreArticle } from '../../src/lib/fumisterie/articles.js';
import { buildFumisterieConfig, reglagesDuFabricant } from '../../src/lib/fumisterie/config.js';

const { articles: extrait } = JSON.parse(readFileSync(new URL('./data/dinak-extrait-2026-11.json', import.meta.url), 'utf8'));
const DINAK = extrait.map((a, i) => ({ id: `d${i}`, reference: a.reference, name: a.name, unit: 'pièce', is_active: true, tarif_public: 100, purchase_price_ht: 35,
  sur_mesure: false, hors_perimetre: false, ...parserDinak(a) })).filter((a) => a.type_piece);
const MAPPING_DINAK = lireData('dinak-mapping.json');
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
    assert.equal(d.validee, true); // équivalence CFG-24 validée par Eric le 2026-11-28
    const sansValidation = comparerFabricants(base(releve), [dinak(150)].map((f) => ({ ...f, equivalences: f.equivalences.map((e) => ({ ...e, validee_le: null })) })));
    assert.equal(sansValidation.colonnes[0].validee, false);
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

test('flexible en couronnes : la plus petite couronne qui suffit, puis des plus longues au-delà', () => {
  const C = [6000, 8000, 10000, 15000];
  assert.deepEqual(choisirCouronnes(5200, C), [[6000, 1]]);
  assert.deepEqual(choisirCouronnes(8000, C), [[8000, 1]]);
  assert.deepEqual(choisirCouronnes(17000, C), [[15000, 1], [6000, 1]]);
  assert.deepEqual(choisirCouronnes(31000, C), [[15000, 2], [6000, 1]]);
  assert.deepEqual(choisirCouronnes(0, C), []);
  assert.deepEqual(choisirCouronnes(5000, []), []);
});

test("motif {=D} : la référence ne porte pas le Ø, l'article est quand même pris au Ø du relevé", () => {
  const art = (reference, diametre_int) => ({ reference, diametre_int, type_piece: 'chapeau_anti_refouleur', gamme_tarif: 'G', is_active: true });
  const articles = [art('039F20012SW', 150), art('039F21012SW', 180)];
  const mapping = [{ composant_code: 'c', gamme_catalogue: 'X', gamme_tarif: 'G', type_piece: 'chapeau_anti_refouleur', motif_code: '{=D}^039F\\d{2}012SW$' }];
  assert.equal(resoudreArticle(articles, mapping, { composant_code: 'c', gamme_catalogue: 'X', diametre: 180 }).article.reference, '039F21012SW');
  assert.equal(resoudreArticle(articles, mapping, { composant_code: 'c', gamme_catalogue: 'X', diametre: 200 }).article, null);
});

test('une référence présente deux fois au tarif ne fait pas une ambiguïté ; deux références différentes, si', () => {
  const art = (id, reference) => ({ id, reference, diametre_int: 150, type_piece: 'plaque_autre', gamme_tarif: 'G', is_active: true });
  const mapping = [{ composant_code: 'c', gamme_catalogue: 'X', gamme_tarif: 'G', type_piece: 'plaque_autre', motif_code: null }];
  const c = { composant_code: 'c', gamme_catalogue: 'X', diametre: 150 };
  assert.equal(resoudreArticle([art(1, 'ARP150'), art(2, 'ARP150')], mapping, c).article.reference, 'ARP150');
  assert.deepEqual(resoudreArticle([art(1, 'ARP150'), art(2, 'ARP151')], mapping, c).ambigus, ['ARP150', 'ARP151']);
});

// Couverture DINAK par configuration (extrait réel, prix fictifs). Les manques FIGÉS ici sont des pièces que DINAK
// ne vend pas sous cette forme : ils sortent « à chiffrer », jamais un article approchant. Un manque qui disparaît
// ou apparaît doit être expliqué (correspondance changée, tarif changé).
const MANCHON_PLA = "Manchon de raccordement PLA sur l'appareil";
const BOISSEAU = { plafond: ["Plaque d'habillage ventilée (plafond)"], mur: ['Adaptateur de piquage 90° boisseau bas sur simple paroi'] };
const POLYTOIT = { '': ['Souche Polytoit', 'Raccord PTR → Polytoit', 'Collier de fixation bas de souche'] };
// [configuration, gabarit, diamètres, manques par entrée ('' = gabarit sans choix d'entrée)]
const COUVERTURE = [
  ['CFG-24', 'G1', [130, 150, 180], {}],
  ['CFG-25', 'G3', [130, 150, 180], {}],
  ['CFG-26', 'G4', [130, 150, 180], BOISSEAU],
  ['CFG-27', 'G4R', [150, 180], {}],
  // SW BOIS n'existe pas en Ø130 : le rigide et ses pièces sortent à chiffrer, jamais un autre Ø.
  ['CFG-27', 'G4R', [130], {
    plafond: ['Chapeau anti-refouleur PRH', 'Tuyau rigide PRH dans le conduit', 'Tuyau rigide PRH (raccordement appareil → conduit)', 'Manchon de raccordement sur buse'],
    mur: ['Chapeau anti-refouleur PRH', 'Tuyau rigide PRH dans le conduit', 'Coude 90° à purge PRH (entrée par le mur)', 'Tampon à poignée pour coude à purge',
      'Tuyau rigide PRH (raccordement appareil → conduit)', 'Manchon de raccordement sur buse'],
  }],
  ['CFG-28', 'G1', [80, 100], { '': ['Coudes de dévoiement PLA', MANCHON_PLA] }],
  ['CFG-29', 'G6', [80, 100], { '': [MANCHON_PLA] }],
  ['CFG-30', 'G4K', [80, 100], { plafond: [MANCHON_PLA], mur: [MANCHON_PLA] }],
  ['CFG-31', 'G4K', [80, 100], { plafond: [MANCHON_PLA], mur: [MANCHON_PLA] }],
  ['CFG-32', 'G1', [150], POLYTOIT],
  ['CFG-33', 'G3P', [80, 100], { '': [MANCHON_PLA] }],
  ['CFG-34', 'G4', [80, 100], BOISSEAU],
  ['CFG-35', 'G4R', [80, 100], {}],
  ['CFG-42', 'G1', [150], POLYTOIT],
  ['CFG-43', 'G4F', [150, 180], {}],
  // En Ø80 / 100 le tuyau court DEKO pellets fait 200 mm, le découpage de l'équivalence demande 285.
  ['CFG-45', 'G5', [80, 100], { plafond: ['Tuyau émaillé 1,2 mm (raccordement)'] }],
  ['CFG-45', 'G5', [130, 150, 180], { mur: ['Rosace à sceller (entrée par le mur)'] }],
  ['CFG-48', 'G1', [80, 100], { '': ['Coudes de dévoiement PLA', MANCHON_PLA] }],
];
const TOUTES_EQUIVALENCES = lireData('equivalences-gammes.json');

test('couverture DINAK de chaque configuration : seules les pièces que DINAK ne vend pas restent à chiffrer', () => {
  for (const [cfg, gab, diametres, manques] of COUVERTURE) {
    const gabarit = lireData(GABARIT_FICHIER[gab]);
    const defauts = {};
    for (const t of gabarit.troncons) for (const p of t.parametres) defauts[p.cle] = p.defaut ?? null;
    const entrees = gab.startsWith('G4') || gab === 'G5' ? ['plafond', 'mur'] : [''];
    for (const d of diametres) for (const finition of ['noir', 'inox']) for (const entree of entrees) {
      const releve = { ...defauts, diametre: d, finition, ...(entree ? { entree, bas: entree } : {}) };
      const cmp = comparerFabricants({ configuration: { code: cfg, gabarit_code: gab }, gabarit, composants: lireData(`cfg${cfg.slice(4)}-composants.json`), reglages, releve },
        [{ supplierId: 'dinak', nom: 'DINAK', mapping: MAPPING_DINAK, articles: dinakPour(d), equivalences: TOUTES_EQUIVALENCES.filter((e) => e.configuration_code === cfg) }]);
      const col = cmp.colonnes[0];
      const cas = `${cfg} Ø${d} ${finition} ${entree}`;
      assert.ok(col && !col.erreur, `${cas} : ${col?.erreur ?? 'pas de colonne'}`);
      const trous = [...new Set(col.resultat.alertes.filter((a) => /article_/.test(a.code)).map((a) => a.message.split(' : ')[0]))].sort();
      assert.deepEqual(trous, [...(manques[entree] ?? [])].sort(), cas);
      assert.ok(!col.resultat.alertes.some((a) => a.code === 'article_ambigu'), `${cas} : ambiguïté`);
    }
  }
});

test('fabricant sans mapping pour la configuration : pas de colonne ; un seul fabricant : pas de gagnant', async () => {
  const tarif = await chargerTarif();
  const cmp = comparerFabricants(base(RELEVE), [modinox(tarif, 150), { supplierId: 'autre', nom: 'AUTRE', mapping: [{ composant_code: 'sans_rapport' }], articles: [] }]);
  assert.deepEqual(cmp.colonnes.map((c) => c.supplierId), ['modinox']);
  assert.equal(cmp.complete, false);
  assert.equal(cmp.moinsCher, null);
});
