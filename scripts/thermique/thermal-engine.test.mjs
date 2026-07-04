// scripts/thermique/thermal-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculeUParoi, RSI_RSE, transmissionPiece, POSTES, debitsParPiece, ventilationPiece, relancePiece, calculeBatiment } from '../../src/apps/thermique/lib/thermalEngine.js';

test('calculeUParoi : mur parpaing + laine de verre + placo', () => {
  // Rsi+Rse mur vertical = 0.13+0.04 = 0.17 (EN ISO 6946)
  // R = 0.20/1.053 (0.18994) + 0.10/0.04 (2.5) + 0.013/0.25 (0.052) = 2.74194
  // U = 1/(0.17+2.74194) = 1/2.91194 = 0.34341
  const u = calculeUParoi([
    { e: 0.20, lambda: 1.053 },
    { e: 0.10, lambda: 0.04 },
    { e: 0.013, lambda: 0.25 },
  ], 'mur');
  assert.ok(Math.abs(u - 0.3434) < 0.0005, `U=${u}`);
});

test('calculeUParoi : résistance R directe acceptée dans une couche (ex. lame d’air R=0.18)', () => {
  // R = 0.18 + 0.10/0.04 = 2.68 ; U = 1/(0.17+2.68) = 1/2.85 = 0.35088
  const u = calculeUParoi([{ r: 0.18 }, { e: 0.10, lambda: 0.04 }], 'mur');
  assert.ok(Math.abs(u - 0.3509) < 0.0005, `U=${u}`);
});

test('calculeUParoi : Rsi/Rse selon le type de paroi (plancher/plafond ≠ mur)', () => {
  assert.equal(RSI_RSE.mur, 0.17);
  assert.equal(RSI_RSE.plafond, 0.14);   // flux ascendant : 0.10 + 0.04
  assert.equal(RSI_RSE.plancher, 0.21);  // flux descendant : 0.17 + 0.04
});

test('calculeUParoi : erreurs propres', () => {
  assert.throws(() => calculeUParoi([], 'mur'), /thermique/);
  assert.throws(() => calculeUParoi([{ e: 0.2 }], 'mur'), /thermique/);          // ni lambda ni r
  assert.throws(() => calculeUParoi([{ e: 0.2, lambda: 0 }], 'mur'), /thermique/);
  assert.throws(() => calculeUParoi([{ e: 0.2, lambda: 1 }], 'toit'), /thermique/); // type inconnu
  // r ET e/lambda dans la même couche : ambigu → échec fort (erreur de saisie)
  assert.throws(() => calculeUParoi([{ r: 0.18, e: 0.1, lambda: 0.04 }], 'mur'), /ambiguë/);
  assert.throws(() => calculeUParoi([{ e: 0.1, lambda: 0.04, r: -1 }], 'mur'), /ambiguë/);
  assert.throws(() => calculeUParoi([null], 'mur'), /thermique/);
});

test('transmissionPiece : séjour cas de référence (ΔUtb isolé en poste pontsThermiques)', () => {
  // θint 20, θe −5 → ΔT 25.
  // Mur ext :      10 m² × U 0.5 × b 1 × 25 = 125 W ; ΔUtb 0.1 → 10 × 0.1 × 1 × 25 = 25 W
  // Fenêtre :       2 m² × U 1.3 × b 1 × 25 =  65 W ; ΔUtb 0.1 →  2 × 0.1 × 1 × 25 =  5 W
  // Mur garage :    8 m² × U 0.5 × b 0.5 × 25 = 50 W ; ΔUtb 0.1 → 8 × 0.1 × 0.5 × 25 = 10 W
  // Mitoyen même θ (b=0) : 12 m² × 2.0 × 0 = 0 W
  // parPoste: murs 175, menuiseries 65, pontsThermiques 40 — total 280
  const r = transmissionPiece({
    thetaInt: 20, thetaExt: -5,
    parois: [
      { surface: 10, u: 0.5, b: 1, deltaUtb: 0.1, poste: 'murs' },
      { surface: 2, u: 1.3, b: 1, deltaUtb: 0.1, poste: 'menuiseries' },
      { surface: 8, u: 0.5, b: 0.5, deltaUtb: 0.1, poste: 'murs' },
      { surface: 12, u: 2.0, b: 0, deltaUtb: 0, poste: 'murs' },
    ],
  });
  assert.equal(r.total, 280);
  assert.equal(r.parPoste.murs, 175);
  assert.equal(r.parPoste.menuiseries, 65);
  assert.equal(r.parPoste.pontsThermiques, 40);
});

