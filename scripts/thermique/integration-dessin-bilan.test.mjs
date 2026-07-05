// scripts/thermique/integration-dessin-bilan.test.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Intégration bout-en-bout « dessin → parois → bilan » (plan 3, Task 10) — LE test qui relie les
// trois plans : données de référence (plan 1), moteurs thermiques (plan 2), géométrie (plan 3).
//
// ⚠ BROUILLON D'ASSEMBLEUR : `assembleBatiment()` ci-dessous est le brouillon de l'assembleur du
// plan 4 — le jour où l'assembleur existe, ce test doit être réécrit pour l'utiliser.
//
// Décisions « brouillon assembleur » prises ici (à trancher/confirmer au plan 4) :
//   D1. Pièces principales (ventilation, arrêté du 24/03/1982) = pièces chauffées de typePiece
//       'sejour' ou 'chambre' — la cuisine est une pièce de SERVICE. Maison de référence :
//       séjour + chambre = 2 pièces principales → debitsExtraitsParTaille T2 → debitTotal 60 m³/h.
//       Au-delà de 7, palier T7 reconduit (note de ventilation.json).
//   D2. Pièces humides (extraction, débit soufflé 0) = typePiece ∈ {cuisine, sdb, wc, buanderie}.
//   D3. U porte pleine bois SAISI 3.5 W/(m²·K) — valeur d'essai ; l'assembleur réel prendra le Uw
//       saisi (ou menuiseries.json). Uw fenêtre SAISI 1.3 : u-defauts.json n'a AUCUNE table
//       fenêtre par période (cf. son _meta — uDefautPour(…, 'fenetre', …) → null).
//   D4. b du garage (LNC) : catégorie « Pièce » / « Avec au moins 3 murs extérieurs (par ex.
//       escalier extérieur) » → 0.8 (coefficients-b.json). Le garage a bien 3 murs extérieurs
//       (nord, est, sud — seul l'ouest est mitoyen cuisine). L'assembleur réel devra compter les
//       murs extérieurs du LNC (ou demander à l'UI).
//   D5. Plancher bas terre-plein : b = 1 avec le U plancherBas tabulé TEL QUEL (simplification
//       v1 : le U tabulé est considéré déjà « équivalent » ; pas de méthode ISO 13370 en v1).
//   D6. ΔUtb 0.1 W/(m²·K) uniformément sur TOUTES les parois vers extérieur/LNC (menuiseries,
//       planchers et plafonds compris — terre-plein aussi, assumé) ; 0 sur les mitoyens internes.
//   D7. U d'un mur mitoyen interne = U mur tabulé (pas de table « cloison » en v1) ; sa θréf =
//       thetaAdjacente = θint de la pièce adjacente (lookup dessin), b ignoré par le moteur.
//   D8. Volume d'une pièce = surface × hauteur du niveau (cotes intérieures, murs sans épaisseur).
//   D9. plafond-comble → b « Espace sous toiture » / « Toiture isolée » = 0.7 (comble isolé,
//       choix d'essai) ; toiture-rampant → b extérieur = 1.
//   D10. L'orientation des murs est IGNORÉE par le moteur (portée par la paroi pour l'UI plan 4).
//
// Discipline plans 1-3 : chaque valeur attendue est dérivée À LA MAIN en commentaire (un relecteur
// re-calcule tout) ; toute divergence = erreur de dérivation à corriger ICI, jamais dans le moteur.
// Tolérance 1e-9 : bruit d'arrondi IEEE 754 uniquement — l'arithmétique est fermée (produits et
// sommes de décimaux exacts), aucune approximation métier.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deduireParois, surfaceCm2 } from '../../src/apps/thermique/lib/geometryEngine.js';
import { calculeBatiment } from '../../src/apps/thermique/lib/thermalEngine.js';
import { thetaBasePour, uDefautPour, coefficientBPour } from '../../src/apps/thermique/lib/refDataResolvers.js';

const CLIMAT = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/climat.json', import.meta.url), 'utf8'));
const U_DEFAUTS = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/u-defauts.json', import.meta.url), 'utf8'));
const COEFFICIENTS_B = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/coefficients-b.json', import.meta.url), 'utf8'));
const VENTILATION = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/ventilation.json', import.meta.url), 'utf8'));

/** Égalité au bruit IEEE 754 près (cf. note de tolérance en tête de fichier). */
function proche(reel, attendu, label) {
  assert.ok(Math.abs(reel - attendu) < 1e-9, `${label}: obtenu ${reel}, attendu ${attendu}`);
}

