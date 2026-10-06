// scripts/clim/dimensionnement.test.mjs
// Tests du moteur de dimensionnement clim (src/lib/clim/) sur le TARIF SOLIPAC RÉEL
// (scripts/clim/data/solipac-2026-10.json, mêmes lignes que l'import en base).
// Run : node --test scripts/clim/dimensionnement.test.mjs
// Le site Mayer rejoue ces mêmes cas sur sa copie du moteur : toute modif de règle doit les garder verts
// ou les mettre à jour ICI d'abord (ENGINE_VERSION).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS_CLIM, buildClimConfig } from '../../src/lib/clim/config.js';
import {
  ENGINE_VERSION, CLASSES_ISOLATION, classeDepuisAnnee, validerReleve, besoinPiece, catalogueDepuisProduits,
  choisirUnite, composerMulti, diametreLiaison, liaisons, lignesDevis, dimensionner,
} from '../../src/lib/clim/dimensionnement.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tarif = JSON.parse(readFileSync(path.join(racine, 'scripts', 'clim', 'data', 'solipac-2026-10.json'), 'utf8'));

/** Lignes telles que la vue majordhome_supplier_products les renvoie après l'import. */
const PRODUITS = tarif.articles.map((a) => ({
  id: `id-${a.reference}`, reference: a.reference, name: a.name, gamme: a.gamme, brand: a.brand, unit: 'pièce',
  supplier_id: 'sup-solipac', supplier_name: 'SOLIPAC', category: 'climatisation', is_active: true, default_tva_rate: 20,
  purchase_price_ht: Math.round((a.prix_net + a.deee) * 100) / 100, selling_price_ht: 0,
  specs: { canonical: { ...a.specs }, source_version: 'solipac_2026-10' },
}));

const logement = { classe_isolation: 'standard', zone_majoration: 0 };
const piece = (nom, surface_m2, extra = {}) => ({ nom, surface_m2, hauteur_m: 2.5, exposition: 'est', vitrage_m2: 0, occupants: 2, appareils_w: 0, ...extra });
const cfg = buildClimConfig(null);

test('ENGINE_VERSION et config par défaut', () => {
  assert.match(ENGINE_VERSION, /^clim-\d{4}\.\d{2}$/);
  assert.equal(cfg.base_w_m2, 100);
  assert.deepEqual(buildClimConfig({ clim: { zone_majoration: 0.1, multi: { ratio_max_ui_ge: 1.2 } } }).multi, { ratio_max_ui_ge: 1.2 });
  assert.equal(buildClimConfig({ clim: { liaison_paliers: 'n importe quoi' } }).liaison_paliers.length, 3);
  for (const c of CLASSES_ISOLATION) assert.ok(DEFAULTS_CLIM.w_m2_par_isolation[c.code] > 0, `classe ${c.code} sans W/m²`);
});

test('classeDepuisAnnee', () => {
  assert.equal(classeDepuisAnnee(2023), 'bbc');
  assert.equal(classeDepuisAnnee(2015), 'rt2012');
  assert.equal(classeDepuisAnnee(2005), 'standard');
  assert.equal(classeDepuisAnnee(1975), 'ancien');
  assert.equal(classeDepuisAnnee('abc'), null);
});

test('validerReleve refuse un relevé incomplet, sans 0 silencieux', () => {
  assert.equal(validerReleve(null).ok, false);
  const v = validerReleve({ logement: {}, pieces: [{ nom: 'Salon', exposition: 'sud' }] });
  assert.equal(v.ok, false);
  assert.ok(v.erreurs.some((e) => e.includes('isolation')));
  assert.ok(v.erreurs.some((e) => e.includes('Salon : surface')));
  assert.equal(validerReleve({ logement, pieces: [piece('Salon', 20)] }).ok, true);
});

