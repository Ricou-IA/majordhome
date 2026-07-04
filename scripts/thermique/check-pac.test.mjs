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

test('références brutes : pElRef/copRef présents, bornés et cohérents entre eux', () => {
  // pElRef et copRef sont les colonnes BRUTES du CSV hplib (P_el_h_ref [W] / COP_ref,
  // point de référence Keymark -7°C/52°C) — PAS dérivables de la courbe COP fittée
  // (divergence médiane ~34 %, cf. _meta.note). null autorisé pour les seuls génériques
  // (colonnes vides dans le CSV, hplib.get_parameters() les calcule au chargement).
  for (const p of d.pacs) {
    if (p.generique) {
      assert.ok(p.pElRef === null || Number.isFinite(p.pElRef), `${p.modele}: pElRef générique`);
      assert.ok(p.copRef === null || Number.isFinite(p.copRef), `${p.modele}: copRef générique`);
      continue;
    }
    assert.ok(Number.isFinite(p.pElRef) && p.pElRef > 200, `${p.modele}: pElRef=${p.pElRef}`);
    assert.ok(Number.isFinite(p.copRef) && p.copRef >= 1.5 && p.copRef <= 8, `${p.modele}: copRef=${p.copRef}`);
    // Cohérence interne CSV : P_el_h_ref ≈ P_th_h_ref / COP_ref (mêmes conditions -7/52).
    assert.ok(
      Math.abs(p.pElRef - p.pthRef / p.copRef) / p.pElRef <= 0.01,
      `${p.modele}: pElRef=${p.pElRef} vs pthRef/copRef=${(p.pthRef / p.copRef).toFixed(0)}`
    );
  }
});

// Formule hplib (vérifiée dans hplib/hplib.py, simulate()/HeatPump.simulate(), cf. _meta.note) :
// pour une PAC air/eau (Group 1), T_amb = T_in (température d'air extérieur).
//   COP(T_in, T_out)  = p1_COP·T_in  + p2_COP·T_out  + p3_COP  + p4_COP·T_amb
//   P_el(T_in, T_out) = pElRef · (p1_Pel·T_in + p2_Pel·T_out + p3_Pel + p4_Pel·T_amb)
// pElRef = colonne brute P_el_h_ref [W] du CSV, utilisée DIRECTEMENT (hplib.py la lit telle
// quelle ; ne PAS la recalculer comme pthRef/COP_fitté(-7,52), qui diverge de ~34 % en médiane).
function cop(pac, tIn, tOut) {
  const [p1, p2, p3, p4] = pac.coefCop;
  const tAmb = tIn;
  return p1 * tIn + p2 * tOut + p3 + p4 * tAmb;
}

function pTh(pac, tIn, tOut) {
  const [p1, p2, p3, p4] = pac.coefPth;
  const tAmb = tIn;
  const pEl = pac.pElRef * (p1 * tIn + p2 * tOut + p3 + p4 * tAmb);
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
  // hplib_database.py qui définit justement "Regulated" comme les modèles dont P_th certifié
  // n'est PAS croissant avec T_in, contrairement aux modèles "On-Off"). On vérifie donc seulement
  // que la grandeur reste dans un ordre de grandeur physique plausible (positive, du même ordre
  // que pthRef), pas une direction de variation.
  const reels = d.pacs.filter((p) => !p.generique);
  const step = Math.max(1, Math.floor(reels.length / 10));
  const echantillon = [];
  for (let i = 0; i < reels.length && echantillon.length < 10; i += step) echantillon.push(reels[i]);

  for (const pac of echantillon) {
    const pthM7 = pTh(pac, -7, 35);
    // Bornes larges (x6) car ce sont des fits least-square (MAPE documenté ~10-20%, cf. README) :
    // avec le pElRef BRUT, le ratio max P_th(-7,35)/pthRef mesuré sur tout le catalogue est 4.61
    // (Clivet ELFOEnergy SHEEN EVO 18.2) ; avec l'approximation fittée pthRef/COP_fitté(-7,52)
    // (à NE PAS utiliser), il monterait à 5.20 (2 modèles > 5x). La borne < 6 couvre les deux
    // méthodes avec marge, tout en excluant une vraie erreur d'unité (kW/W donnerait ~1000x).
    assert.ok(
      Number.isFinite(pthM7) && pthM7 > 0 && pthM7 < 6 * pac.pthRef,
      `${pac.fabricant} ${pac.modele}: P_th(-7,35)=${pthM7}, pthRef=${pac.pthRef}`
    );
  }
});
