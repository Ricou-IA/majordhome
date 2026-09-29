// scripts/fumisterie/tranche3-tarif-reel.test.mjs — les 14 configurations de la tranche 3 sur le tarif
// réel MAYER002. Totaux d'achat et lignes « à chiffrer » pinnés : une régression du parseur, du mapping
// ou des règles se voit ici. Les « à chiffrer » restants sont VOULUS (article sur mesure ou absent du
// tarif), jamais un article approchant choisi en silence.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { chargerTarif, calculerSurTarif } from './lib/tarifReel.mjs';

let TARIF;
before(async () => { TARIF = await chargerTarif(); });
const refs = (r) => r.lignes.map((l) => `${l.reference}×${l.quantite}`);
const catalogue = (r) => r.alertes.filter((a) => a.code === 'article_ambigu' || a.code === 'article_manquant');
const G1 = { hBuse: 1.05, hsp1: 2.5, epPl: 0.25, nbEtages: 1, hsp2: 2.5, hCombles: 1.4, pente: 35, epToit: 0.3, dFaitage: 1.6, angle: 30, decal: 0.4, hSortie: 1.6 };

test('CFG-45 raccordement seul Ø150 plafond : tuyaux + rosace + kit d\'air, 132,15 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-45', 'G5', { diametre: 150, finition: 'noir', hBuse: 1.05, entree: 'plafond', hsp1: 2.5, raccord: 'emaille_12', kit_air: 1 });
  assert.deepEqual(refs(r), ['2LEPTUYA1501000NO×1', '2LEPTUYA150500NO×1', '2LEPROSA150NO×1', '2KITEAIR033×1']);
  assert.equal(r.totaux.achat_ht, 132.15); assert.deepEqual(catalogue(r), []);
  assert.ok(r.alertes.some((a) => a.code === 'conduit_non_metre'));
});
test('CFG-45 Ø80 pellets par le mur : coude + tuyau + rosace à sceller (replis EMAIL PEL), 71 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-45', 'G5', { diametre: 80, finition: 'noir', hBuse: 0.9, entree: 'mur', hsp1: 2.4, hEntree: 1.4, lHoriz: 0.4, raccord: 'emaille_12', kit_air: 0 });
  assert.deepEqual(refs(r), ['2PELCO9080NO×1', '2PELTUYA801000NO×1', '2PELROSAS80NO×1']);
  assert.equal(r.totaux.achat_ht, 71);
});
test('CFG-43 foyer sur flexible Ø150 : Griffaflex, 7,5 m de gaine, pas de tuyau ni d\'alerte buse, 441,53 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-43', 'G4F', { diametre: 150, finition: 'noir', hBuse: 1.2, hConduit: 7, boisseau: 3, chapeau: 'standard' });
  assert.deepEqual(refs(r), ['2FLECHSI150×1', '2DIVKCIRN3150×1', '2FLECGAI150×1', '2FLEPOLIXT10150C×7.5', '2FLEEMFI150×1', '2FLERAGRM150156×1']);
  assert.equal(r.totaux.achat_ht, 441.53);
  assert.ok(!r.alertes.some((a) => a.code === 'buse'));
});
test('CFG-37 POLYPERF Ø150 plafond : kit de 7 m (6,7 nécessaires), kit bas + RDE + plaque, 1 100,11 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-37', 'G4P', { diametre: 150, finition: 'noir', hBuse: 1.05, bas: 'plafond', hsp1: 2.5, raccord: 'emaille_12', hConduit: 6.2, boisseau: 3, chapeau: 'standard' });
  assert.deepEqual(refs(r), ['2FLECHSI150×1', '2DIVKCIRN3150×1', '2FLECGAI150×1', '2FLIPOPEN1507×1', '2FLERADE150156×1', '2FLIKITB150×1', '2FLEPHV3N150NO×1', '2LEPTUYA1501000NO×1', '2LEPTUYA150500NO×1']);
  assert.equal(r.totaux.achat_ht, 1100.11); assert.deepEqual(catalogue(r), []);
  const foyer = calculerSurTarif(TARIF, 'CFG-37', 'G4P', { diametre: 150, finition: 'noir', hBuse: 1.05, bas: 'foyer', hsp1: 2.5, raccord: 'emaille_12', hConduit: 6.2, boisseau: 3, chapeau: 'plat' });
  assert.ok(refs(foyer).includes('2FLERAGRM150156×1') && !refs(foyer).some((x) => x.startsWith('2LEPTUYA')));
});
test('CFG-39 POLYPERF Ø80 sur té : adaptateur + té + tampon, 698,12 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-39', 'G4P', { diametre: 80, finition: 'noir', hBuse: 0.9, bas: 'te', hsp1: 2.4, raccord: 'emaille_12', hConduit: 5, boisseau: 1, chapeau: 'standard' });
  assert.deepEqual(refs(r), ['2FLECHSI80×1', '2DIVKCIRN180×1', '2FLECGAI80×1', '2FLIPOPEN806×1', '2FLIPIADN80×1', '2FLET09080×1', '2FLETAMP80×1', '2PELTUYA801000NO×1', '2PELTUYA80500NO×1']);
  assert.equal(r.totaux.achat_ht, 698.12);
});
test('CFG-30 kit rénovation PLA Ø80 : adaptateurs n°6 / n°7 par section de boisseau (placeholder {BOI4}), 411,04 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-30', 'G4K', { diametre: 80, finition: 'noir', hBuse: 0.9, entree: 'plafond', hsp1: 2.4, hConduit: 6, boisseau: 1 });
  assert.deepEqual(refs(r), ['2PLAADA6802020×1', '2PLAADA7802020×1', '2FLEPOLIXT1080C×6.5', '2PLAELDR801000×1', '2PLAELDR80500×1', '2PLAMAFM80×1', '2PLAPPTR80×1']);
  assert.equal(r.totaux.achat_ht, 411.04);
});
test('CFG-31 conduit isolé existant Ø80 : les adaptateurs n°4 / n°2 sont sur mesure (D XXX) → à chiffrer, jamais un article approchant', () => {
  const r = calculerSurTarif(TARIF, 'CFG-31', 'G4K', { diametre: 80, finition: 'noir', hBuse: 0.9, entree: 'mur', hsp1: 2.4, hEntree: 1.3, lHoriz: 0.4, hConduit: 6, boisseau: 2 });
  assert.equal(r.totaux.lignes_a_chiffrer, 2); assert.equal(r.totaux.achat_ht, 312.62);
  assert.ok(refs(r).includes('2PLACO9080×1'));
});
test('CFG-29 ventouse Ø80 : terminal horizontal, rosace, PLA vertical + horizontal, 361,09 € ; zone 3 = validation technicien', () => {
  const r = calculerSurTarif(TARIF, 'CFG-29', 'G6', { diametre: 80, finition: 'noir', hBuse: 0.9, hSortie: 1.8, lHoriz: 0.6, epMur: 0.3 });
  assert.deepEqual(refs(r), ['2PLATHOF80×1', '2PLAROSA2P80×1', '2PLAELDR80500×1', '2PLAELDR80250×1', '2PLACO9080×1', '2PLAELDR801000×1', '2PLAMAFM80×1', '2PLAPPTR80×1']);
  assert.equal(r.totaux.achat_ht, 361.09);
  assert.ok(r.alertes.some((a) => a.code === 'zone3_non_verifiee' && a.niveau === 'warn'));
});
test('CFG-25 façade PTR Ø150 noir : 14 lignes, supports muraux au Ø extérieur (210), zone 1 vérifiée, 2 216,86 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-25', 'G3', { diametre: 150, finition: 'noir', hBuse: 1.05, hsp1: 2.5, hTraversee: 1.6, lHoriz: 0.6, epMur: 0.3, raccord: 'emaille_12', hMur: 5.5, pente: 35, dFaitage: 4, hSortie: 3.5 });
  assert.deepEqual(refs(r), ['2PTICHARN150NO×1', '2PTIELDR1501000NO×7', '2PTIELRE150500NO×1', '2PTICOJO150NO×8', '2DIVSUMIR210NO×4', '2PTISUMD150×1', '2PTIT090150×1', '2PTIPURG150×1',
    '2PTIELDR150500×1', '2PTIPPDR150×1', '2PTIRASR150148×1', '2LEPCO90150NO×1', '2LEPTUYA1501000NO×1', '2LEPTUYA150250NO×1']);
  assert.equal(r.totaux.achat_ht, 2216.86); assert.deepEqual(catalogue(r), []);
  assert.equal(r.alertes.find((a) => a.code === 'zone1').niveau, 'ok');
});
test('CFG-33 façade PLA + PTR Ø80 inox : support de départ Ø80 absent du tarif → à chiffrer, 1 414,24 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-33', 'G3P', { diametre: 80, finition: 'inox', hBuse: 0.9, hsp1: 2.4, hTraversee: 1.4, lHoriz: 0.5, epMur: 0.3, hMur: 5.5, pente: 30, dFaitage: 3, hSortie: 2.5 });
  assert.equal(r.totaux.lignes_a_chiffrer, 1); assert.equal(r.totaux.achat_ht, 1414.24);
  assert.ok(refs(r).includes('2DIVSUMIR140IN×4') && refs(r).includes('2PLAELDR801000×1'));
});
test('CFG-32 création PTR + souche Polytoit Ø150 : souche choisie par la pente (32-38°), 1 731,48 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-32', 'G1', { ...G1, diametre: 150, finition: 'noir' });
  assert.deepEqual(refs(r), ['2SOU109L3238PTG150×1', '2PTIRAPO150×1', '6POLCOLBA210×1', '2PTICO30150×2', '2PTIELDR1501000×5', '2PTIPPDR150×2', '2PTGCOCF150×2', '2PTIRASR150148×1', '2LEPTUYA1501000NO×1', '2LEPTUYA150500NO×1']);
  assert.equal(r.totaux.achat_ht, 1731.48);
  assert.ok(refs(calculerSurTarif(TARIF, 'CFG-32', 'G1', { ...G1, diametre: 150, finition: 'noir', pente: 20 })).includes('2SOU107L1623PTG150×1'));
});
test('CFG-42 foyer via combles, souche Polytoit, PRH dans la hotte Ø150 : 1 697,09 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-42', 'G1', { ...G1, diametre: 150, finition: 'noir', angle: 0 });
  assert.equal(r.totaux.achat_ht, 1697.09); assert.deepEqual(catalogue(r), []);
  assert.ok(refs(r).includes('2PR6TUYA1501000×1') && refs(r).includes('2PR6MRAC150×1'));
});
test('CFG-28 création PLA Ø80 étanche : collerette de solin PLA (sans plage de pente) acceptée, 983,31 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-28', 'G1', { ...G1, diametre: 80, finition: 'inox' });
  assert.equal(r.totaux.achat_ht, 983.31); assert.deepEqual(catalogue(r), []);
  assert.ok(refs(r).includes('2PLACSOL80RT×1') && refs(r).includes('2PLACO3080×2'));
});
test('CFG-48 chaudière PLA Ø100 : solin Ø100 absent → à chiffrer, 953,21 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-48', 'G1', { ...G1, diametre: 100, finition: 'inox', angle: 0 });
  assert.equal(r.totaux.lignes_a_chiffrer, 1); assert.equal(r.totaux.achat_ht, 953.21);
});
test('CFG-40 MFI Ø150 : solin inox au Ø extérieur (250) par la pente, kit de raccordement ambigu par construction (1 par appareil), 2 376,42 €', () => {
  const r = calculerSurTarif(TARIF, 'CFG-40', 'G1', { ...G1, diametre: 150, finition: 'inox' });
  assert.equal(r.totaux.achat_ht, 2376.42); assert.equal(r.totaux.lignes_a_chiffrer, 1);
  assert.ok(refs(r).includes('2DIVS2535IN250KEI×1') && refs(r).includes('2MFIT135150AF100×1'));
  const kit = r.alertes.find((a) => a.code === 'article_ambigu');
  assert.ok(kit && /au total/.test(kit.message));
});
