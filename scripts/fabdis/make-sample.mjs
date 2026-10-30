/**
 * scripts/fabdis/make-sample.mjs — Jeu d'essai FAB-DIS
 * ============================================================================
 * Genere un classeur dont les onglets suivent le nommage de la NORME FAB-DIS
 * 3.0 (B01_COMMERCE, B03_MEDIA, C02_CORRESPONDANCE, C04_ETIM,
 * C06_SUBSTITUTION) et non celui du cahier des charges, qui designe le media
 * par « B04_MEDIA » et l'ETIM par « B05_ETIM » — deux intitules que la norme
 * n'emploie pas, B04 y etant l'onglet REGLEMENTAIRE.
 * Couvre les quatre familles retenues : PAC air/eau, poele a granules,
 * fumisterie, climatisation.
 *
 * ⚠️ CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PROUVE PAS
 * ------------------------------------------------------
 * Il permet d'exercer toute la chaine (lecture → parsing → assemblage →
 * insertion) et de garnir la base avant reception des vrais tarifs. Il ne
 * prouve EN RIEN la compatibilite avec un fichier FAB-DIS reel : les
 * intitules de colonnes utilises ici sont plausibles, pas certifies. Le
 * calage sur la norme se fera au premier fichier fabricant recu — c'est
 * precisement pourquoi le parser mappe par alias.
 *
 * Les references produits sont fictives. Les GTIN sont calcules avec une cle
 * de controle GS1 valide, pour que la validation du parser soit reellement
 * exercee, mais ils n'identifient aucun article du commerce.
 *
 * Usage : node scripts/fabdis/make-sample.mjs [chemin/sortie.xlsx]
 * ============================================================================
 */

import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

import ExcelJS from 'exceljs';

/**
 * Complete 12 chiffres par leur cle de controle GS1 pour obtenir un GTIN-13
 * structurellement valide.
 * @param {string} base 12 chiffres
 * @returns {string} GTIN-13
 */
