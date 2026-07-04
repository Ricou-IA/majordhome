// Conversion Open3CL (tables réglementaires 3CL-DPE, MIT) -> src/apps/thermique/data/u-defauts.json
//
// Usage : node scripts/thermique/convert-u-defauts.mjs "<chemin>/open3cl/src/tv.js"
// (chemin vers le fichier tv.js d'un clone de https://github.com/Open3CL/engine)
//
// Sans argv (ex. appelé depuis convert-all.mjs sans clone local disponible), le script
// affiche un message de skip et sort en 0 : rien à convertir sans la source Open3CL.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeDataJson } from './lib/sourceFiles.js';

const tvPath = process.argv[2];

if (!tvPath) {
  console.log('⏭ convert-u-defauts : aucun chemin vers tv.js (Open3CL) fourni en argv — conversion sautée.');
  console.log('   Usage : node scripts/thermique/convert-u-defauts.mjs "<chemin>/open3cl/src/tv.js"');
  process.exit(0);
}

const { tvs } = await import(pathToFileURL(path.resolve(tvPath)).href);

// Les tables umur/upb/uph d'Open3CL sont multi-dimensionnelles : période de construction ×
// zone climatique (H1/H2/H3) × effet Joule (0/1). On retient la colonne la plus générale/neutre :
//   - zone_climatique = 'H1' (zone de référence la plus tempérée, la plus "France moyenne")
//   - effet_joule = '0' (cas non-Joule, cas général — le chauffage électrique par effet Joule
//     est une variante qui durcit légèrement certaines exigences, cf. valeurs 1978-1988)
// Pour uph (plafond/toiture), la table distingue en plus type_toiture: 'combles' vs 'terrasse'.
// On retient 'combles' (plafond sous comble, cas résidentiel le plus courant).
const ZONE = 'H1';
const EFFET_JOULE = '0';
const TYPE_TOITURE = 'combles';

function extract(rows, valueKey, extraFilter = () => true) {
  const filtered = rows.filter(
    (r) => r.zone_climatique === ZONE && r.effet_joule === EFFET_JOULE && extraFilter(r)
  );
  // Les enum_periode_construction_id '1|2' sont fusionnés par Open3CL sous un seul libellé
  // "avant 1974 ou inconnu" : la table ne distingue pas avant-1948 de 1948-1974 (même U0).
  // Le libellé Open3CL ">=2013" est reformulé en "après 2012" (borne identique, formulation
  // alignée sur les autres libellés "avant X"/"après X" du domaine 3CL).
  const relabel = (p) => {
    if (p === 'avant 1974 ou inconnu') return 'avant 1974';
    if (p === '>=2013') return 'après 2012';
    return p;
  };
  return filtered.map((r) => ({
    periode: relabel(r.periode_construction),
    u: Number(r[valueKey]),
  }));
}

const mur = extract(tvs.umur, 'umur');
const plancherBas = extract(tvs.upb, 'upb');
const plafond = extract(tvs.uph, 'uph', (r) => r.type_toiture === TYPE_TOITURE);

for (const [nom, arr] of [['mur', mur], ['plancherBas', plancherBas], ['plafond', plafond]]) {
  if (arr.length < 6) throw new Error(`${nom} : seulement ${arr.length} périodes extraites — table Open3CL à vérifier`);
}

// Fenêtre : Open3CL n'a PAS de table uw indexée par période de construction. La table `uw`
// (tv.js) est indexée uniquement par type_baie × type_materiaux_menuiserie (× ug pour le
// double vitrage) — un Uw "par défaut de type de menuiserie/vitrage", pas "par période".
// Dériver un défaut par période inventerait une correspondance non présente dans la source :
// on ne livre donc PAS de tableau `fenetre` (cf. consigne : ne pas inventer).

writeDataJson('u-defauts.json',
  {
    source: 'Open3CL/engine (MIT) — src/tv.js, tables umur/upb/uph (tvs.umur, tvs.upb, tvs.uph)',
    sourceRef: 'bb583ee75bb9faf5f3c5ba0984115c21b7a167d5',
    license: 'MIT',
    note:
      "Tables Open3CL multi-dimensionnelles (période de construction × zone climatique H1/H2/H3 × effet Joule 0/1) ; " +
      "colonne retenue = zone_climatique 'H1' (zone de référence la plus tempérée) et effet_joule '0' (cas non-Joule, cas général). " +
      "Pour uph (plafond/toiture), colonne type_toiture='combles' retenue (vs 'terrasse'), cas résidentiel le plus courant. " +
      "Les enum_periode_construction_id '1|2' sont fusionnées par Open3CL en un seul libellé 'avant 1974 ou inconnu' " +
      "(même valeur pour avant 1948 et 1948-1974) : reporté ici comme période unique 'avant 1974'. " +
      "Conséquence directe de cette fusion (sémantique 3CL) : une année de construction INCONNUE doit être résolue " +
      "vers cette même période 'avant 1974' (le moteur ne doit pas inventer une autre valeur par défaut pour ce cas). " +
      "La dernière période Open3CL '>=2013' (reportée ici 'après 2012') couvre les enum_periode_construction " +
      "'2013-2021' et 'après 2021' (même valeur dans la table). " +
      "AUCUNE valeur fenêtre : la table Open3CL `uw` (tv.js) est indexée par type de baie/menuiserie/vitrage, " +
      "PAS par période de construction — il n'existe pas de Uw par défaut par période dans Open3CL. " +
      "Dériver un tel mapping aurait nécessité d'inventer des valeurs hors source : non fait (voir rapport de tâche).",
  },
  { mur, plancherBas, plafond });
