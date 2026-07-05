// Démo : chaîne complète du module Thermique (plans 1-2-3) sur un cas réel.
import { readFileSync } from 'node:fs';
import { thetaBasePour, uDefautPour } from '../../src/apps/thermique/lib/refDataResolvers.js';
import { calculeBatiment } from '../../src/apps/thermique/lib/thermalEngine.js';
import { courbeCharge, pointBivalence, consoAnnuelle, copAt } from '../../src/apps/thermique/lib/heatPumpEngine.js';

const lire = (f) => JSON.parse(readFileSync(new URL(`../../src/apps/thermique/data/${f}`, import.meta.url), 'utf8'));
const climat = lire('climat.json');
const uDefauts = lire('u-defauts.json');
const pacs = lire('pac-catalogue.json');

// — Site : Gaillac (81), altitude 134 m —
const { thetaE } = thetaBasePour(climat, '81', 134);
console.log(`\n■ Site : Gaillac (81) — θe base ${thetaE} °C, DJU 1943, heures chauffage ${climat.heuresChauffage['81']} h/an`);

// — Maison années 1960 (U par défaut « avant 1974 »), 2 pièces simplifiées pour la démo —
const uMur = uDefautPour(uDefauts, 'mur', 1965);
const uPlancher = uDefautPour(uDefauts, 'plancherBas', 1965);
const uPlafond = uDefautPour(uDefauts, 'plafond', 1965);
console.log(`■ U par défaut 1965 : murs ${uMur}, plancher ${uPlancher}, plafond ${uPlafond} W/(m²·K)`);

const batiment = {
  thetaExt: thetaE,
  systemeVentilation: { id: 'vmc-sf-auto', mode: 'debits', facteurDebit: 1, rendement: 0 },
  debitTotal: 60, fRH: 0,
  pieces: [
    { id: 'sejour', nom: 'Séjour', surface: 25, volume: 62.5, thetaInt: 20, humide: false,
      parois: [
        { surface: 22, u: uMur, b: 1, deltaUtb: 0.1, poste: 'murs' },
        { surface: 4, u: 2.8, b: 1, deltaUtb: 0.1, poste: 'menuiseries' },
        { surface: 25, u: uPlancher, b: 1, deltaUtb: 0, poste: 'plancherBas' },
        { surface: 25, u: uPlafond, b: 0.7, deltaUtb: 0, poste: 'plafondToiture' },
      ] },
    { id: 'chambre', nom: 'Chambre', surface: 12, volume: 30, thetaInt: 18, humide: false,
      parois: [
        { surface: 15, u: uMur, b: 1, deltaUtb: 0.1, poste: 'murs' },
        { surface: 1.5, u: 2.8, b: 1, deltaUtb: 0.1, poste: 'menuiseries' },
        { surface: 12, u: uPlancher, b: 1, deltaUtb: 0, poste: 'plancherBas' },
        { surface: 12, u: uPlafond, b: 0.7, deltaUtb: 0, poste: 'plafondToiture' },
      ] },
  ],
};
const bilan = calculeBatiment(batiment);
console.log(`\n■ Déperditions (maison 1965 non rénovée, 37 m² démo) :`);
for (const p of bilan.pieces) console.log(`   ${p.nom.padEnd(10)} ${Math.round(p.total)} W`);
console.log(`   TOTAL      ${Math.round(bilan.total)} W  (${bilan.ratioWm2.toFixed(0)} W/m² — fourchette ${bilan.fourchette.min}–${bilan.fourchette.max} W)`);
console.log(`   GV ${bilan.gv.toFixed(1)} W/K · postes : ${Object.entries(bilan.parPoste).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ')}`);

// — Volet PAC : une vraie machine du catalogue Keymark —
const pac = pacs.pacs.find((p) => p.modele === 'Acond Aconomis N');
const charge = courbeCharge({ phiTotal: bilan.total, thetaBase: thetaE, thetaNC: climat.thetaNonChauffage });
const biv = pointBivalence({ pac, tDepart: 45, charge, thetaBase: thetaE, thetaNC: climat.thetaNonChauffage });
console.log(`\n■ PAC ${pac.fabricant} ${pac.modele} (réelle, base Keymark ${pacs.pacs.length} modèles), départ 45 °C :`);
console.log(`   COP à +7/45 : ${copAt(pac, 7, 45).toFixed(2)} · bivalence ${biv.thetaBivalence.toFixed(1)} °C · appoint ${Math.round(biv.appointNecessaire)} W · couverture ${(biv.tauxCouverture * 100).toFixed(0)} %`);
if (biv.avertissementChargePartielle) console.log('   ⚠ P_th catalogue = points EN 14825 charge partielle (pas la capacité max)');

const conso = consoAnnuelle({ gv: bilan.gv, dju: 1943, heuresChauffage: climat.heuresChauffage['81'], pac, tDepart: 45, prixKwh: 0.1952 });
console.log(`\n■ Conso annuelle estimée : besoin ${Math.round(conso.besoinKwh)} kWh → élec ${Math.round(conso.consoElecKwh)} kWh ≈ ${Math.round(conso.coutEuros)} €/an (fourchette ${conso.fourchette.min}–${conso.fourchette.max} €)\n`);
