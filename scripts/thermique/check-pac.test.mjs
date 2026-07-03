// Test de cohérence de src/apps/thermique/data/pac-catalogue.json
// Source des valeurs : hplib (RE-Lab-Projects) — Heatpump Keymark data (cf. _meta.note pour la formule).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('src/apps/thermique/data/pac-catalogue.json', 'utf8'));

test('catalogue : génériques présents + modèles air/eau, params complets', () => {
  assert.ok(d.pacs.length >= 20, `${d.pacs.length} PAC`);
  assert.ok(d.pacs.some((p) => p.generique), 'au moins un modèle générique');
  for (const p of d.pacs.slice(0, 50)) {
    assert.ok(p.fabricant && p.modele, JSON.stringify(p));
    assert.equal(p.type, 'air-eau');
    assert.ok(Number.isFinite(p.pthRef) && p.pthRef > 1000, `${p.modele}: pthRef`);
    assert.equal(p.coefPth.length, 4);
    assert.equal(p.coefCop.length, 4);
  }
});

// Formule hplib (vérifiée dans hplib/hplib.py, simulate()/HeatPump.simulate(), cf. _meta.note) :
// pour une PAC air/eau (Group 1), T_amb = T_in (température d'air extérieur).
//   COP(T_in, T_out)  = p1_COP·T_in  + p2_COP·T_out  + p3_COP  + p4_COP·T_amb
//   P_el(T_in, T_out) = P_el_ref · (p1_Pel·T_in + p2_Pel·T_out + p3_Pel + p4_Pel·T_amb)
//   avec P_el_ref = pthRef / COP_ref, COP_ref = COP(-7, 52) (point de référence Keymark).
function cop(pac, tIn, tOut) {
  const [p1, p2, p3, p4] = pac.coefCop;
  const tAmb = tIn;
  return p1 * tIn + p2 * tOut + p3 + p4 * tAmb;
}

function pTh(pac, tIn, tOut) {
  const copRef = cop(pac, -7, 52);
  const pElRef = pac.pthRef / copRef;
  const [p1, p2, p3, p4] = pac.coefPth;
  const tAmb = tIn;
  const pEl = pElRef * (p1 * tIn + p2 * tOut + p3 + p4 * tAmb);
  return pEl * cop(pac, tIn, tOut);
}

test('sanité physique : COP(7°C ext, 35°C départ) entre 2.5 et 7', () => {
  const reels = d.pacs.filter((p) => !p.generique);
  // 10 modèles échantillonnés à intervalle régulier (couverture large du catalogue) + génériques
  const step = Math.max(1, Math.floor(reels.length / 10));
  const echantillon = [];
  for (let i = 0; i < reels.length && echantillon.length < 10; i += step) echantillon.push(reels[i]);
  const generiques = d.pacs.filter((p) => p.generique);

  for (const pac of [...echantillon, ...generiques]) {
    const c = cop(pac, 7, 35);
    assert.ok(
      Number.isFinite(c) && c >= 2.5 && c <= 7,
      `${pac.fabricant} ${pac.modele}: COP(7,35)=${c}`
    );
  }
});

test('sanité physique : P_th(-7°C, 35°C départ) positif et cohérent avec pthRef', () => {
  // Les PAC "Regulated" (vitesse variable) sont, par construction Keymark/EN14825, testées à
  // charge partielle modulée par palier de température extérieure : P_th(T_in,T_out) à T_out fixe
  // n'est PAS une courbe de capacité maximale croissante avec T_in (cf. _meta.note et
  // hplib_database.py qui définit justement "Regulated" comme les modèles dont P_th décertifié
  // n'est PAS croissant avec T_in, contrairement aux modèles "On-Off"). On vérifie donc seulement
  // que la grandeur reste dans un ordre de grandeur physique plausible (positive, du même ordre
  // que pthRef), pas une direction de variation.
  const reels = d.pacs.filter((p) => !p.generique);
  const step = Math.max(1, Math.floor(reels.length / 10));
  const echantillon = [];
  for (let i = 0; i < reels.length && echantillon.length < 10; i += step) echantillon.push(reels[i]);

  for (const pac of echantillon) {
    const pthM7 = pTh(pac, -7, 35);
    // Bornes larges (x5) car ce sont des fits least-square (MAPE documenté ~10-20%, cf. README) :
    // sur les 9244 modèles réels du catalogue, 99.9% des ratios P_th(-7,35)/pthRef sont < 3.2 et
    // le maximum observé est 4.61 (queue de distribution de quelques fits moins bons) — x5 laisse
    // une marge de sécurité tout en excluant une vraie erreur d'unité (kW/W donnerait un facteur ~1000).
    assert.ok(
      Number.isFinite(pthM7) && pthM7 > 0 && pthM7 < 5 * pac.pthRef,
      `${pac.fabricant} ${pac.modele}: P_th(-7,35)=${pthM7}, pthRef=${pac.pthRef}`
    );
  }
});