test('besoinPiece : 20 m² standard à 2,50 m = 2 000 W, puis chaque facteur', () => {
  assert.equal(besoinPiece(piece('A', 20), logement, cfg).besoin_w, 2000);
  assert.equal(besoinPiece(piece('A', 20, { hauteur_m: 3 }), logement, cfg).besoin_w, 2400);
  assert.equal(besoinPiece(piece('A', 20, { exposition: 'sud' }), logement, cfg).besoin_w, 2300);
  assert.equal(besoinPiece(piece('A', 20, { exposition: 'nord' }), logement, cfg).besoin_w, 1800);
  assert.equal(besoinPiece(piece('A', 20, { sous_toiture: true }), logement, cfg).besoin_w, 2200);
  assert.equal(besoinPiece(piece('A', 20), { classe_isolation: 'bbc', zone_majoration: 0 }, cfg).besoin_w, 1400);
  assert.equal(besoinPiece(piece('A', 20), { classe_isolation: 'non_isole', zone_majoration: 0 }, cfg).besoin_w, 3000);
  // Zone de l'org par défaut (+5 %) quand le logement ne précise rien
  assert.equal(besoinPiece(piece('A', 20), { classe_isolation: 'standard' }, cfg).besoin_w, 2100);
  // Vitrage 4 m² plein sud non protégé = +600 W ; protégé = +300 W
  assert.equal(besoinPiece(piece('A', 20, { exposition: 'sud', vitrage_m2: 4 }), logement, cfg).besoin_w, 2900);
  assert.equal(besoinPiece(piece('A', 20, { exposition: 'sud', vitrage_m2: 4, protection_solaire: true }), logement, cfg).besoin_w, 2600);
  // Occupants : 4 personnes = +200 W ; appareils déclarés ajoutés tels quels
  assert.equal(besoinPiece(piece('A', 20, { occupants: 4 }), logement, cfg).besoin_w, 2200);
  assert.equal(besoinPiece(piece('A', 20, { appareils_w: 350 }), logement, cfg).besoin_w, 2350);
});

test('besoinPiece : contrôle croisé volume (hellowatt) — 50 m³ et 3 parois vitrées = 8 000 BTU ≈ 2,34 kW', () => {
  const r = besoinPiece(piece('A', 20, { nb_parois_vitrees: 3 }), logement, cfg);
  assert.equal(r.controle.btu, 8000);
  assert.equal(r.controle.kw, 2.34);
});

test('catalogueDepuisProduits lit les specs importées', () => {
  const c = catalogueDepuisProduits(PRODUITS);
  assert.equal(c.packs_mono.length, 11);
  assert.equal(c.ui.length, 15);
  assert.equal(c.ge_multi.length, 8);
  assert.equal(c.liaisons.length, 6);
  assert.equal(c.packs_mono[0].kw_froid, 2);
  assert.equal(c.ge_multi[7].reference, 'RAM-G110N5HCE');
  assert.equal(c.ge_multi[7].sorties_max, 5);
  assert.equal(catalogueDepuisProduits([{ specs: {} }, null]).packs_mono.length, 0);
});

test('choisirUnite : plus petite unité ≥ besoin, tolérance −5 %, alerte +30 %', () => {
  const packs400 = catalogueDepuisProduits(PRODUITS).packs_mono.filter((p) => p.gamme === 'airHome 400');
  assert.equal(choisirUnite(2000, packs400, cfg).unite.kw_froid, 2);
  assert.equal(choisirUnite(2600, packs400, cfg).unite.kw_froid, 2.5); // 2,5 ≥ 2,6 × 0,95
  assert.equal(choisirUnite(2700, packs400, cfg).unite.kw_froid, 3.5);
  const sur = choisirUnite(1000, packs400, cfg);
  assert.equal(sur.unite.kw_froid, 2);
  assert.ok(sur.alertes.some((a) => a.code === 'surdimensionne'));
  const trop = choisirUnite(7000, packs400, cfg);
  assert.equal(trop.unite.kw_froid, 5);
  assert.ok(trop.alertes.some((a) => a.code === 'aucune_unite_suffisante'));
  assert.equal(choisirUnite(2000, [], cfg).unite, null);
});

test('composerMulti : sorties et ratio 130 %', () => {
  const ge = catalogueDepuisProduits(PRODUITS).ge_multi;
  const deux = composerMulti([{ kw_froid: 2.5 }, { kw_froid: 2.5 }], ge, cfg);
  assert.equal(deux.groupe.reference, 'RAM-G43N2HCE'); // 5 ≤ 4,3 × 1,3 = 5,59 ; 3,6 × 1,3 = 4,68 insuffisant
  const trois = composerMulti([{ kw_froid: 2.5 }, { kw_froid: 2.5 }, { kw_froid: 3.5 }], ge, cfg);
  assert.equal(trois.groupe.reference, 'RAM-G68N3HCE'); // 8,5 > 5,5 × 1,3 = 7,15 ; 6,8 × 1,3 = 8,84 ok
  assert.equal(composerMulti([{ kw_froid: 2.5 }], ge, cfg).raison, 'une_seule_piece');
  assert.equal(composerMulti(Array(6).fill({ kw_froid: 2 }), ge, cfg).raison, 'trop_de_pieces');
  assert.equal(composerMulti([{ kw_froid: 7 }, { kw_froid: 7 }, { kw_froid: 7 }], ge, cfg).raison, 'puissance_insuffisante');
});

