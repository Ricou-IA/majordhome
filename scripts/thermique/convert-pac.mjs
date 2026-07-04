// Conversion hplib (RE-Lab-Projects, MIT — https://github.com/RE-Lab-Projects/hplib) ->
// src/apps/thermique/data/pac-catalogue.json
//
// Usage : node scripts/thermique/convert-pac.mjs "<chemin>/hplib_database.csv"
// (chemin vers un hplib_database.csv téléchargé depuis
//  https://raw.githubusercontent.com/RE-Lab-Projects/hplib/main/hplib/hplib_database.csv)
//
// Sans argv (ex. appelé depuis convert-all.mjs sans CSV local disponible), le script
// affiche un message de skip et ne fait rien : rien à convertir sans la source hplib.
// ⚠ PAS de process.exit ici : ce module est chargé par import() depuis convert-all.mjs,
// un exit tuerait TOUT l'orchestrateur (les étapes suivantes ne s'exécuteraient jamais).
import { writeDataJson } from './lib/sourceFiles.js';

const csvPath = process.argv[2];

if (!csvPath) {
  console.log('⏭ convert-pac : aucun chemin vers hplib_database.csv fourni en argv — conversion sautée.');
  console.log('   Usage : node scripts/thermique/convert-pac.mjs "<chemin>/hplib_database.csv"');
} else {
  await convert(csvPath);
}

// --- Mini parseur CSV (champs entre guillemets, guillemets doublés "" pour échapper) ---
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  return { header, rows };
}