test('transmissionPiece : ΔT interne (thetaAdjacente) — gain compté négatif, b ignoré', () => {
  // 5 m² × 2.0 × (20−24) = −40 W
  const r = transmissionPiece({
    thetaInt: 20, thetaExt: -5,
    parois: [{ surface: 5, u: 2.0, thetaAdjacente: 24, deltaUtb: 0, poste: 'murs' }],
  });
  assert.equal(r.total, -40);
  assert.equal(r.parPoste.pontsThermiques ?? 0, 0); // pas de clé pontsThermiques si ΔUtb nul partout
});

test('transmissionPiece : erreurs propres', () => {
  const base = { thetaInt: 20, thetaExt: -5 };
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 0, u: 1, b: 1, deltaUtb: 0, poste: 'murs' }] }), /thermique/);
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: -1, b: 1, deltaUtb: 0, poste: 'murs' }] }), /thermique/);
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: 1, deltaUtb: 0, poste: 'murs' }] }), /thermique/); // ni b ni thetaAdjacente
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: 1, b: 1, poste: 'murs' }] }), /thermique/);        // deltaUtb absent
  assert.throws(() => transmissionPiece({ thetaInt: NaN, thetaExt: -5, parois: [] }), /thermique/);
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: 1, b: 1, deltaUtb: 0, poste: 'toiture' }] }), /thermique/); // poste hors POSTES
  // b hors [0,1] rejeté ; bornes 0 et 1 acceptées
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: 1, b: -0.5, deltaUtb: 0, poste: 'murs' }] }), /thermique/);
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: 1, b: 1.4, deltaUtb: 0, poste: 'murs' }] }), /thermique/);
  assert.doesNotThrow(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: 1, b: 1, deltaUtb: 0, poste: 'murs' }] }));
  assert.doesNotThrow(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: 1, b: 0, deltaUtb: 0, poste: 'murs' }] }));
  assert.throws(() => transmissionPiece({ thetaInt: 20, thetaExt: -5, parois: [null] }), /thermique/);
});

test('POSTES : liste canonique des postes du rapport', () => {
  assert.deepEqual(POSTES, ['murs', 'menuiseries', 'plancherBas', 'plafondToiture', 'pontsThermiques', 'ventilation']);
});

test('debitsParPiece : VMC — débit total réparti sur les pièces sèches au prorata du volume', () => {
  // T3 → débit 75 m³/h (table plan 1), hygro facteurDebit 0.75 → 56.25 m³/h
  // Pièces sèches : séjour 60 m³, chambre 30 m³ → séjour 37.5, chambre 18.75. Humides : 0.
  const pieces = [
    { id: 'sejour', volume: 60, humide: false },
    { id: 'ch1', volume: 30, humide: false },
    { id: 'sdb', volume: 12, humide: true },
  ];
  const d = debitsParPiece({ systeme: { id: 'vmc-sf-hygro', mode: 'debits', facteurDebit: 0.75, rendement: 0 },
    debitTotal: 75, pieces });
  assert.equal(d.sejour, 37.5);
  assert.equal(d.ch1, 18.75);
  assert.equal(d.sdb, 0);
});

test('debitsParPiece : naturelle — taux × volume par pièce', () => {
  const pieces = [
    { id: 'sejour', volume: 60, humide: false },
    { id: 'sdb', volume: 12, humide: true },
  ];
  const d = debitsParPiece({ systeme: { id: 'naturelle', mode: 'taux', tauxParPiece: { defaut: 0.5, humide: 1.0 } },
    debitTotal: null, pieces });
  assert.equal(d.sejour, 30);  // 0.5 × 60
  assert.equal(d.sdb, 12);     // 1.0 × 12
});

test('debitsParPiece : erreurs propres', () => {
  const pieces = [{ id: 'a', volume: 10, humide: false }];
  assert.throws(() => debitsParPiece({ systeme: { mode: 'debits' }, debitTotal: null, pieces }), /thermique/);
  assert.throws(() => debitsParPiece({ systeme: { mode: 'debits' }, debitTotal: 75,
    pieces: [{ id: 'sdb', volume: 12, humide: true }] }), /thermique/); // aucune pièce sèche
  assert.throws(() => debitsParPiece({ systeme: { mode: 'autre' }, debitTotal: 75, pieces }), /thermique/);
  assert.throws(() => debitsParPiece({ systeme: undefined, debitTotal: 75, pieces }), /thermique/);
  assert.throws(() => debitsParPiece({ systeme: { mode: 'debits' }, debitTotal: 75, pieces: undefined }), /thermique/);
  // mode taux : defaut manquant → échec fort ; humide manquant → échec fort dès qu'une pièce humide est présente
  assert.throws(() => debitsParPiece({ systeme: { mode: 'taux', tauxParPiece: {} }, debitTotal: null, pieces }), /thermique/);
  assert.throws(() => debitsParPiece({ systeme: { mode: 'taux', tauxParPiece: { defaut: 0.5 } }, debitTotal: null,
    pieces: [{ id: 'sdb', volume: 12, humide: true }] }), /thermique/); // tauxParPiece.humide absent
});