// ————————————————————————————————————————————————————————————————————————————————————————————
// Maison de référence de la Task 6 (geometry-engine.test.mjs) — RDC (h 250 cm) : séjour 500×400
// (θ20) + cuisine 300×400 (θ20, humide) accolée à l'est + garage 300×400 (non chauffé) accolé à
// l'est de la cuisine ; étage (h 250) : chambre 500×400 (θ18) posée exactement sur le séjour.
// Fenêtre séjour 140×120 au sud, porte d'entrée 90×215 au nord. Nord = 0, terre-plein, comble.
// ————————————————————————————————————————————————————————————————————————————————————————————
function maison({ thetaCuisine = 20 } = {}) {
  return {
    nord: 0,
    plancherBasType: 'terre-plein',
    toitureType: 'comble',
    niveaux: [{ id: 'rdc', nom: 'RDC', hauteur: 250 }, { id: 'etage', nom: 'Étage', hauteur: 250 }],
    pieces: [
      { id: 'sejour', niveauId: 'rdc', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }] },
      { id: 'cuisine', niveauId: 'rdc', nom: 'Cuisine', typePiece: 'cuisine', chauffee: true, thetaInt: thetaCuisine,
        polygone: [{ x: 500, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 500, y: 400 }] },
      { id: 'garage', niveauId: 'rdc', nom: 'Garage', typePiece: 'garage', chauffee: false, thetaInt: null,
        polygone: [{ x: 800, y: 0 }, { x: 1100, y: 0 }, { x: 1100, y: 400 }, { x: 800, y: 400 }] },
      { id: 'chambre', niveauId: 'etage', nom: 'Chambre', typePiece: 'chambre', chauffee: true, thetaInt: 18,
        polygone: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }] },
    ],
    ouvertures: [
      { id: 'fen-sejour', pieceId: 'sejour', segmentIndex: 1, type: 'fenetre', largeur: 140, hauteur: 120, position: 180 },
      { id: 'porte-entree', pieceId: 'sejour', segmentIndex: 3, type: 'porte', largeur: 90, hauteur: 215, position: 200 },
    ],
  };
}

// ————————————————————————————————————————————————————————————————————————————————————————————
// LE BROUILLON D'ASSEMBLEUR (plan 4) — dessin + parois (deduireParois) + données de référence
// → bâtiment RÉSOLU au format calculeBatiment. Toutes les décisions D1-D10 de l'en-tête vivent ici.
// ————————————————————————————————————————————————————————————————————————————————————————————
const PIECES_PRINCIPALES = new Set(['sejour', 'chambre']); // D1
const PIECES_HUMIDES = new Set(['cuisine', 'sdb', 'wc', 'buanderie']); // D2
const DELTA_UTB = 0.1; // D6

