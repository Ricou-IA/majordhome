// Extraction des heures de chauffage annuelles (colonne « Chauf / an (h) ») depuis
// `Base de données - Coordonnées des départements.txt` -> ajout de la clé `heuresChauffage`
// dans src/apps/thermique/data/climat.json (fichier écrit à la main, PAS via writeDataJson :
// on préserve _meta/_ancres/thetaNonChauffage/thetaBase existants, on ajoute/remplace juste
// heuresChauffage après thetaBase).
//
// Format source : 1 ligne d'en-tête NON quotée (tabs), puis 95 lignes de données où CHAQUE
// ligne est une unique chaîne quotée contenant les colonnes séparées par des tabs (cf.
// lib/parseCommunes.js pour un parseur analogue sur le fichier villes). Colonne 0 = numéro de
// département (ex. "01"), colonne 10 (dernière, index 10 sur 11) = Chauf / an (h).
// ⚠ Quirk connu (plan 1) : la dernière ligne (dept 95, Val-d'Oise) n'a pas son CRLF final ni
// son guillemet fermant — `unquote` doit tolérer une chaîne sans guillemet de fin.
import { SRC_ROOT, readSource, parseFrNumber, unquote } from './lib/sourceFiles.js';
import fs from 'node:fs';
import path from 'node:path';

const REL_PATH = 'Base de données - Coordonnées des départements.txt';
const CLIMAT_PATH = path.join('src', 'apps', 'thermique', 'data', 'climat.json');
const COL_CHAUF_AN = 10; // « Chauf / an (h) » — dernière des 11 colonnes (index 0 = Numéros)

console.log(`source : ${SRC_ROOT}/${REL_PATH}`);
const lines = readSource(REL_PATH).split(/\r?\n/);

const header = lines[0].split('\t');
if (header.length !== 11 || !/Chauf/i.test(header[COL_CHAUF_AN])) {
  throw new Error(`en-tête inattendu (colonne ${COL_CHAUF_AN} = "${header[COL_CHAUF_AN]}", attendu "Chauf / an (h)")`);
}

const heures = {};
for (const rawLine of lines.slice(1)) {
  if (!rawLine.trim()) continue;
  // `unquote` (regex ^"(.*)"$) exige un guillemet de FIN : la dernière ligne (dept 95) n'en a
  // pas (quirk connu, cf. commentaire de tête) et resterait donc préfixée d'un '"' non retiré.
  // On retire ici un éventuel guillemet de tête restant en plus du unquote standard.
  let ligne = unquote(rawLine);
  if (ligne.startsWith('"')) ligne = ligne.slice(1);
  const cols = ligne.split('\t');
  if (cols.length < 11) continue;
  const dept = cols[0].trim();
  const h = parseFrNumber(cols[COL_CHAUF_AN]);
  if (!dept || h == null) continue;
  if (dept === '20') {
    // La source groupe la Corse sous "20" (Ajaccio/S-2A - Bastia/N-2B) : duplication sur 2A/2B,
    // même traitement que θe (cf. _meta.note de climat.json).
    heures['2A'] = h;
    heures['2B'] = h;
  } else {
    heures[dept] = h;
  }
}

const nbDepts = Object.keys(heures).length;
if (nbDepts !== 96) {
  throw new Error(`96 départements attendus (95 + duplication Corse 2A/2B), obtenu ${nbDepts}`);
}
for (const [dept, h] of Object.entries(heures)) {
  if (!Number.isFinite(h) || h < 800 || h > 6000) {
    throw new Error(`département ${dept} : heuresChauffage=${h} hors bornes plausibles [800, 6000]`);
  }
}

