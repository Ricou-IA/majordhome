// scripts/thermique/validation-croisee.test.mjs
// Cas de non-régression calculés à la main (plan 2, Task 11) — épinglage du moteur avant la
// phase de validation A/B contre le logiciel historique (protocole : docs/thermique-validation.md).
// Chaque terme est dérivé en commentaire pour qu'un relecteur puisse tout re-calculer à la main.
// Tolérance 1e-9 : n'absorbe que le bruit d'arrondi IEEE 754 — toute l'arithmétique est fermée
// (produits/sommes de décimaux), il n'y a aucune approximation métier dans ces assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculeUParoi, calculeBatiment } from '../../src/apps/thermique/lib/thermalEngine.js';
import { coefficientBPour } from '../../src/apps/thermique/lib/refDataResolvers.js';

const coefficientsB = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/coefficients-b.json', import.meta.url), 'utf8'));
const ventilation = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/ventilation.json', import.meta.url), 'utf8'));

/** Égalité au bruit IEEE 754 près (1e-9) — cf. note de tolérance en tête de fichier. */
function proche(actual, attendu, label) {
  assert.ok(Math.abs(actual - attendu) < 1e-9, `${label}: obtenu ${actual}, attendu ${attendu}`);
}

// ————————————————————————————————————————————————————————————————————————————
// Cas 1 — pièce unique, tout paramétré en littéraux (aucune résolution de données).
// Séjour 25 m² × 2.5 m = 62.5 m³ ; θint 20 °C ; θe −7 °C → ΔText = 20 − (−7) = 27 K.
// ————————————————————————————————————————————————————————————————————————————
test('validation croisée — cas 1 : pièce unique, ventilation naturelle, fRH 0', () => {
  // ——— Transmission poste par poste (Φ = A × U × b × ΔT ; ponts : A × ΔUtb × b × ΔT) ———
  // Mur ext (murs)          : 15 × 0.42 × 1   × 27 = 6.30 × 27 = 170.10 W
  //   ΔUtb                  : 15 × 0.08 × 1   × 27 = 1.20 × 27 =  32.40 W
  // Fenêtre (menuiseries)   :  3 × 1.40 × 1   × 27 = 4.20 × 27 = 113.40 W
  //   ΔUtb                  :  3 × 0.08 × 1   × 27 = 0.24 × 27 =   6.48 W
  // Plancher bas sur vide sanitaire (plancherBas, b 0.5, ΔUtb 0) :
  //                           25 × 0.30 × 0.5 × 27 = 3.75 × 27 = 101.25 W
  // Plafond sous comble isolé (plafondToiture, b 0.7, ΔUtb 0) :
  //                           25 × 0.20 × 0.7 × 27 = 3.50 × 27 =  94.50 W
  // parPoste : murs 170.10 ; menuiseries 113.40 ; plancherBas 101.25 ; plafondToiture 94.50 ;
  //            pontsThermiques 32.40 + 6.48 = 38.88
  // Transmission totale = 170.10 + 113.40 + 101.25 + 94.50 + 38.88 = 518.13 W
  //
  // ——— Ventilation naturelle (mode taux, pièce sèche → taux défaut 0.5 vol/h) ———
  // Débit = 0.5 × 62.5 = 31.25 m³/h ; ΦV = 0.34 × 31.25 × 27 × (1 − 0) = 10.625 × 27 = 286.875 W
  //
  // ——— Relance : fRH 0 → 0 W ———
  //
  // ——— Bilan ———
  // total = 518.13 + 286.875 = 805.005 W
  // θint moyenne = 20 (une seule pièce) → gv = (805.005 − 0)/(20 − (−7)) = 805.005/27 = 29.815 W/K
  // ratioWm2 = 805.005/25 = 32.2002 W/m² ∈ [20, 120] → alerteVraisemblance false
  // fourchette : min = round(805.005 × 0.95) = round(764.75475) = 765
  //              max = round(805.005 × 1.10) = round(885.5055)  = 886
  const r = calculeBatiment({
    thetaExt: -7,
    systemeVentilation: { id: 'naturelle', mode: 'taux', tauxParPiece: { defaut: 0.5, humide: 1.0 } },
    debitTotal: null,
    fRH: 0,
    plageVraisemblance: { min: 20, max: 120 },
    pieces: [
      {
        id: 'sejour', nom: 'Séjour', surface: 25, volume: 62.5, thetaInt: 20, humide: false,
        parois: [
          { surface: 15, u: 0.42, b: 1, deltaUtb: 0.08, poste: 'murs' },          // mur extérieur
          { surface: 3, u: 1.4, b: 1, deltaUtb: 0.08, poste: 'menuiseries' },     // fenêtre
          { surface: 25, u: 0.30, b: 0.5, deltaUtb: 0, poste: 'plancherBas' },    // sur vide sanitaire
          { surface: 25, u: 0.20, b: 0.7, deltaUtb: 0, poste: 'plafondToiture' }, // sous comble isolé
        ],
      },
    ],
  });

  assert.equal(r.pieces.length, 1);
  const [sejour] = r.pieces;
  proche(sejour.transmission, 518.13, 'transmission séjour');
  proche(sejour.ventilation, 286.875, 'ventilation séjour');
  assert.equal(sejour.relance, 0);
  proche(sejour.total, 805.005, 'total séjour');
  proche(sejour.parPoste.murs, 170.10, 'murs');
  proche(sejour.parPoste.menuiseries, 113.40, 'menuiseries');
  proche(sejour.parPoste.plancherBas, 101.25, 'plancherBas');
  proche(sejour.parPoste.plafondToiture, 94.50, 'plafondToiture');
  proche(sejour.parPoste.pontsThermiques, 38.88, 'pontsThermiques');

  proche(r.total, 805.005, 'total bâtiment');
  proche(r.gv, 805.005 / 27, 'gv'); // = 29.815 W/K
  proche(r.ratioWm2, 32.2002, 'ratioWm2');
  assert.deepEqual(r.fourchette, { min: 765, max: 886 });
  assert.equal(r.alerteVraisemblance, false);

  // Invariant : total === Σ parPoste (relance incluse) === Σ pieces[].total
  const sommePostes = Object.values(r.parPoste).reduce((s, v) => s + v, 0);
  proche(sommePostes, r.total, 'Σ parPoste');
  proche(r.pieces.reduce((s, p) => s + p.total, 0), r.total, 'Σ pièces');
});

