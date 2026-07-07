// scripts/etude-model.test.mjs
// Tests de buildEtudeModel (src/apps/solaire/lib/etudeModel.js) APRÈS bascule
// coefficient de simultanéité → moteur horaire d'autoconsommation.
// Run : node --test scripts/etude-model.test.mjs
// Le constat d'autoconso = Σ min(prod_h, conso_h) sur 8760 h (plus de coeff).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEtudeModel } from '../src/apps/solaire/lib/etudeModel.js';
import { buildPvConfig } from '../src/apps/solaire/lib/pvConfig.js';
import { monthlyPayment } from '../src/apps/solaire/lib/pvEngine.js';

const config = buildPvConfig();
const FLAT = new Array(8760).fill(1);
const eM = new Array(12).fill(110);         // 1320 kWh/an/kWc
const monthly = new Array(12).fill(300);     // 3600 kWh/an

const baseArgs = {
  roof: { surfaceM2: 60, tiltPercent: 18, orientation: 'S' },
  conso: { monthly, priceKwh: 0.20 },
  ev: { enabled: false },
  financing: { rate: 0.045, years: 12, deposit: 0, manualCost: null },
  selectedKwc: 3,
  pvgis: { e_m: eM },
  config,
};

test('buildEtudeModel — formes plates : horaire ≡ min mensuel (coeff = 1 implicite)', () => {
  const m = buildEtudeModel({ ...baseArgs, prodShape: FLAT, baseShape: FLAT });
  assert.ok(m, 'modèle non nul');
  assert.equal(m.activeKwc, 3);
  // À 3 kWc : prod 330/mois, conso 300/mois → autoconso = min = 300/mois = 3600/an
  assert.ok(Math.abs(m.active.totals.autoconso - 3600) < 1, `autoconso=${m.active.totals.autoconso}`);
  assert.ok(Math.abs(m.active.totals.prod - 3960) < 1, `prod=${m.active.totals.prod}`);
  assert.ok(Math.abs(m.active.totals.tauxAutoconso - 3600 / 3960) < 1e-6);
  assert.ok(Math.abs(m.active.totals.tauxAutoproduction - 1) < 1e-6);
  // active garde la forme mensuelle (graphe + financier)
  assert.equal(m.active.prod.length, 12);
  assert.equal(m.active.autoconso.length, 12);
  assert.equal(m.active.surplus.length, 12);
  assert.ok(Math.abs(m.active.prod[0] - 330) < 1e-6);
  // économie an 1 = 3600 kWh × 0,20 € (année 1, sans dégradation/inflation)
  assert.ok(Math.abs(m.economyYear1 - 720) < 1, `economyYear1=${m.economyYear1}`);
});

test('buildEtudeModel — décalage temporel : prod midi vs conso nuit → autoconso ≈ 0', () => {
  const midday = new Array(8760).fill(0);
  const night = new Array(8760).fill(0);
  for (let h = 0; h < 8760; h++) {
    const hod = h % 24;
    if (hod >= 10 && hod <= 15) midday[h] = 1;
    if (hod <= 6 || hod >= 19) night[h] = 1;
  }
  const m = buildEtudeModel({ ...baseArgs, prodShape: midday, baseShape: night });
  // prod (midi) et conso (nuit) ne se recouvrent jamais → autoconso nulle
  assert.ok(m.active.totals.autoconso < 1, `autoconso=${m.active.totals.autoconso} (attendu ~0)`);
  assert.ok(m.economyYear1 < 1, `economyYear1=${m.economyYear1} (attendu ~0)`);
  // le mensuel naïf aurait donné min(330,300)=300/mois = 3600/an : la bascule le corrige
});

test('buildEtudeModel — la mécanique du coefficient de simultanéité a disparu', () => {
  const m = buildEtudeModel({ ...baseArgs, prodShape: FLAT, baseShape: FLAT });
  assert.equal(m.coeff, undefined);
  assert.equal(m.coeffParts, undefined);
  assert.equal(m.overlapRatio, undefined);
  assert.equal(m.maxAchievableAutoconso, undefined);
  assert.equal(m.pilotageDeltaPoints, undefined);
  assert.equal(m.pilotageDeltaEuros, undefined);
});

test('buildEtudeModel — chaque scénario porte un autoconso horaire cohérent', () => {
  const m = buildEtudeModel({ ...baseArgs, prodShape: FLAT, baseShape: FLAT });
  assert.ok(m.scenarios.length > 0);
  for (const s of m.scenarios) {
    assert.ok(s.tauxAutoconso >= 0 && s.tauxAutoconso <= 1);
    // formes plates : autoconso = min(prod, conso) mensuel → économie an1 = Σmin × prix
    let expectedAutoconso = 0;
    for (let mo = 0; mo < 12; mo++) expectedAutoconso += Math.min(eM[mo] * s.kwc, monthly[mo]);
    assert.ok(Math.abs(s.economyYear1 - expectedAutoconso * 0.20) < 1, `scénario ${s.kwc} kWc: eco=${s.economyYear1}`);
  }
});