function assembleBatiment(dessin, parois, options) {
  const { climat, uDefauts, coefficientsB, ventilation, dept, altitude, annee, uFenetre, uPorte, fRH = 0 } = options;
  const thetaExt = thetaBasePour(climat, dept, altitude).thetaE;
  const uMur = uDefautPour(uDefauts, 'mur', annee);
  const uPlancherBas = uDefautPour(uDefauts, 'plancherBas', annee);
  const uPlafond = uDefautPour(uDefauts, 'plafond', annee);
  const bExt = coefficientBPour(coefficientsB, "Paroi donnant directement sur l'extérieur", null);
  const bLnc = coefficientBPour(coefficientsB, 'Pièce', 'Avec au moins 3 murs extérieurs (par ex. escalier extérieur)'); // D4
  const bComble = coefficientBPour(coefficientsB, 'Espace sous toiture', 'Toiture isolée'); // D9

  const thetaDe = (pieceId) => dessin.pieces.find((p) => p.id === pieceId).thetaInt;
  // Menuiserie posée sur un mur mitoyen LNC → b du LNC ; sinon extérieur (le mur porteur décide).
  const bMenuiserie = (paroi) => (paroi.adjacentPieceId !== undefined ? bLnc : bExt);

  const mappe = (paroi) => {
    switch (paroi.type) {
      case 'mur-exterieur':
        return { surface: paroi.surfaceM2, u: uMur, b: bExt, deltaUtb: DELTA_UTB, poste: 'murs' }; // D10 : orientation ignorée
      case 'mur-lnc':
        return { surface: paroi.surfaceM2, u: uMur, b: bLnc, deltaUtb: DELTA_UTB, poste: 'murs' };
      case 'mur-mitoyen-interne': // D7
        return { surface: paroi.surfaceM2, u: uMur, thetaAdjacente: thetaDe(paroi.adjacentPieceId), deltaUtb: 0, poste: 'murs' };
      case 'fenetre':
      case 'porte-fenetre':
        return { surface: paroi.surfaceM2, u: uFenetre, b: bMenuiserie(paroi), deltaUtb: DELTA_UTB, poste: 'menuiseries' };
      case 'porte':
        return { surface: paroi.surfaceM2, u: uPorte, b: bMenuiserie(paroi), deltaUtb: DELTA_UTB, poste: 'menuiseries' };
      case 'plancher-bas': // D5 : terre-plein/vide-sanitaire/sous-sol → b 1, U tabulé tel quel (v1)
      case 'plancher-sur-exterieur': // porte-à-faux : sur air extérieur, b 1
        return { surface: paroi.surfaceM2, u: uPlancherBas, b: 1, deltaUtb: DELTA_UTB, poste: 'plancherBas' };
      case 'plancher-sur-lnc':
        return { surface: paroi.surfaceM2, u: uPlancherBas, b: bLnc, deltaUtb: DELTA_UTB, poste: 'plancherBas' };
      case 'plafond-comble':
        return { surface: paroi.surfaceM2, u: uPlafond, b: bComble, deltaUtb: DELTA_UTB, poste: 'plafondToiture' };
      case 'plafond-sur-lnc':
        return { surface: paroi.surfaceM2, u: uPlafond, b: bLnc, deltaUtb: DELTA_UTB, poste: 'plafondToiture' };
      case 'toiture-rampant': // D9 : rampant = paroi directe sur l'extérieur
        return { surface: paroi.surfaceM2, u: uPlafond, b: bExt, deltaUtb: DELTA_UTB, poste: 'plafondToiture' };
      default:
        throw new Error(`thermique: type de paroi non mappé « ${paroi.type} »`);
    }
  };

  const hauteurs = new Map(dessin.niveaux.map((n) => [n.id, n.hauteur]));
  const chauffees = dessin.pieces.filter((p) => p.chauffee);
  const nbPrincipales = Math.min(7, chauffees.filter((p) => PIECES_PRINCIPALES.has(p.typePiece)).length); // D1
  const taille = ventilation.debitsExtraitsParTaille.find((t) => t.piecesPrincipales === nbPrincipales);
  const systemeVentilation = ventilation.systemes.find((s) => s.id === 'vmc-sf-auto');

  const pieces = chauffees.map((p) => {
    const surface = surfaceCm2(p.polygone) / 10000; // cm² → m² (frontière géométrie → moteur)
    return {
      id: p.id, nom: p.nom, surface,
      volume: surface * (hauteurs.get(p.niveauId) / 100), // D8
      thetaInt: p.thetaInt,
      humide: PIECES_HUMIDES.has(p.typePiece), // D2
      parois: parois.filter((paroi) => paroi.pieceId === p.id).map(mappe),
    };
  });

  // plageVraisemblance volontairement omise (défaut moteur { 0, Infinity } → pas d'alerte).
  return { thetaExt, systemeVentilation, debitTotal: taille.debitTotal, fRH, pieces };
}

const DONNEES = { climat: CLIMAT, uDefauts: U_DEFAUTS, coefficientsB: COEFFICIENTS_B, ventilation: VENTILATION };
// Gaillac (Tarn, dept 81, altitude 134 m) ; construction 1960 → période « avant 1974 ».
const OPTIONS_AVANT_1974 = { ...DONNEES, dept: '81', altitude: 134, annee: 1960, uFenetre: 1.3, uPorte: 3.5, fRH: 0 };
const OPTIONS_2015 = { ...OPTIONS_AVANT_1974, annee: 2015 };