test('ventilationPiece : ΦV = 0.34 × V̇ × ΔT × (1 − rendement DF)', () => {
  // 37.5 m³/h × 0.34 × 25 = 318.75 W ; avec DF rendement 0.7 → 95.625 W
  assert.equal(ventilationPiece({ debit: 37.5, thetaInt: 20, thetaExt: -5, rendement: 0 }), 318.75);
  assert.equal(ventilationPiece({ debit: 37.5, thetaInt: 20, thetaExt: -5, rendement: 0.7 }), 95.625);
  assert.equal(ventilationPiece({ debit: 0, thetaInt: 20, thetaExt: -5, rendement: 0 }), 0);
  assert.throws(() => ventilationPiece({ debit: -1, thetaInt: 20, thetaExt: -5 }), /thermique/);
  assert.throws(() => ventilationPiece({ debit: 10, thetaInt: 20, thetaExt: -5, rendement: 1.2 }), /thermique/); // rendement hors [0,1)
});

test('relancePiece : fRH × surface (0 si désactivée)', () => {
  assert.equal(relancePiece({ surface: 20, fRH: 11 }), 220);
  assert.equal(relancePiece({ surface: 20, fRH: 0 }), 0);
  assert.throws(() => relancePiece({ surface: 0, fRH: 11 }), /thermique/);
  assert.throws(() => relancePiece({ surface: 20, fRH: -1 }), /thermique/);
});

// ————————————————————————————————————————————————————————————————————————————
// calculeBatiment — cas de référence 2 pièces, chaque valeur dérivée à la main.
// ————————————————————————————————————————————————————————————————————————————

/** Bâtiment de référence (fabrique : chaque test reçoit un objet neuf, non muté par les autres). */
function batimentReference() {
  return {
    thetaExt: -5,
    systemeVentilation: { id: 'vmc-sf-auto', mode: 'debits', facteurDebit: 1, rendement: 0 },
    debitTotal: 90,
    fRH: 11,
    plageVraisemblance: { min: 40, max: 160 },
    pieces: [
      {
        id: 'sejour', nom: 'Séjour', surface: 20, volume: 50, thetaInt: 20, humide: false,
        parois: [
          { surface: 10, u: 0.5, b: 1, deltaUtb: 0.1, poste: 'murs' },      // mur extérieur
          { surface: 2, u: 1.3, b: 1, deltaUtb: 0, poste: 'menuiseries' },  // fenêtre
          { surface: 8, u: 0.5, b: 0.5, deltaUtb: 0.1, poste: 'murs' },     // mur sur garage (LNC, b 0.5)
        ],
      },
      {
        id: 'sdb', nom: 'Salle de bain', surface: 5, volume: 12.5, thetaInt: 24, humide: true,
        parois: [
          { surface: 6, u: 0.5, b: 1, deltaUtb: 0, poste: 'murs' },         // mur extérieur
        ],
      },
    ],
  };
}