test('liaisons : diamètre par palier, couronnes 20 m puis 50 m, diamètre absent = alerte', () => {
  assert.equal(diametreLiaison(3.5, cfg).diametre, '1/4-3/8');
  assert.equal(diametreLiaison(5, cfg).diametre, '1/4-1/2');
  assert.equal(diametreLiaison(7, cfg).diametre, '3/8-5/8');
  const cat = catalogueDepuisProduits(PRODUITS).liaisons;
  const l = liaisons([{ kw_froid: 2.5, longueur_m: 8 }, { kw_froid: 3.5, longueur_m: 10 }, { kw_froid: 5, longueur_m: 25 }], cat, cfg);
  const petit = l.find((x) => x.diametre === '1/4-3/8');
  assert.equal(petit.longueur_m, 18);
  assert.deepEqual(petit.couronnes.map((c) => [c.article.reference, c.quantite]), [['22232', 1]]);
  const moyen = l.find((x) => x.diametre === '1/4-1/2');
  assert.deepEqual(moyen.couronnes.map((c) => [c.article.reference, c.quantite]), [['23417', 1]]); // 25 m > 20 → couronne 50 m
  const long = liaisons([{ kw_froid: 2, longueur_m: 65 }], cat, cfg)[0];
  assert.deepEqual(long.couronnes.map((c) => [c.article.reference, c.quantite]), [['23416', 1], ['22232', 1]]);
  const gros = liaisons([{ kw_froid: 7, longueur_m: 5 }], cat, cfg)[0];
  assert.equal(gros.diametre, '3/8-5/8');
  assert.equal(gros.couronnes.length, 1); // 3/8-5/8 existe en 20 m
  const absent = liaisons([{ kw_froid: 7, longueur_m: 5 }], cat.filter((a) => a.gaz !== '5/8'), cfg)[0];
  assert.equal(absent.couronnes.length, 0);
  assert.equal(absent.alertes[0].code, 'liaison_absente_catalogue');
});

test('lignesDevis : forme du métré fumisterie, prix de vente 0 ⇒ « À CHIFFRER »', () => {
  const [pack] = catalogueDepuisProduits(PRODUITS).packs_mono;
  const [ligne] = lignesDevis([{ article: pack, quantite: 1, piece: 'Salon' }]);
  assert.equal(ligne.line_type, 'product');
  assert.equal(ligne.supplier_product_id, pack.id);
  assert.equal(ligne.purchase_price_ht, 444.44);
  assert.equal(ligne.unit_price_ht, 0);
  assert.equal(ligne.description, 'Pièce : Salon · À CHIFFRER');
  const [vendue] = lignesDevis([{ article: { ...pack, selling_price_ht: 899 }, quantite: 2 }]);
  assert.equal(vendue.unit_price_ht, 899);
  assert.equal(vendue.description, '');
});