// ————————————————————————————————————————————————————————————————————————————————————————————
// Données réelles résolues — chaque constante du bilan est lue des JSON par les résolveurs
// (aucune valeur inventée : si un JSON change, ce test le signale AVANT les bilans).
// ————————————————————————————————————————————————————————————————————————————————————————————
test('intégration : données réelles résolues (θe Gaillac, U par défaut, b, débit T2)', () => {
  // climat.json : "81": [ { altMax: null, thetaE: -5 } ] — tranche unique, correction d'altitude
  // non appliquée en v1 (l'altitude 134 ne sert qu'au choix de tranche).
  assert.deepEqual(thetaBasePour(CLIMAT, '81', 134), { thetaE: -5, correctionAltitude: 'non-appliquée' });
  // u-defauts.json (Open3CL H1, non-Joule), période « avant 1974 » : mur 2.5 · plancherBas 2 · plafond 2.5.
  assert.equal(uDefautPour(U_DEFAUTS, 'mur', 1960), 2.5);
  assert.equal(uDefautPour(U_DEFAUTS, 'plancherBas', 1960), 2);
  assert.equal(uDefautPour(U_DEFAUTS, 'plafond', 1960), 2.5);
  // Période « après 2012 » (année 2015) : mur 0.23 · plancherBas 0.23 · plafond 0.14.
  assert.equal(uDefautPour(U_DEFAUTS, 'mur', 2015), 0.23);
  assert.equal(uDefautPour(U_DEFAUTS, 'plancherBas', 2015), 0.23);
  assert.equal(uDefautPour(U_DEFAUTS, 'plafond', 2015), 0.14);
  // Pas de Uw par période (cf. _meta de u-defauts.json) → Uw saisi (D3).
  assert.equal(uDefautPour(U_DEFAUTS, 'fenetre', 1960), null);
  // coefficients-b.json — libellés EXACTS relus du JSON :
  assert.equal(coefficientBPour(COEFFICIENTS_B, "Paroi donnant directement sur l'extérieur", null), 1);
  assert.equal(coefficientBPour(COEFFICIENTS_B, 'Pièce', 'Avec au moins 3 murs extérieurs (par ex. escalier extérieur)'), 0.8);
  assert.equal(coefficientBPour(COEFFICIENTS_B, 'Espace sous toiture', 'Toiture isolée'), 0.7);
  // ventilation.json : VMC SF autoréglable (mode debits, facteur 1, rendement 0) ; 2 pièces
  // principales (séjour + chambre, D1) → debitTotal 60 m³/h (arrêté du 24/03/1982, T2).
  const vmc = VENTILATION.systemes.find((s) => s.id === 'vmc-sf-auto');
  assert.equal(vmc.mode, 'debits');
  assert.equal(vmc.facteurDebit, 1);
  assert.equal(vmc.rendement, 0);
  assert.equal(VENTILATION.debitsExtraitsParTaille.find((t) => t.piecesPrincipales === 2).debitTotal, 60);
});

// ————————————————————————————————————————————————————————————————————————————————————————————
// Pré-vol : le dessin de référence est géométriquement sain et produit exactement les 16 parois
// dérivées à la main en Task 6 (les surfaces individuelles y sont déjà épinglées — ici on ne
// re-vérifie que ce dont le bilan dépend : comptes et Σ surfaces par poste).
// ————————————————————————————————————————————————————————————————————————————————————————————
test('intégration : pré-vol — deduireParois de la maison de référence est propre', () => {
  const { parois, erreurs, avertissements } = deduireParois(maison());
  assert.deepEqual(erreurs, []);
  assert.deepEqual(avertissements, []);
  assert.equal(parois.length, 16);
  // séjour 6 (murs O/S/N + fenêtre + porte + plancher) · cuisine 5 (murs S/N + lnc + plancher +
  // plafond) · chambre 5 (4 murs + plafond) · garage 0.
  assert.equal(parois.filter((p) => p.pieceId === 'sejour').length, 6);
  assert.equal(parois.filter((p) => p.pieceId === 'cuisine').length, 5);
  assert.equal(parois.filter((p) => p.pieceId === 'chambre').length, 5);
  assert.equal(parois.filter((p) => p.pieceId === 'garage').length, 0);
});