test('calculeBatiment : bilan 2 pièces — cas de référence intégralement calculé à la main', () => {
  // ——— Séjour (20 m², 50 m³, θint 20, sec) — ΔText = 20 − (−5) = 25 K ———
  // Mur ext    : 10 × 0.5 × 1   × 25 = 125 W ; ΔUtb : 10 × 0.1 × 1   × 25 = 25 W
  // Fenêtre    :  2 × 1.3 × 1   × 25 =  65 W ; ΔUtb 0
  // Mur garage :  8 × 0.5 × 0.5 × 25 =  50 W ; ΔUtb :  8 × 0.1 × 0.5 × 25 = 10 W
  // Transmission séjour = 125+25+65+50+10 = 275 W (murs 125+50=175, menuiseries 65, pontsThermiques 25+10=35)
  // Ventilation : sdb humide → 0 ; volume sec = 50 m³ (séjour seul) → séjour reçoit 90 × 1 = 90 m³/h
  //   ΦV = 0.34 × 90 × 25 × (1−0) = 765 W
  // Relance : 20 × 11 = 220 W
  // Total séjour = 275 + 765 + 220 = 1260 W
  //
  // ——— SdB (5 m², 12.5 m³, θint 24, humide) — ΔText = 24 − (−5) = 29 K ———
  // Mur ext : 6 × 0.5 × 1 × 29 = 87 W ; ΔUtb 0
  // Transmission sdb = 87 W (murs 87) ; ventilation 0 (pièce humide = extraction) ; relance 5 × 11 = 55 W
  // Total sdb = 87 + 0 + 55 = 142 W
  //
  // ——— Bâtiment ———
  // total = 1260 + 142 = 1402 W
  // parPoste : murs 175+87 = 262 ; menuiseries 65 ; pontsThermiques 35 ; ventilation 765+0 = 765 ;
  //            relance 220+55 = 275. Contrôle : 262+65+35+765+275 = 1402 ✓
  // θint_moyenne = (20×20 + 24×5)/25 = (400+120)/25 = 520/25 = 20.8 °C
  // gv (relance exclue — régime établi) = (1402 − 275)/(20.8 − (−5)) = 1127/25.8 ≈ 43.68217 W/K
  // ratioWm2 = 1402/25 = 56.08 W/m² ∈ [40, 160] → alerteVraisemblance false
  // fourchette : min = round(1402 × 0.95) = round(1331.9) = 1332 ; max = round(1402 × 1.10) = round(1542.2) = 1542
  const r = calculeBatiment(batimentReference());

  // Pièces
  assert.equal(r.pieces.length, 2);
  const [sejour, sdb] = r.pieces;
  assert.equal(sejour.id, 'sejour');
  assert.equal(sejour.nom, 'Séjour');
  assert.equal(sejour.surface, 20);
  assert.equal(sejour.transmission, 275);
  assert.equal(sejour.ventilation, 765);
  assert.equal(sejour.relance, 220);
  assert.equal(sejour.total, 1260);
  assert.deepEqual(sejour.parPoste, { murs: 175, menuiseries: 65, pontsThermiques: 35, ventilation: 765, relance: 220 });
  assert.equal(sdb.id, 'sdb');
  assert.equal(sdb.transmission, 87);
  assert.equal(sdb.ventilation, 0);
  assert.equal(sdb.relance, 55);
  assert.equal(sdb.total, 142);
  assert.deepEqual(sdb.parPoste, { murs: 87, ventilation: 0, relance: 55 });

  // Agrégats bâtiment
  assert.equal(r.total, 1402);
  assert.deepEqual(r.parPoste, { murs: 262, menuiseries: 65, pontsThermiques: 35, ventilation: 765, relance: 275 });
  // Invariant : total === Σ parPoste (relance incluse) === Σ pieces[].total
  const sommePostes = Object.values(r.parPoste).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sommePostes - r.total) < 1e-9, `Σ parPoste=${sommePostes} ≠ total=${r.total}`);
  const sommePieces = r.pieces.reduce((s, p) => s + p.total, 0);
  assert.ok(Math.abs(sommePieces - r.total) < 1e-9, `Σ pièces=${sommePieces} ≠ total=${r.total}`);

  // GV : mêmes opérations flottantes que le moteur → égalité exacte. 1127/25.8 ≈ 43.68217054263566
  assert.equal(r.gv, 1127 / (520 / 25 - (-5)));
  assert.ok(Math.abs(r.gv - 43.6821705) < 1e-6, `gv=${r.gv}`);
  assert.equal(r.ratioWm2, 56.08); // 1402/25 — exact en IEEE 754 (division correctement arrondie)
  assert.deepEqual(r.fourchette, { min: 1332, max: 1542 });
  assert.equal(r.alerteVraisemblance, false);
});

test('calculeBatiment : alerteVraisemblance — ratio hors plage → true ; plage absente → false', () => {
  // ratioWm2 = 56.08 (cf. cas de référence) ; plage [200, 300] → 56.08 < 200 → alerte true (non bloquant)
  const horsPlage = calculeBatiment({ ...batimentReference(), plageVraisemblance: { min: 200, max: 300 } });
  assert.equal(horsPlage.alerteVraisemblance, true);
  assert.equal(horsPlage.total, 1402); // le reste du bilan est inchangé
  // plageVraisemblance absente → défaut { min: 0, max: Infinity } → jamais d'alerte
  const sansPlage = calculeBatiment({ ...batimentReference(), plageVraisemblance: undefined });
  assert.equal(sansPlage.alerteVraisemblance, false);
});

test('calculeBatiment : erreurs propres', () => {
  assert.throws(() => calculeBatiment({ ...batimentReference(), pieces: [] }), /thermique/);
  assert.throws(() => calculeBatiment({ ...batimentReference(), thetaExt: NaN }), /thermique/);
  // θint_moyenne (20.8) ≤ θext (25) → GV indéfini → échec fort
  assert.throws(() => calculeBatiment({ ...batimentReference(), thetaExt: 25 }), /thermique/);
  // pièce invalide : surface, volume, thetaInt
  const avecPiece = (patch) => {
    const b = batimentReference();
    Object.assign(b.pieces[0], patch);
    return b;
  };
  assert.throws(() => calculeBatiment(avecPiece({ surface: 0 })), /thermique/);
  assert.throws(() => calculeBatiment(avecPiece({ volume: -1 })), /thermique/);
  assert.throws(() => calculeBatiment(avecPiece({ thetaInt: NaN })), /thermique/);
});