test('dimensionner : maison 3 pièces sur le tarif réel — mono ET multi, liaisons, lignes', () => {
  const releve = {
    logement: { classe_isolation: 'standard', zone_majoration: 0, gamme: 'airHome 400' },
    pieces: [
      piece('Salon', 30, { exposition: 'sud', vitrage_m2: 6, occupants: 4, longueur_liaison_m: 6 }), // 3450 + 900 + 200 = 4550 W
      piece('Chambre 1', 12, { exposition: 'est', longueur_liaison_m: 10 }),                            // 1200 W
      piece('Chambre 2', 14, { exposition: 'ouest', sous_toiture: true, longueur_liaison_m: 12 }),      // 14×100×1,05×1,1 = 1617 → 1620 W
    ],
  };
  const r = dimensionner(releve, PRODUITS, cfg);
  assert.equal(r.ok, true);
  assert.equal(r.engine_version, ENGINE_VERSION);
  assert.deepEqual(r.pieces.map((p) => p.besoin_w), [4550, 1200, 1620]);
  assert.deepEqual(r.pieces.map((p) => p.mono.unite.reference), ['XRAK-DJ50RHAE', 'XRAK-DJ18RHAE', 'XRAK-DJ18RHAE']);
  assert.deepEqual(r.pieces.map((p) => p.multi.unite.reference), ['RAK-DJ50RHAE', 'RAK-DJ15QHAE', 'RAK-DJ18RHAE']);
  // Multi : 5 + 1,5 + 2 = 8,5 kW → 6,8 × 1,3 = 8,84 ≥ 8,5, 3 sorties : RAM-G68N3HCE
  assert.equal(r.multi.groupe.reference, 'RAM-G68N3HCE');
  assert.equal(r.multi.somme_kw, 8.5);
  assert.equal(r.mode_recommande, 'multi');
  // Liaisons multi : 5 kW → 1/4-1/2 (6 m) ; 1,5 + 2 kW → 1/4-3/8 (22 m → couronne 50 m)
  assert.deepEqual(r.multi.liaisons.map((l) => [l.diametre, l.longueur_m]), [['1/4-1/2', 6], ['1/4-3/8', 22]]);
  assert.deepEqual(r.multi.liaisons.map((l) => l.couronnes.map((c) => c.article.reference)), [['22234'], ['23416']]);
  // Lignes : 1 groupe + 3 UI + 2 couronnes ; achat = somme exacte (DEEE incluse)
  assert.equal(r.multi.lignes_devis.length, 6);
  assert.equal(r.multi.total_achat_ht, Math.round((1606.78 + 302.75 + 151.9 + 178.15 + 144.63 + 284.79) * 100) / 100);
  assert.ok(r.multi.lignes_devis.every((l) => l.unit_price_ht === 0 && l.description.includes('À CHIFFRER')));
  // Mono : 3 packs + liaisons (5 kW → 1/4-1/2 6 m ; 2 + 2 kW → 1/4-3/8 22 m)
  assert.equal(r.mono.lignes_devis.length, 5);
  assert.equal(r.mono.total_achat_ht, Math.round((851.44 + 444.44 + 444.44 + 144.63 + 284.79) * 100) / 100);
  // Chambre 1 : pack 2 kW pour 1 200 W = +67 % ⇒ alerte surdimensionnement portée par la pièce
  assert.ok(r.alertes.some((a) => a.code === 'surdimensionne' && a.piece === 'Chambre 1'));
});

test('dimensionner : une seule pièce ⇒ pas de multi ; gamme inconnue ⇒ repli signalé', () => {
  const r = dimensionner({ logement: { classe_isolation: 'rt2012', gamme: 'airHome 900' }, pieces: [piece('Bureau', 15)] }, PRODUITS, cfg);
  assert.equal(r.ok, true);
  assert.equal(r.multi, null);
  assert.equal(r.mode_recommande, 'mono');
  assert.equal(r.gamme, cfg.gamme_defaut); // repli sur la gamme par défaut de l'org, pas la première du catalogue
  assert.ok(r.alertes.some((a) => a.code === 'gamme_inconnue'));
  // 15 m² RT2012 (+5 % zone) = 1 260 W → pack 2,0 kW airHome 400, surdimensionné (+59 %)
  assert.equal(r.pieces[0].mono.unite.reference, 'XRAK-DJ18RHAE');
  assert.ok(r.alertes.some((a) => a.code === 'surdimensionne' && a.piece === 'Bureau'));
});

test('dimensionner : relevé incomplet ⇒ ok false, erreurs nommées', () => {
  const r = dimensionner({ logement: { classe_isolation: 'standard' }, pieces: [{ nom: 'Salon' }] }, PRODUITS, cfg);
  assert.equal(r.ok, false);
  assert.ok(r.erreurs.length >= 2);
});

test('dimensionner : catalogue vide ⇒ aucune unité, alertes explicites, jamais de crash', () => {
  const r = dimensionner({ logement, pieces: [piece('A', 20), piece('B', 20)] }, [], cfg);
  assert.equal(r.ok, true);
  assert.equal(r.pieces[0].mono.unite, null);
  assert.equal(r.multi.groupe, null);
  assert.equal(r.mono.lignes_devis.length, 0);
  assert.ok(r.alertes.some((a) => a.code === 'catalogue_vide'));
});