// ————————————————————————————————————————————————————————————————————————————————————————————
// SCÉNARIO 1 — maison « avant 1974 » (année 1960), VMC SF auto, fRH 0 — BILAN COMPLET À LA MAIN.
//
// Constantes résolues : θe −5 · U mur 2.5 · U plancherBas 2.0 · U plafond 2.5 · Uw 1.3 · Uporte 3.5
// b : ext 1 · garage 0.8 (D4) · comble 0.7 (D9) · terre-plein 1 (D5) · ΔUtb 0.1 partout (D6).
// Surfaces (Task 6, dérivées et épinglées dans geometry-engine.test.mjs) :
//   séjour : murs O 10 · S 10.82 (12.5 − fenêtre 1.68) · N 10.565 (12.5 − porte 1.935) ;
//            fenêtre 1.68 · porte 1.935 · plancher 20 (pas de plafond : sous chambre chauffée)
//   cuisine : murs S 7.5 · N 7.5 · lnc garage 10 · plancher 12 · plafond-comble 12
//   chambre : murs O 10 · S 12.5 · E 10 · N 12.5 · plafond-comble 20 (pas de sol : sur séjour)
//
// ── SÉJOUR (θ20, ΔText = 20 − (−5) = 25 K) — Φ = A·U·b·ΔT ; pont = A·ΔUtb·b·ΔT ──
//   mur O    : 10    × 2.5 × 1 × 25 = 625       ; pont 10    × 0.1 × 1 × 25 = 25
//   mur S    : 10.82 × 2.5 × 1 × 25 = 676.25    ; pont 10.82 × 0.1 × 1 × 25 = 27.05
//   mur N    : 10.565× 2.5 × 1 × 25 = 660.3125  ; pont 10.565× 0.1 × 1 × 25 = 26.4125
//   fenêtre  : 1.68  × 1.3 × 1 × 25 = 54.6      ; pont 1.68  × 0.1 × 1 × 25 = 4.2
//   porte    : 1.935 × 3.5 × 1 × 25 = 169.3125  ; pont 1.935 × 0.1 × 1 × 25 = 4.8375
//   plancher : 20    × 2.0 × 1 × 25 = 1000      ; pont 20    × 0.1 × 1 × 25 = 50
//   parPoste : murs 625 + 676.25 + 660.3125 = 1961.5625 · menuiseries 54.6 + 169.3125 = 223.9125
//              plancherBas 1000 · ponts 25 + 27.05 + 26.4125 + 4.2 + 4.8375 + 50 = 137.5
//   transmission = 1961.5625 + 223.9125 + 1000 + 137.5 = 3322.975 W
//
// ── CUISINE (θ20, ΔText = 25 K ; mur-lnc : ΔTéq = 0.8 × 25 = 20 K ; comble : 0.7 × 25 = 17.5 K) ──
//   mur S    : 7.5 × 2.5 × 1   × 25 = 468.75 ; pont 7.5 × 0.1 × 1   × 25 = 18.75
//   mur N    : 7.5 × 2.5 × 1   × 25 = 468.75 ; pont 18.75
//   mur lnc  : 10  × 2.5 × 0.8 × 25 = 500    ; pont 10  × 0.1 × 0.8 × 25 = 20
//   plancher : 12  × 2.0 × 1   × 25 = 600    ; pont 12  × 0.1 × 1   × 25 = 30
//   plafond  : 12  × 2.5 × 0.7 × 25 = 525    ; pont 12  × 0.1 × 0.7 × 25 = 21
//   parPoste : murs 468.75 + 468.75 + 500 = 1437.5 · plancherBas 600 · plafondToiture 525
//              ponts 18.75 + 18.75 + 20 + 30 + 21 = 108.5
//   transmission = 1437.5 + 600 + 525 + 108.5 = 2671 W
//
// ── CHAMBRE (θ18, ΔText = 18 − (−5) = 23 K ; comble : 0.7 × 23 = 16.1 K) ──
//   murs O+S+E+N = (10 + 12.5 + 10 + 12.5) = 45 m² × 2.5 × 1 × 23 = 2587.5
//     (détail : O 575 · S 718.75 · E 575 · N 718.75) ; ponts murs 45 × 0.1 × 23 = 103.5
//   plafond  : 20 × 2.5 × 0.7 × 23 = 805 ; pont 20 × 0.1 × 0.7 × 23 = 32.2
//   parPoste : murs 2587.5 · plafondToiture 805 · ponts 103.5 + 32.2 = 135.7
//   transmission = 2587.5 + 805 + 135.7 = 3528.2 W
//
// ── VENTILATION (VMC SF auto, debitTotal 60, rendement 0) ──
//   Volumes (D8) : séjour 20 × 2.5 = 50 m³ (sec) · cuisine 12 × 2.5 = 30 (HUMIDE, D2) ·
//   chambre 20 × 2.5 = 50 (sec). Volume sec = 100 m³ → séjour 60 × 50/100 = 30 m³/h ·
//   chambre 30 · cuisine 0 (extraction).
//   ΦV séjour = 0.34 × 30 × 25 = 255 W · chambre = 0.34 × 30 × 23 = 234.6 W · cuisine 0.
//   Ventilation totale = 489.6 W. Relance : fRH 0 → 0.
//
// ── TOTAUX ──
//   séjour 3322.975 + 255 = 3577.975 · cuisine 2671 + 0 = 2671 · chambre 3528.2 + 234.6 = 3762.8
//   TOTAL bâtiment = 3577.975 + 2671 + 3762.8 = 10011.775 W
//   parPoste : murs 1961.5625 + 1437.5 + 2587.5 = 5986.5625 · menuiseries 223.9125 ·
//              plancherBas 1000 + 600 = 1600 · plafondToiture 525 + 805 = 1330 ·
//              ponts 137.5 + 108.5 + 135.7 = 381.7 · ventilation 489.6 · relance 0
//              (contrôle : 5986.5625 + 223.9125 + 1600 + 1330 + 381.7 + 489.6 = 10011.775 ✓)
//   θint moyenne pondérée surfaces = (20×20 + 20×12 + 18×20)/52 = 1000/52 ≈ 19.2308 °C
//   GV = 10011.775 / (1000/52 + 5) = 10011.775 / (1260/52) ≈ 413.1844 W/K
//   ratio = 10011.775 / 52 ≈ 192.53 W/m² (maison non isolée d'avant 1974 — élevé, cohérent ;
//   plageVraisemblance omise → défaut { 0, ∞ } → pas d'alerte)
//   fourchette : min = round(10011.775 × 0.95) = round(9511.18625) = 9511
//                max = round(10011.775 × 1.10) = round(11012.9525) = 11013
// ————————————————————————————————————————————————————————————————————————————————————————————
test('intégration : scénario 1 — maison avant 1974, dessin → parois → bilan complet', () => {
  const dessin = maison();
  const { parois, erreurs, avertissements } = deduireParois(dessin);
  assert.deepEqual(erreurs, []);
  assert.deepEqual(avertissements, []);

  const batiment = assembleBatiment(dessin, parois, OPTIONS_AVANT_1974);
  // Structure du bâtiment assemblé (frontière géométrie → moteur).
  assert.equal(batiment.thetaExt, -5);
  assert.equal(batiment.debitTotal, 60);
  assert.equal(batiment.systemeVentilation.id, 'vmc-sf-auto');
  assert.equal(batiment.pieces.length, 3); // chauffées seulement — le garage n'entre pas au bilan
  assert.deepEqual(batiment.pieces.map((p) => p.id), ['sejour', 'cuisine', 'chambre']);
  assert.deepEqual(batiment.pieces.map((p) => p.humide), [false, true, false]);
  assert.deepEqual(batiment.pieces.map((p) => p.volume), [50, 30, 50]);
  assert.deepEqual(batiment.pieces.map((p) => p.parois.length), [6, 5, 5]);

  const r = calculeBatiment(batiment);
  const [sejour, cuisine, chambre] = r.pieces;

  // Séjour
  proche(sejour.parPoste.murs, 1961.5625, 'séjour murs');
  proche(sejour.parPoste.menuiseries, 223.9125, 'séjour menuiseries');
  proche(sejour.parPoste.plancherBas, 1000, 'séjour plancherBas');
  proche(sejour.parPoste.pontsThermiques, 137.5, 'séjour ponts');
  assert.equal(sejour.parPoste.plafondToiture, undefined); // sous la chambre chauffée : rien
  proche(sejour.transmission, 3322.975, 'transmission séjour');
  proche(sejour.ventilation, 255, 'ventilation séjour');
  assert.equal(sejour.relance, 0);
  proche(sejour.total, 3577.975, 'total séjour');

  // Cuisine
  proche(cuisine.parPoste.murs, 1437.5, 'cuisine murs');
  proche(cuisine.parPoste.plancherBas, 600, 'cuisine plancherBas');
  proche(cuisine.parPoste.plafondToiture, 525, 'cuisine plafond');
  proche(cuisine.parPoste.pontsThermiques, 108.5, 'cuisine ponts');
  assert.equal(cuisine.parPoste.menuiseries, undefined);
  proche(cuisine.transmission, 2671, 'transmission cuisine');
  assert.equal(cuisine.ventilation, 0); // humide : extraction, pas d'air neuf direct
  proche(cuisine.total, 2671, 'total cuisine');

  // Chambre
  proche(chambre.parPoste.murs, 2587.5, 'chambre murs');
  proche(chambre.parPoste.plafondToiture, 805, 'chambre plafond');
  proche(chambre.parPoste.pontsThermiques, 135.7, 'chambre ponts');
  assert.equal(chambre.parPoste.plancherBas, undefined); // sur le séjour chauffé : rien
  proche(chambre.transmission, 3528.2, 'transmission chambre');
  proche(chambre.ventilation, 234.6, 'ventilation chambre');
  proche(chambre.total, 3762.8, 'total chambre');

  // Bâtiment
  proche(r.total, 10011.775, 'total bâtiment');
  proche(r.parPoste.murs, 5986.5625, 'murs');
  proche(r.parPoste.menuiseries, 223.9125, 'menuiseries');
  proche(r.parPoste.plancherBas, 1600, 'plancherBas');
  proche(r.parPoste.plafondToiture, 1330, 'plafondToiture');
  proche(r.parPoste.pontsThermiques, 381.7, 'pontsThermiques');
  proche(r.parPoste.ventilation, 489.6, 'ventilation');
  assert.equal(r.parPoste.relance, 0);
  proche(r.gv, 10011.775 / (1000 / 52 + 5), 'gv'); // ≈ 413.1844 W/K
  proche(r.ratioWm2, 10011.775 / 52, 'ratioWm2'); // ≈ 192.53 W/m²
  assert.deepEqual(r.fourchette, { min: 9511, max: 11013 });
  assert.equal(r.alerteVraisemblance, false); // plage par défaut { 0, ∞ }

  // Invariants : total === Σ parPoste (relance incluse) === Σ pieces[].total
  proche(Object.values(r.parPoste).reduce((s, v) => s + v, 0), r.total, 'Σ parPoste');
  proche(r.pieces.reduce((s, p) => s + p.total, 0), r.total, 'Σ pièces');
});