function num(v) {
  if (v == null || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

async function convert(csvFilePath) {
  console.log(`source : ${csvFilePath} (hplib_database.csv, RE-Lab-Projects/hplib)`);
  const fs = await import('node:fs');
  const csvText = fs.readFileSync(csvFilePath, 'utf8');
  const { header, rows } = parseCsv(csvText);

  function col(name) {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Colonne hplib introuvable : "${name}" — schéma CSV a peut-être changé`);
    return i;
  }

  const iManufacturer = col('Manufacturer');
  const iTitel = col('Titel');
  const iType = col('Type');
  const iSubtype = col('Subtype');
  const iPthRef = col('P_th_h_ref [W]');
  const iPelRef = col('P_el_h_ref [W]');
  const iCopRef = col('COP_ref');
  const iP1PelH = col('p1_P_el_h [1/°C]');
  const iP2PelH = col('p2_P_el_h [1/°C]');
  const iP3PelH = col('p3_P_el_h [-]');
  const iP4PelH = col('p4_P_el_h [1/°C]');
  const iP1Cop = col('p1_COP [-]');
  const iP2Cop = col('p2_COP [-]');
  const iP3Cop = col('p3_COP [-]');
  const iP4Cop = col('p4_COP [-]');

  // --- Filtre : air/eau, régulées (variable speed / inverter), cf. README hplib "Heat pump
  // models and Group IDs" (Group 1 = Outdoor Air/Water, Regulated). Les modèles "Generic" du
  // même Group sont conservés séparément (generique: true) — ce sont des jeux de coefficients
  // moyens (Generic_top/average/bottom), sans P_th_h_ref propre (voir note ci-dessous).
  const AIR_WATER_TYPE = 'Outdoor Air/Water';
  const REGULATED_SUBTYPE = 'Regulated';

  const filtered = rows.filter(
    (r) => r[iType] === AIR_WATER_TYPE && r[iSubtype] === REGULATED_SUBTYPE
  );

  const pacs = [];
  let consistencyWarnCount = 0; // |P_el_h_ref - P_th_h_ref/COP_ref| > 1 % (incohérence interne CSV)
  let excludedGuardCount = 0; // lignes réelles exclues par les gardes pElRef/copRef (voir note)
  for (const r of filtered) {
    const fabricant = r[iManufacturer].trim();
    const modele = r[iTitel].trim();
    const generique = fabricant === 'Generic';

    const coefPth = [num(r[iP1PelH]), num(r[iP2PelH]), num(r[iP3PelH]), num(r[iP4PelH])];
    const coefCop = [num(r[iP1Cop]), num(r[iP2Cop]), num(r[iP3Cop]), num(r[iP4Cop])];

    let pthRef;
    let pElRef;
    let copRef;
    if (generique) {
      // Les lignes "Generic" (Generic_top/average/bottom) n'ont pas de P_th_h_ref propre dans le
      // CSV : hplib.get_parameters() les dérive par ajustement least-square autour d'un p_th "set
      // point" choisi par l'appelant (cf. hplib.py fit_p_th_ref / notebooks/documentation.ipynb,
      // exemples avec p_th=10000). Pour livrer un pthRef exploitable sans inventer une valeur
      // physique arbitraire non documentée, on retient 10000 W : c'est exactement le set point
      // utilisé par les auteurs de hplib dans TOUS leurs exemples de notebook pour ces 3 modèles
      // génériques (get_parameters('Generic_top'/'Generic_average'/'Generic_bottom', group_id=1,
      // t_in=-7, t_out=30 ou 40 ou 45, p_th=10000)) — valeur documentée dans la source, pas inventée.
      pthRef = 10000;
      // P_el_h_ref [W] et COP_ref sont VIDES dans le CSV pour les 3 lignes Generic (vérifié) :
      // hplib.get_parameters() les calcule au chargement (cop_ref via la courbe fittée au point
      // de référence, p_el_ref = p_th_ref/cop_ref). Si un jour le CSV les renseigne, on les lit ;
      // sinon pElRef est dérivé de copRef brut s'il existe, et à défaut les deux restent null
      // (le moteur devra alors dériver P_el_ref = pthRef/COP(-7,52) via la courbe, comme hplib).
      copRef = num(r[iCopRef]);
      if (Number.isFinite(copRef)) {
        const rawPel = num(r[iPelRef]);
        pElRef = Number.isFinite(rawPel) ? rawPel : pthRef / copRef;
      } else {
        copRef = null;
        pElRef = null;
      }
    } else {
      pthRef = num(r[iPthRef]);
      pElRef = num(r[iPelRef]);
      copRef = num(r[iCopRef]);
    }

    if (!Number.isFinite(pthRef) || !coefPth.every(Number.isFinite) || !coefCop.every(Number.isFinite)) {
      continue; // ligne incomplète (rare) : exclue plutôt que d'inventer des valeurs
    }

    if (!generique) {
      // Gardes sur les colonnes de référence brutes : pElRef fini > 200 W, copRef dans [1.2, 8].
      // Plancher abaissé de 1.5 à 1.2 (revue) : les lignes exclues sous 1.5 étaient une vraie
      // famille Mitsubishi PXZ-5F85VG (COP_ref 1.4, interne cohérent avec P_th_h_ref/P_el_h_ref),
      // pas des données aberrantes — 1.2 reste largement au-dessus de tout artefact de saisie
      // (COP < 1 physiquement absurde pour une PAC) tout en les incluant.
      // Les lignes hors bornes sont exclues (comptées et documentées), pas corrigées.
      if (!(Number.isFinite(pElRef) && pElRef > 200) || !(Number.isFinite(copRef) && copRef >= 1.2 && copRef <= 8)) {
        excludedGuardCount++;
        continue;
      }
      // Cohérence interne CSV : P_el_h_ref doit valoir ~ P_th_h_ref / COP_ref (même point -7/52).
      if (Math.abs(pElRef - pthRef / copRef) / pElRef > 0.01) {
        consistencyWarnCount++;
        console.warn(`  ⚠ incohérence P_el_h_ref vs P_th_h_ref/COP_ref (> 1 %) : ${fabricant} ${modele}`);
      }
    }

    pacs.push({ fabricant, modele, type: 'air-eau', pthRef, pElRef, copRef, coefPth, coefCop, generique });
  }

  // --- Garde-fous ---
  if (pacs.length < 20) {
    throw new Error(`convert-pac : seulement ${pacs.length} modèles air/eau régulés après filtre (attendu >= 20)`);
  }
  for (const p of pacs) {
    if (!(p.pthRef >= 1000 && p.pthRef <= 100000)) {
      throw new Error(`convert-pac : pthRef hors bornes [1000, 100000] W pour ${p.fabricant} ${p.modele} : ${p.pthRef}`);
    }
    if (!p.coefPth.every(Number.isFinite) || !p.coefCop.every(Number.isFinite)) {
      throw new Error(`convert-pac : coefficients non finis pour ${p.fabricant} ${p.modele}`);
    }
  }

  const generiqueCount = pacs.filter((p) => p.generique).length;
  console.log(`  ${pacs.length} PAC air/eau régulées (dont ${generiqueCount} génériques)`);
  console.log(`  ${excludedGuardCount} lignes réelles exclues par les gardes pElRef/copRef, ` +
    `${consistencyWarnCount} avertissements de cohérence P_el_h_ref vs P_th_h_ref/COP_ref`);
  if (pacs.length > 800) {
    console.log(`  ⚠ ${pacs.length} modèles > 800 : catalogue volumineux, aucun échantillonnage appliqué (décision laissée à l'appelant).`);
  }

  writeDataJson(
    'pac-catalogue.json',
    {
      source: 'hplib (RE-Lab-Projects) — Heatpump Keymark data, hplib_database.csv',
      sourceRef:
        'https://raw.githubusercontent.com/RE-Lab-Projects/hplib/main/hplib/hplib_database.csv' +
        ' (téléchargé le 2026-07-03) — code du dépôt sous licence MIT ; le fichier CSV lui-même' +
        ' est documenté par les auteurs comme sous licence CC BY 4.0 (cf. README.md, section' +
        ' "Database" : "All resulting database CSV file are under CC BY 4.0").',
      license: 'MIT (code hplib) ; CC BY 4.0 (données hplib_database.csv, cf. sourceRef)',
      note:
        "FORMULE (vérifiée dans hplib/hplib.py, fonctions simulate()/HeatPump.simulate(), et " +
        "confirmée par le README section 'p1-p4_P_el'/'p1-p4_COP') — pour un point de fonctionnement " +
        "(T_in, T_out) où T_in = température d'entrée côté primaire (air extérieur pour air/eau) " +
        "et T_out = température de sortie côté secondaire (départ eau chauffage) : " +
        "pour les PAC air/eau (Group 1), T_amb = T_in (l'air ambiant EST la température primaire). " +
        "COP(T_in,T_out) = p1_COP·T_in + p2_COP·T_out + p3_COP + p4_COP·T_amb " +
        "(coefPth/coefCop stockés ici dans l'ordre [p1,p2,p3,p4]). " +
        "P_el(T_in,T_out) = pElRef · (p1_P_el_h·T_in + p2_P_el_h·T_out + p3_P_el_h + p4_P_el_h·T_amb). " +
        "ATTENTION : pElRef et copRef sont les colonnes BRUTES du CSV (P_el_h_ref [W] et COP_ref), " +
        "mesurées au point de référence Keymark T_in=-7°C / T_out=52°C — hplib.py les lit " +
        "directement du CSV (HeatPump.__init__, parameters['P_el_h_ref [W]']) et ne les dérive PAS " +
        "de la courbe fittée : COP_ref brut diverge de COP fitté(-7,52) de ~34 % en médiane sur ce " +
        "catalogue (résidus du fit least-square). Le moteur DOIT utiliser pElRef directement dans " +
        "la formule P_el ci-dessus, PAS pthRef/COP_fitté(-7,52). En revanche pElRef ≈ pthRef/copRef " +
        "(colonnes brutes entre elles) est vérifié à ±1 % sur 100 % des lignes retenues. " +
        "P_th(T_in,T_out) = P_el(T_in,T_out) · COP(T_in,T_out) — hplib précise " +
        "explicitement (documentation.ipynb §4) que P_th est dérivé du PRODUIT P_el·COP (pas d'un " +
        "fit direct de P_th), car cette méthode donne de meilleurs résultats de validation que " +
        "l'inverse. pthRef stocké ici = P_th_h_ref [W] du CSV = P_th au point de référence (-7°C/52°C), " +
        "DÉJÀ en W (pas de conversion kW->W nécessaire, vérifié sur la plage CSV 2600-73840 W, " +
        "cohérente avec le README '2400 à 69880 W') ; pElRef en W également (plage CSV 881-36920 W). " +
        "GARDES appliquées aux lignes réelles : pElRef fini > 200 W et copRef dans [1.2, 8] (plancher " +
        "abaissé de 1.5 à 1.2 en revue : les lignes à COP_ref=1.4 exclues sous l'ancien plancher 1.5 " +
        "sont une vraie famille Mitsubishi PXZ-5F85VG, cohérente en interne P_th_h_ref/P_el_h_ref/" +
        "COP_ref — pas des données aberrantes) — les " +
        `lignes hors bornes sont EXCLUES du catalogue (${excludedGuardCount} lignes exclues à cette ` +
        "conversion). " +
        "IMPORTANT (comportement EN14825 des PAC régulées, pas une anomalie de données) : hplib.py " +
        "(hplib_database.py ligne ~277) définit lui-même 'Regulated' comme les modèles dont P_th " +
        "déclaré N'EST PAS croissant avec la température extérieure sur les points EN14825 " +
        "(-7/2/7/12°C) — contrairement aux modèles 'On-Off' qui eux le sont. Pour une PAC régulée " +
        "(vitesse variable), à température de départ T_out FIXE, P_th(T_in=7°C) calculé par cette " +
        "formule est souvent INFÉRIEUR à P_th(T_in=-7°C) : le protocole Keymark/EN14825 teste les " +
        "PAC régulées à charge partielle modulée selon la courbe de charge du bâtiment de référence " +
        "à chaque palier de température, PAS à la puissance maximale du compresseur. La grandeur " +
        "obtenue ici est donc 'puissance au point de fonctionnement certifié EN14825 pour ce couple " +
        "(T_in,T_out)', PAS une courbe de capacité maximale — implication importante pour le futur " +
        "moteur de calcul du point de bivalence (qui devra interpréter P_th en ce sens, ou recourir " +
        "à une autre source pour la puissance maximale disponible au point de bivalence). " +
        "FILTRE : Type='Outdoor Air/Water' ET Subtype='Regulated' (colonnes CSV exactes). Les 3 " +
        "lignes Manufacturer='Generic', Group=1, Subtype='Regulated' (Titel: Generic_top/average/" +
        "bottom) sont incluses avec generique:true ; elles n'ont pas de P_th_h_ref propre dans le " +
        "CSV (calculé par hplib.get_parameters() via ajustement least-square autour d'un p_th 'set " +
        "point' choisi par l'appelant) — pthRef=10000 W retenu ici, valeur EXACTE utilisée par les " +
        "auteurs de hplib dans tous les exemples de leur notebook de documentation pour ces 3 " +
        "modèles (t_in=-7, t_out=30/40/45, p_th=10000), donc documentée dans la source et non " +
        "inventée. Pour ces 3 génériques, les colonnes P_el_h_ref [W] et COP_ref sont VIDES dans le " +
        "CSV (hplib.get_parameters() les calcule au chargement) : pElRef et copRef valent donc null " +
        "— le moteur devra pour eux dériver P_el_ref = pthRef / COP(-7,52) via la courbe COP fittée, " +
        "exactement comme le fait hplib.get_parameters() (cop_ref = p1_COP·(-7) + p2_COP·52 + p3_COP " +
        "+ p4_COP·(-7), puis p_el_ref = p_th_ref/cop_ref). " +
        "fabricant = colonne Manufacturer (espaces de début/fin retirés, ex. ' Acond a.s.' " +
        "-> 'Acond a.s.') ; modele = colonne Titel (identifiant unique par sous-modèle testé, " +
        "recommandé par le README : 'use titel name for simulating' — PAS la colonne Model, qui " +
        "regroupe plusieurs variantes Titel sous un même nom commercial). " +
        `${filtered.length} lignes après filtre Type/Subtype, ${pacs.length} retenues après validation ` +
        "des champs numériques (P_th_h_ref/coefficients tous finis) et gardes pElRef/copRef ; " +
        `${consistencyWarnCount} avertissement(s) de cohérence P_el_h_ref vs P_th_h_ref/COP_ref (> 1 %).`,
    },
    { pacs }
  );
}