// ⚠ Réécriture TEXTUELLE (pas parse→JSON.stringify) : climat.json a des clés numériques-like
// ("01".."95") — un round-trip via un objet JS les réordonnerait (les clés ressemblant à des
// indices de tableau, ex. "10", "75", sont ré-ordonnées numériquement AVANT les clés insertion-
// order par le moteur JS ; "01" avec zéro non significatif y échappe, pas "10"). On préserve
// donc tout le fichier tel quel et on insère/remplace uniquement le bloc heuresChauffage, dans
// le MÊME ordre de clés que thetaBase (numérique avec 2A/2B après "19"), pour rester lisible.
// Rejouable : si heuresChauffage existe déjà (script relancé), on le REMPLACE en place plutôt
// que d'insérer un second bloc ; _meta.source n'est suffixé qu'une seule fois (garde includes).
const original = fs.readFileSync(CLIMAT_PATH, 'utf8');
const climat = JSON.parse(original); // uniquement pour lire l'ordre des clés de thetaBase / état actuel

const EOL = original.includes('\r\n') ? '\r\n' : '\n';
const ordreDepts = Object.keys(climat.thetaBase);
const lignesHeures = ordreDepts.map((d) => `    "${d}": ${heures[d]}`).join(`,${EOL}`);
const blocHeuresChauffage = `"heuresChauffage": {${EOL}${lignesHeures}${EOL}  }`;

let reecrit;
if (climat.heuresChauffage) {
  // Déjà présent (rejeu du script) : remplace le bloc existant en place, verbatim ailleurs.
  const blocExistantRe = /"heuresChauffage":\s*\{[\s\S]*?\r?\n {2}\}/;
  if (!blocExistantRe.test(original)) throw new Error('climat.json : bloc heuresChauffage existant introuvable tel quel — remplacement annulé par sécurité');
  reecrit = original.replace(blocExistantRe, blocHeuresChauffage);
} else {
  // Première exécution : insère juste après la fermeture de thetaBase, en repérant le dernier
  // "\r?\n  }" avant la fermeture racine finale ("\r?\n}\r?\n"), thetaBase étant alors le
  // dernier bloc du fichier.
  const fermetureThetaBaseRe = /\r?\n( {2}\})(\r?\n\}\s*)$/;
  const m = original.match(fermetureThetaBaseRe);
  if (!m) throw new Error('climat.json : fermeture de thetaBase introuvable — format inattendu, insertion textuelle annulée par sécurité');
  reecrit = original.slice(0, m.index) + EOL + m[1] + `,${EOL}  ` + blocHeuresChauffage + m[2];
}

// Met à jour _meta.source (remplacement textuel ciblé, pas de round-trip JSON) — idempotent :
// n'ajoute le suffixe que s'il n'y est pas déjà.
const suffixeSource = ' ; colonne « Chauf / an (h) » = heures de chauffage annuelles, transcrites dans heuresChauffage (même règle de duplication Corse 20 -> 2A/2B).';
if (!climat._meta.source.includes(suffixeSource)) {
  const ancienneSource = JSON.stringify(climat._meta.source);
  const nouvelleSource = JSON.stringify(climat._meta.source + suffixeSource);
  if (!reecrit.includes(ancienneSource)) throw new Error('climat.json : _meta.source introuvable tel quel — insertion annulée par sécurité');
  reecrit = reecrit.replace(ancienneSource, nouvelleSource);
}

// Validation finale : le résultat doit rester du JSON valide et porter les mêmes clés + les nouvelles.
const verif = JSON.parse(reecrit);
if (!verif.heuresChauffage || Object.keys(verif.heuresChauffage).length !== nbDepts) {
  throw new Error('climat.json : relecture post-écriture invalide — annulé par sécurité');
}
if (Object.keys(verif.thetaBase).length !== Object.keys(climat.thetaBase).length) {
  throw new Error('climat.json : thetaBase corrompu après réécriture — annulé par sécurité');
}

fs.writeFileSync(CLIMAT_PATH, reecrit, 'utf8');
console.log(`✓ climat.json : heuresChauffage ajouté/mis à jour (${nbDepts} départements)`);