// ————————————————————————————————————————————————————————————————————————————————————————————
// SCÉNARIO 2 — même maison, année 2015 (« après 2012 » : mur 0.23 · plancherBas 0.23 · plafond
// 0.14), cuisine à θ15. Focalisé sur les MÉCANISMES du delta : |20 − 15| = 5 > 4 K → le mur
// séjour↔cuisine (10 m²) est émis en mitoyen-interne DES DEUX CÔTÉS (θadjacente explicite,
// ΔUtb 0, D7) et les totaux s'effondrent (isolation récente).
//
// ── SÉJOUR (θ20, ΔText 25 K) ──
//   murs ext : (10 + 10.82 + 10.565) = 31.385 m² × 0.23 × 25 = 180.46375
//   mitoyen  : 10 × 0.23 × (20 − 15) = +11.5 (pont 0) → murs 180.46375 + 11.5 = 191.96375
//   fenêtre 54.6 + porte 169.3125 = menuiseries 223.9125 (Uw saisis, inchangés)
//   plancher : 20 × 0.23 × 25 = 115 ; ponts (mêmes A que scénario 1) : 55 × 0.1 × 25 = 137.5
//   transmission = 191.96375 + 223.9125 + 115 + 137.5 = 668.37625 ; + vent 255 → total 923.37625
//
// ── CUISINE (θ15, ΔText = 15 − (−5) = 20 K ; lnc 0.8 × 20 = 16 K ; comble 0.7 × 20 = 14 K) ──
//   murs S+N : 2 × (7.5 × 0.23 × 20) = 2 × 34.5 = 69 ; lnc : 10 × 0.23 × 16 = 36.8
//   mitoyen  : 10 × 0.23 × (15 − 20) = −11.5 (apport du séjour) → murs 69 + 36.8 − 11.5 = 94.3
//   plancher : 12 × 0.23 × 20 = 55.2 ; plafond : 12 × 0.14 × 14 = 23.52
//   ponts : S 15 + N 15 + lnc 10 × 0.1 × 16 = 16 + plancher 24 + plafond 12 × 0.1 × 14 = 16.8 → 86.8
//   transmission = 94.3 + 55.2 + 23.52 + 86.8 = 259.82 ; + vent 0 → total 259.82
//
// ── CHAMBRE (θ18, ΔText 23 K ; comble 16.1 K) ──
//   murs : 45 × 0.23 × 23 = 238.05 ; plafond : 20 × 0.14 × 16.1 = 45.08
//   ponts : 45 × 0.1 × 23 = 103.5 + 20 × 0.1 × 16.1 = 32.2 → 135.7
//   transmission = 238.05 + 45.08 + 135.7 = 418.83 ; + vent 234.6 → total 653.43
//
// ── BÂTIMENT ──
//   Ventilation inchangée (mêmes volumes secs, cuisine humide → 0) : 255 + 234.6 = 489.6 W.
//   TOTAL = 923.37625 + 259.82 + 653.43 = 1836.62625 W (≈ 18 % du scénario 1 : 10011.775 W)
//   parPoste : murs 191.96375 + 94.3 + 238.05 = 524.31375 (les ±11.5 du mitoyen s'annulent à
//              l'échelle bâtiment) · menuiseries 223.9125 · plancherBas 115 + 55.2 = 170.2 ·
//              plafondToiture 23.52 + 45.08 = 68.6 · ponts 137.5 + 86.8 + 135.7 = 360 ·
//              ventilation 489.6 · relance 0
//              (contrôle : 524.31375 + 223.9125 + 170.2 + 68.6 + 360 + 489.6 = 1836.62625 ✓)
//   θint moyenne = (20×20 + 15×12 + 18×20)/52 = 940/52 ≈ 18.0769 °C
//   GV = 1836.62625 / (940/52 + 5) = 1836.62625 / (1200/52) = 79.5871375 W/K
//   fourchette : min = round(1836.62625 × 0.95) = round(1744.7949375) = 1745
//                max = round(1836.62625 × 1.10) = round(2020.288875) = 2020
// ————————————————————————————————————————————————————————————————————————————————————————————
test('intégration : scénario 2 — année 2015, cuisine à 15 °C : mitoyen interne ±11.5 W, totaux effondrés', () => {
  const dessin = maison({ thetaCuisine: 15 });
  const { parois, erreurs, avertissements } = deduireParois(dessin);
  assert.deepEqual(erreurs, []);
  assert.deepEqual(avertissements, []);
  assert.equal(parois.length, 18); // 16 de référence + 2 mitoyens internes (ΔT 5 > 4 K)
  assert.equal(parois.filter((p) => p.type === 'mur-mitoyen-interne').length, 2);

  const batiment = assembleBatiment(dessin, parois, OPTIONS_2015);
  assert.deepEqual(batiment.pieces.map((p) => p.parois.length), [7, 6, 5]);
  // Le mitoyen est mappé en θadjacente explicite, ΔUtb 0 (D7) — le b est ignoré par le moteur.
  const mitoyenSejour = batiment.pieces[0].parois.find((p) => p.thetaAdjacente !== undefined);
  assert.deepEqual(mitoyenSejour, { surface: 10, u: 0.23, thetaAdjacente: 15, deltaUtb: 0, poste: 'murs' });
  const mitoyenCuisine = batiment.pieces[1].parois.find((p) => p.thetaAdjacente !== undefined);
  assert.deepEqual(mitoyenCuisine, { surface: 10, u: 0.23, thetaAdjacente: 20, deltaUtb: 0, poste: 'murs' });

  const r = calculeBatiment(batiment);
  const [sejour, cuisine, chambre] = r.pieces;

  // Mécanisme mitoyen : +11.5 W côté séjour, −11.5 W côté cuisine (apport), nul à l'échelle bâtiment.
  proche(sejour.parPoste.murs, 191.96375, 'séjour murs (180.46375 ext + 11.5 mitoyen)');
  proche(cuisine.parPoste.murs, 94.3, 'cuisine murs (69 + 36.8 lnc − 11.5 mitoyen)');
  proche(sejour.transmission, 668.37625, 'transmission séjour');
  proche(cuisine.transmission, 259.82, 'transmission cuisine');
  proche(chambre.transmission, 418.83, 'transmission chambre');
  proche(sejour.total, 923.37625, 'total séjour');
  proche(cuisine.total, 259.82, 'total cuisine');
  proche(chambre.total, 653.43, 'total chambre');

  // Bâtiment : totaux effondrés vs scénario 1 (isolation récente).
  proche(r.total, 1836.62625, 'total bâtiment');
  assert.ok(r.total < 10011.775 / 5, 'total 2015 < 20 % du total avant-1974');
  proche(r.parPoste.murs, 524.31375, 'murs (±11.5 mitoyens annulés)');
  proche(r.parPoste.menuiseries, 223.9125, 'menuiseries (Uw saisis inchangés)');
  proche(r.parPoste.plancherBas, 170.2, 'plancherBas');
  proche(r.parPoste.plafondToiture, 68.6, 'plafondToiture');
  proche(r.parPoste.pontsThermiques, 360, 'pontsThermiques');
  proche(r.parPoste.ventilation, 489.6, 'ventilation');
  proche(r.gv, 1836.62625 / (940 / 52 + 5), 'gv'); // = 79.5871375 W/K
  assert.deepEqual(r.fourchette, { min: 1745, max: 2020 });
  assert.equal(r.alerteVraisemblance, false);

  // Invariants
  proche(Object.values(r.parPoste).reduce((s, v) => s + v, 0), r.total, 'Σ parPoste');
  proche(r.pieces.reduce((s, p) => s + p.total, 0), r.total, 'Σ pièces');
});

// ————————————————————————————————————————————————————————————————————————————————————————————
// Garde-fou perf — PAS un benchmark : la chaîne complète est de l'arithmétique pure sur ~16
// parois, elle doit se compter en fractions de ms. 50 ms = tripwire généreux qui ne détecte
// qu'une régression algorithmique grossière (boucle quadratique accidentelle, I/O parasite…).
// ————————————————————————————————————————————————————————————————————————————————————————————
test('intégration : garde-fou perf — chaîne complète dessin → parois → bilan < 50 ms', () => {
  const t0 = process.hrtime.bigint();
  const dessin = maison();
  const { parois, erreurs } = deduireParois(dessin);
  assert.deepEqual(erreurs, []);
  const r = calculeBatiment(assembleBatiment(dessin, parois, OPTIONS_AVANT_1974));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(Number.isFinite(r.total) && r.total > 0);
  assert.ok(ms < 50, `chaîne complète en ${ms.toFixed(3)} ms (attendu < 50 ms)`);
});