test('buildEtudeModel — pas de PVGIS → null', () => {
  assert.equal(buildEtudeModel({ ...baseArgs, pvgis: null, prodShape: FLAT, baseShape: FLAT }), null);
});

// --- Tests migrés depuis pv-engine.test.mjs (structure financière, indépendante
//     de la méthode d'autoconso : dérivés de active.totals.autoconso / prod) ---
const eMReal = [45.8, 60, 92, 110, 128, 138, 150, 142, 112, 82, 52, 40]; // e_y ≈ 1152
const realArgs = {
  roof: { tiltPercent: 18, orientation: 'S', surfaceM2: 45 },
  conso: { monthly: Array(12).fill(1000), priceKwh: 0.25 },
  ev: { enabled: false },
  selectedKwc: null,
  pvgis: { e_m: eMReal, e_y: 1152 },
  prodShape: FLAT,
  baseShape: FLAT,
};

test('buildEtudeModel — pipeline complet cohérent (optimiseur + plafond + grille)', () => {
  const cfg = buildPvConfig({ pv: { cost_grid: [{ kwc: 1, prix_ttc: 4000 }, { kwc: 9, prix_ttc: 20000 }] } });
  const m = buildEtudeModel({ ...realArgs, financing: { rate: 0.045, years: 12, deposit: 0, manualCost: null }, config: cfg });
  assert.ok(m);
  assert.equal(m.maxKwc, 9);              // toiture 45 m² → 9,5 kWc, plafonné à 9
  assert.equal(m.cappedByOffer, true);
  assert.equal(m.recommendedKwc, 9);      // 12 000 kWh/an flat → recouvrement 0,90 ≥ 0,85
  assert.equal(m.activeKwc, m.recommendedKwc);
  assert.equal(m.capital, 20000);         // ligne exacte de la grille à 9 kWc
  assert.ok(m.mensualite > 0);
  assert.equal(m.table.rows.length, cfg.horizon_years);
});

test('buildEtudeModel — point mort & sensibilité (dérivés de la production)', () => {
  const cfg = buildPvConfig({ pv: { cost_grid: [{ kwc: 9, prix_ttc: 20000 }] } });
  const m = buildEtudeModel({ ...realArgs, financing: { rate: 0.045, years: 12, deposit: 0, manualCost: null }, config: cfg });
  const prod = m.active.totals.prod;
  // Sensibilité : +1 pt d'autoconso = production × 1 % × prix
  assert.ok(Math.abs(m.sensitivityPerAutoconsoPoint - prod * 0.01 * 0.25) < 1e-9);
  // Point mort : annuité an 1 / (production × prix)
  const annuity = monthlyPayment({ capital: 20000, annualRate: 0.045, years: 12 }) * 12;
  assert.ok(Math.abs(m.breakEvenAutoconsoRate - annuity / (prod * 0.25)) < 1e-9);
});

test('buildEtudeModel — lecture investisseur (ROCE / ROE / full credit)', () => {
  const cfg = buildPvConfig({ pv: { cost_grid: [{ kwc: 9, prix_ttc: 20000 }] } });
  const m0 = buildEtudeModel({ ...realArgs, financing: { rate: 0.045, years: 12, deposit: 0, manualCost: null }, config: cfg });
  assert.ok(Math.abs(m0.assetYieldYear1 - m0.economyYear1 / 20000) < 1e-9);
  assert.ok(m0.assetYieldAvg > m0.assetYieldYear1); // inflation > dégradation → moyenne > an 1
  assert.equal(m0.equityYieldYear1, null);
  assert.equal(m0.fullCredit, true);
  assert.ok(Math.abs(m0.netGainYear1 + m0.table.rows[0].effortNet) < 1e-9);
  // Avec apport 5 000 € : ROE = (économie − annuité) / apport
  const m5 = buildEtudeModel({ ...realArgs, financing: { rate: 0.045, years: 12, deposit: 5000, manualCost: null }, config: cfg });
  const annuity5 = monthlyPayment({ capital: 15000, annualRate: 0.045, years: 12 }) * 12;
  assert.ok(Math.abs(m5.equityYieldYear1 - (m5.economyYear1 - annuity5) / 5000) < 1e-9);
  assert.equal(m5.fullCredit, false);
});