// ————————————————————————————————————————————————————————————————————————————
// Cas 2 — maison 4 pièces type, VMC SF autoréglable, fRH 11 — intégration résolveurs + moteur :
// le U du mur extérieur vient de calculeUParoi (composition), les b de coefficientBPour
// (coefficients-b.json réel), le débit total et le système de ventilation de ventilation.json.
// θe −5 °C.
// ————————————————————————————————————————————————————————————————————————————
test('validation croisée — cas 2 : maison 4 pièces, VMC SF auto, fRH 11 (résolveurs + moteur)', () => {
  // ——— U du mur extérieur par composition (calculeUParoi, type mur → Rsi+Rse = 0.17) ———
  // Parpaing creux 20 cm (R conventionnel 0.23 m²·K/W) + laine de verre 8.4 cm (λ 0.04) :
  // R = 0.17 + 0.23 + 0.084/0.04 = 0.17 + 0.23 + 2.1 = 2.5 → U = 1/2.5 = 0.40 W/(m²·K)
  const uMurExt = calculeUParoi([{ r: 0.23 }, { e: 0.084, lambda: 0.04 }], 'mur');
  proche(uMurExt, 0.4, 'U mur extérieur composé');

  // ——— Coefficients b résolus sur le vrai coefficients-b.json ———
  const bExt = coefficientBPour(coefficientsB, "Paroi donnant directement sur l'extérieur", null);
  const bComble = coefficientBPour(coefficientsB, 'Espace sous toiture', 'Toiture isolée');
  const bVideSanitaire = coefficientBPour(coefficientsB, 'Vide sanitaire', 'Vide sanitaire très faiblement ventilé');
  assert.equal(bExt, 1);
  assert.equal(bComble, 0.7);
  assert.equal(bVideSanitaire, 0.5);

  // ——— Ventilation depuis ventilation.json : logement T4 → 4 pièces principales → 90 m³/h ———
  // (Vérifié sur la table debitsExtraitsParTaille : piecesPrincipales 4 → debitTotal 90.
  //  NB : 105 m³/h correspond à 5 pièces principales, pas à un T4.)
  const t4 = ventilation.debitsExtraitsParTaille.find((t) => t.piecesPrincipales === 4);
  assert.equal(t4.debitTotal, 90);
  const vmcSfAuto = ventilation.systemes.find((s) => s.id === 'vmc-sf-auto');
  assert.equal(vmcSfAuto.mode, 'debits');
  assert.equal(vmcSfAuto.facteurDebit, 1);
  assert.equal(vmcSfAuto.rendement, 0);

  // ——— Transmission pièce par pièce (Φ = A × U × b × ΔT ; ponts : A × ΔUtb × b × ΔT) ———
  // Séjour (30 m², 75 m³, θint 20, sec) — ΔText = 20 − (−5) = 25 K :
  //   Mur ext  : 18 × 0.40 × 1 × 25 = 180.00 W ; ΔUtb : 18 × 0.08 × 1 × 25 = 36.00 W
  //   Fenêtres :  4 × 1.40 × 1 × 25 = 140.00 W ; ΔUtb :  4 × 0.08 × 1 × 25 =  8.00 W
  //   → transmission 364.00 (murs 180, menuiseries 140, pontsThermiques 44)
  // Chambre (12 m², 30 m³, θint 18, sec) — ΔText = 18 − (−5) = 23 K :
  //   Mur ext : 10 × 0.40 × 1 × 23 = 92.00 W ; ΔUtb : 10 × 0.08 × 1 × 23 = 18.40 W
  //   Plafond sous comble isolé : 12 × 0.25 × 0.7 × 23 = 2.10 × 23 = 48.30 W (ΔUtb 0)
  //   → transmission 158.70 (murs 92, plafondToiture 48.30, pontsThermiques 18.40)
  // Cuisine (10 m², 25 m³, θint 20, humide) — ΔText = 25 K :
  //   Mur ext : 8 × 0.40 × 1 × 25 = 80.00 W ; ΔUtb : 8 × 0.08 × 1 × 25 = 16.00 W
  //   Plancher bas sur vide sanitaire : 10 × 0.30 × 0.5 × 25 = 1.50 × 25 = 37.50 W (ΔUtb 0)
  //   → transmission 133.50 (murs 80, plancherBas 37.50, pontsThermiques 16)
  // SdB (6 m², 15 m³, θint 22, humide) — ΔText = 22 − (−5) = 27 K :
  //   Mur ext : 6 × 0.40 × 1 × 27 = 64.80 W ; ΔUtb : 6 × 0.08 × 1 × 27 = 12.96 W
  //   → transmission 77.76 (murs 64.80, pontsThermiques 12.96)
  //
  // ——— Ventilation (mode debits) : l'air neuf entre par les pièces sèches, humides à 0 ———
  // Volume sec = 75 + 30 = 105 m³ ; débit effectif = 90 × 1 = 90 m³/h
  //   Séjour  : 90 × 75/105 = 450/7  ≈ 64.2857142857 m³/h
  //             ΦV = 0.34 × 450/7 × 25 = 3825/7   ≈ 546.4285714286 W
  //   Chambre : 90 × 30/105 = 180/7  ≈ 25.7142857143 m³/h
  //             ΦV = 0.34 × 180/7 × 23 = 1407.6/7 ≈ 201.0857142857 W
  //   Cuisine / SdB (humides, extraction) : 0 W
  //   Ventilation totale = 5232.6/7 ≈ 747.5142857143 W
  //
  // ——— Relance : fRH 11 W/m² ———
  //   Séjour 30 × 11 = 330 ; Chambre 12 × 11 = 132 ; Cuisine 10 × 11 = 110 ; SdB 6 × 11 = 66
  //   Relance totale = 638 W
  //
  // ——— Totaux par pièce ———
  //   Séjour  : 364.00 + 3825/7 + 330  ≈ 1240.4285714286 W
  //   Chambre : 158.70 + 1407.6/7 + 132 ≈ 491.7857142857 W
  //   Cuisine : 133.50 + 0 + 110 = 243.50 W
  //   SdB     :  77.76 + 0 +  66 = 143.76 W
  //
  // ——— Bilan bâtiment ———
  // transmission totale = 364 + 158.70 + 133.50 + 77.76 = 733.96 W
  // total = 733.96 + 5232.6/7 + 638 ≈ 2119.4742857143 W
  // parPoste : murs 180+92+80+64.80 = 416.80 ; menuiseries 140 ; plancherBas 37.50 ;
  //            plafondToiture 48.30 ; pontsThermiques 44+18.40+16+12.96 = 91.36 ;
  //            ventilation ≈ 747.5142857143 ; relance 638
  //            (contrôle : 416.80+140+37.50+48.30+91.36 = 733.96 ✓)
  // θint moyenne pondérée surface = (20×30 + 18×12 + 20×10 + 22×6)/58 = 1148/58 ≈ 19.7931 °C
  // gv (relance exclue) = (2119.4742857143 − 638)/(1148/58 − (−5))
  //                     = 1481.4742857143/24.7931034483 ≈ 59.7535 W/K
  // ratioWm2 = 2119.4742857143/58 ≈ 36.5427 W/m² ∈ [25, 120] → alerteVraisemblance false
  // fourchette : min = round(2119.4742857143 × 0.95) = round(2013.5005714286) = 2014
  //              max = round(2119.4742857143 × 1.10) = round(2331.4217142857) = 2331
  const r = calculeBatiment({
    thetaExt: -5,
    systemeVentilation: vmcSfAuto,
    debitTotal: t4.debitTotal,
    fRH: 11,
    plageVraisemblance: { min: 25, max: 120 },
    pieces: [
      {
        id: 'sejour', nom: 'Séjour', surface: 30, volume: 75, thetaInt: 20, humide: false,
        parois: [
          { surface: 18, u: uMurExt, b: bExt, deltaUtb: 0.08, poste: 'murs' },
          { surface: 4, u: 1.4, b: bExt, deltaUtb: 0.08, poste: 'menuiseries' },
        ],
      },
      {
        id: 'chambre', nom: 'Chambre', surface: 12, volume: 30, thetaInt: 18, humide: false,
        parois: [
          { surface: 10, u: uMurExt, b: bExt, deltaUtb: 0.08, poste: 'murs' },
          { surface: 12, u: 0.25, b: bComble, deltaUtb: 0, poste: 'plafondToiture' },
        ],
      },
      {
        id: 'cuisine', nom: 'Cuisine', surface: 10, volume: 25, thetaInt: 20, humide: true,
        parois: [
          { surface: 8, u: uMurExt, b: bExt, deltaUtb: 0.08, poste: 'murs' },
          { surface: 10, u: 0.30, b: bVideSanitaire, deltaUtb: 0, poste: 'plancherBas' },
        ],
      },
      {
        id: 'sdb', nom: 'Salle de bain', surface: 6, volume: 15, thetaInt: 22, humide: true,
        parois: [
          { surface: 6, u: uMurExt, b: bExt, deltaUtb: 0.08, poste: 'murs' },
        ],
      },
    ],
  });

  // Pièces (ordre d'entrée conservé)
  assert.equal(r.pieces.length, 4);
  const [sejour, chambre, cuisine, sdb] = r.pieces;

  proche(sejour.transmission, 364, 'transmission séjour');
  proche(sejour.ventilation, 3825 / 7, 'ventilation séjour');
  assert.equal(sejour.relance, 330);
  proche(sejour.total, 364 + 3825 / 7 + 330, 'total séjour'); // ≈ 1240.43 W
  proche(sejour.parPoste.murs, 180, 'séjour murs');
  proche(sejour.parPoste.menuiseries, 140, 'séjour menuiseries');
  proche(sejour.parPoste.pontsThermiques, 44, 'séjour ponts');

  proche(chambre.transmission, 158.70, 'transmission chambre');
  proche(chambre.ventilation, 1407.6 / 7, 'ventilation chambre');
  assert.equal(chambre.relance, 132);
  proche(chambre.total, 158.70 + 1407.6 / 7 + 132, 'total chambre'); // ≈ 491.79 W
  proche(chambre.parPoste.murs, 92, 'chambre murs');
  proche(chambre.parPoste.plafondToiture, 48.30, 'chambre plafond');
  proche(chambre.parPoste.pontsThermiques, 18.40, 'chambre ponts');

  proche(cuisine.transmission, 133.50, 'transmission cuisine');
  assert.equal(cuisine.ventilation, 0); // pièce humide : extraction, pas d'air neuf direct
  assert.equal(cuisine.relance, 110);
  proche(cuisine.total, 243.50, 'total cuisine');
  proche(cuisine.parPoste.plancherBas, 37.50, 'cuisine plancherBas');

  proche(sdb.transmission, 77.76, 'transmission sdb');
  assert.equal(sdb.ventilation, 0);
  assert.equal(sdb.relance, 66);
  proche(sdb.total, 143.76, 'total sdb');

  // Agrégats bâtiment
  const totalAttendu = 733.96 + 5232.6 / 7 + 638; // ≈ 2119.4742857143 W
  proche(r.total, totalAttendu, 'total bâtiment');
  proche(r.parPoste.murs, 416.80, 'murs');
  proche(r.parPoste.menuiseries, 140, 'menuiseries');
  proche(r.parPoste.plancherBas, 37.50, 'plancherBas');
  proche(r.parPoste.plafondToiture, 48.30, 'plafondToiture');
  proche(r.parPoste.pontsThermiques, 91.36, 'pontsThermiques');
  proche(r.parPoste.ventilation, 5232.6 / 7, 'ventilation');
  assert.equal(r.parPoste.relance, 638);

  proche(r.gv, (totalAttendu - 638) / (1148 / 58 + 5), 'gv'); // ≈ 59.7535 W/K
  proche(r.ratioWm2, totalAttendu / 58, 'ratioWm2'); // ≈ 36.5427 W/m²
  assert.deepEqual(r.fourchette, { min: 2014, max: 2331 });
  assert.equal(r.alerteVraisemblance, false);

  // Invariant : total === Σ parPoste (relance incluse) === Σ pieces[].total
  const sommePostes = Object.values(r.parPoste).reduce((s, v) => s + v, 0);
  proche(sommePostes, r.total, 'Σ parPoste');
  proche(r.pieces.reduce((s, p) => s + p.total, 0), r.total, 'Σ pièces');
});