function gtin13(base) {
  if (!/^\d{12}$/.test(base)) throw new Error(`base GTIN invalide : ${base}`);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    // Depuis la droite : rang pair ×3, rang impair ×1.
    const digit = Number(base[11 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return base + String((10 - (sum % 10)) % 10);
}

// --- Catalogue fictif --------------------------------------------------------

const G = {
  pac8:        gtin13('340100000001'),
  pacVase:     gtin13('340100000002'),
  pacKitHydro: gtin13('340100000003'),
  poele8:      gtin13('340200000001'),
  poeleVentouse: gtin13('340200000002'),
  condDW150:   gtin13('340300000001'),
  condCoude45: gtin13('340300000002'),
  climaUE:     gtin13('340400000001'),
  climaUI:     gtin13('340400000002'),
  climaUEold:  gtin13('340400000003'),
};

const B01 = {
  // Une colonne volontairement hors specification (« Poids brut ») : le
  // rapport de lecture doit la signaler comme non importee.
  headers: ['Référence fabricant', 'GTIN', 'Code marque', 'Libellé court',
            'Libellé long', 'Prix public HT', 'Unité de vente', 'Poids brut (kg)'],
  rows: [
    ['ATL-ALFEA-8', G.pac8, 'ATLANTIC', 'Alfea Excellia A.I. 8',
     'Pompe a chaleur air/eau monobloc 8 kW, haute temperature', '7 890,00', 'PCE', 142],
    ['ATL-VASE-18', G.pacVase, 'ATLANTIC', 'Vase d\'expansion 18 L',
     'Vase d\'expansion sanitaire 18 litres', '89,90', 'PCE', 4.2],
    ['ATL-KITHYD-25', G.pacKitHydro, 'ATLANTIC', 'Kit hydraulique 25 mm',
     'Kit de raccordement hydraulique isole', '245,00', 'PCE', 6],

    ['INV-FONTICA-8', G.poele8, 'INVICTA', 'Fontica 8 etanche',
     'Poele a granules etanche 8 kW, classe A+', '3 631,00', 'PCE', 118],
    ['INV-VENT-80125', G.poeleVentouse, 'INVICTA', 'Kit ventouse 80/125',
     'Kit ventouse concentrique horizontal 80/125', '389,00', 'PCE', 7.5],

    ['DIN-DW150-1000', G.condDW150, 'DINAK', 'Element droit DW 150 - 1000 mm',
     'Element droit double paroi isolee, inox 316L/304, longueur 1000 mm', '186,40', 'PCE', 5.8],
    ['DIN-DW150-C45', G.condCoude45, 'DINAK', 'Coude 45 DW 150',
     'Coude 45 degres double paroi isolee, inox 316L/304', '142,10', 'PCE', 3.1],

    ['DAI-3MXM52', G.climaUE, 'DAIKIN', 'Unite exterieure multi 3MXM52',
     'Unite exterieure multi-split 5,2 kW, 3 sorties, R32', '2 480,00', 'PCE', 48],
    ['DAI-FTXM25', G.climaUI, 'DAIKIN', 'Unite interieure murale FTXM25',
     'Unite interieure murale Perfera 2,5 kW, R32', '890,00', 'PCE', 12],
    ['DAI-3MXM50-OLD', G.climaUEold, 'DAIKIN', 'Unite exterieure multi 3MXM50',
     'Modele remplace par le 3MXM52', '2 390,00', 'PCE', 47],
  ],
};

const B03_MEDIA_DATA = {
  headers: ['Référence fabricant', 'Type de média', 'URL', 'Libellé'],
  rows: [
    ['ATL-ALFEA-8', 'Fiche technique', 'https://exemple.test/fabdis/alfea8-ft.pdf', 'Fiche technique Alfea 8'],
    ['ATL-ALFEA-8', 'Notice de pose', 'https://exemple.test/fabdis/alfea8-notice.pdf', 'Notice d\'installation'],
    ['ATL-ALFEA-8', 'Visuel HD', 'https://exemple.test/fabdis/alfea8.jpg', 'Photo produit'],
    ['ATL-ALFEA-8', 'Certificat CE', 'https://exemple.test/fabdis/alfea8-ce.pdf', 'Declaration de performance'],
    ['INV-FONTICA-8', 'Fiche technique', 'https://exemple.test/fabdis/fontica8-ft.pdf', 'Fiche technique Fontica 8'],
    ['INV-FONTICA-8', 'Visuel HD', 'https://exemple.test/fabdis/fontica8.jpg', 'Photo produit'],
    ['DIN-DW150-1000', 'Fiche technique', 'https://exemple.test/fabdis/dw150-ft.pdf', 'Fiche technique DW 150'],
    ['DAI-3MXM52', 'Fiche technique', 'https://exemple.test/fabdis/3mxm52-ft.pdf', 'Fiche technique 3MXM52'],
    ['DAI-3MXM52', 'Notice de pose', 'https://exemple.test/fabdis/3mxm52-notice.pdf', 'Manuel d\'installation'],
  ],
};

// Codes ETIM plausibles. Les libelles ne sont PAS renseignes ici : ils viennent
// de l'API ETIM a l'ingestion (section 2.2). Un fichier FAB-DIS ne porte que
// les codes.
const C04_ETIM_DATA = {
  headers: ['Référence fabricant', 'Classe ETIM', 'Code caractéristique',
            'Code valeur', 'Valeur numérique', 'Code unité'],
  rows: [
    ['ATL-ALFEA-8', 'EC010912', 'EF000008', '', 8, 'EU570448'],      // puissance calorifique kW
    ['ATL-ALFEA-8', 'EC010912', 'EF000199', '', 111, 'EU570025'],    // ETAS %
    ['ATL-ALFEA-8', 'EC010912', 'EF000060', 'EV000123', '', ''],     // type de fluide
    ['INV-FONTICA-8', 'EC003104', 'EF000008', '', 8, 'EU570448'],
    ['INV-FONTICA-8', 'EC003104', 'EF002169', '', 92.5, 'EU570025'], // rendement %
    ['DIN-DW150-1000', 'EC002616', 'EF000005', '', 150, 'EU570092'], // diametre mm
    ['DIN-DW150-1000', 'EC002616', 'EF000006', '', 1000, 'EU570092'],// longueur mm
    ['DAI-3MXM52', 'EC001234', 'EF000008', '', 5.2, 'EU570448'],
    ['DAI-FTXM25', 'EC001235', 'EF000008', '', 2.5, 'EU570448'],
  ],
};

const C02 = {
  headers: ['GTIN principal', 'GTIN associé', 'Type de relation', 'Quantité'],
  rows: [
    // Couche 2 du moteur d'assemblage : accessoires imposes par le fabricant.
    [G.pac8, G.pacVase, 'Obligatoire', 1],
    [G.pac8, G.pacKitHydro, 'Obligatoire', 1],
    [G.poele8, G.poeleVentouse, 'Obligatoire', 1],
    // Le conduit n'est pas impose par le fabricant du poele : il depend du chantier.
    [G.poele8, G.condDW150, 'Optionnel', 1],
    [G.poele8, G.condCoude45, 'Optionnel', 2],
    // Compatibilite multi-split (cas cite en 2.1).
    [G.climaUE, G.climaUI, 'Compatible', 1],
  ],
};

const C06 = {
  headers: ['GTIN remplacé', 'GTIN remplaçant'],
  rows: [[G.climaUEold, G.climaUE]],
};

// --- Generation --------------------------------------------------------------

function addSheet(workbook, name, def) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(def.headers);
  sheet.getRow(1).font = { bold: true };
  def.rows.forEach((row) => sheet.addRow(row));
  sheet.columns.forEach((col) => { col.width = 26; });
  return sheet;
}

async function main() {
  const outPath = process.argv[2] || 'docs/imports/fabdis-echantillon.xlsx';
  mkdirSync(dirname(outPath), { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Majord\'home — jeu d\'essai FAB-DIS';
  workbook.created = new Date('2026-08-12T00:00:00Z');

  addSheet(workbook, 'B01_COMMERCE', B01);
  addSheet(workbook, 'B03_MEDIA', B03_MEDIA_DATA);
  addSheet(workbook, 'C04_ETIM', C04_ETIM_DATA);
  addSheet(workbook, 'C02_CORRESPONDANCE', C02);
  addSheet(workbook, 'C06_SUBSTITUTION', C06);

  await workbook.xlsx.writeFile(outPath);

  console.log(`Jeu d'essai FAB-DIS ecrit : ${outPath}`);
  console.log(`  B01_COMMERCE       ${B01.rows.length} produits (4 familles)`);
  console.log(`  B03_MEDIA          ${B03_MEDIA_DATA.rows.length} documents`);
  console.log(`  C04_ETIM           ${C04_ETIM_DATA.rows.length} caracteristiques`);
  console.log(`  C02_CORRESPONDANCE ${C02.rows.length} relations`);
  console.log(`  C06_SUBSTITUTION   ${C06.rows.length} substitution`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
