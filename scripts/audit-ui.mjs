// Contrôle anti-régression de l'interface (refonte UI, 2026-11-22).
// Gèle quatre totaux sur src/**/*.jsx : ils peuvent baisser, jamais monter.
//   petitTexte   : text-[8px] … text-[11px] (hors écrans à géométrie fixe)
//   couleurEnDur : classes Tailwind blue / sky / indigo / slate / gray codées en dur
//   ancienBleu   : #0369a1
//   emoji        : pictogrammes dans le code
// `--update` réécrit la ligne de base ; à n'utiliser que quand un total baisse.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Écrans où la géométrie est fixe : un texte de 10 ou 11 px y est voulu.
// Préfixes de chemin, séparateurs `/`, relatifs à la racine du dépôt.
export const ECRANS_GEOMETRIE_FIXE = [
  'src/apps/artisan/components/planning/',
  'src/apps/artisan/pages/Planning.jsx',
  'src/apps/artisan/components/tournees/',
  'src/apps/artisan/pages/settings/devis/ApercuDevis.jsx',
  'src/apps/solaire/',
  'src/apps/thermique/',
  'src/apps/artisan/components/geogrid/',
  'src/apps/artisan/pages/GeoGrid.jsx',
  'src/apps/maintenance/components/borne/',
  'src/apps/maintenance/pages/Borne.jsx',
];

const PETIT_TEXTE = /text-\[(?:8|9|10|11)(?:\.\d+)?px\]/g;
const COULEUR_EN_DUR = /\b(?:[a-z-]+:)*[a-z]+-(?:blue|sky|indigo|slate|gray)-\d{2,3}\b/g;
const ANCIEN_BLEU = /#0369a1/gi;
const EMOJI = /\p{Extended_Pictographic}/gu;

const compter = (texte, motif) => (texte.match(motif) || []).length;

export function compterMotifs(texte) {
  return {
    petitTexte: compter(texte, PETIT_TEXTE),
    couleurEnDur: compter(texte, COULEUR_EN_DUR),
    ancienBleu: compter(texte, ANCIEN_BLEU),
    emoji: compter(texte, EMOJI),
  };
}

const CHAMPS = ['petitTexte', 'couleurEnDur', 'ancienBleu', 'emoji'];

function fichiersJsx(dossier) {
  const sortie = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) sortie.push(...fichiersJsx(chemin));
    else if (nom.endsWith('.jsx')) sortie.push(chemin);
  }
  return sortie;
}

const estGeometrieFixe = (cheminRelatif) => ECRANS_GEOMETRIE_FIXE.some((p) => cheminRelatif.startsWith(p));

function totaux(racine) {
  const somme = { petitTexte: 0, couleurEnDur: 0, ancienBleu: 0, emoji: 0 };
  for (const f of fichiersJsx(join(racine, 'src'))) {
    const rel = relative(racine, f).split(sep).join('/');
    const n = compterMotifs(readFileSync(f, 'utf8'));
    if (estGeometrieFixe(rel)) n.petitTexte = 0;
    for (const c of CHAMPS) somme[c] += n[c];
  }
  return somme;
}

const estPrincipal = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (estPrincipal) {
  const racine = resolve('.');
  const fichierBase = resolve(racine, 'scripts/audit-ui-baseline.json');
  const actuel = totaux(racine);
  console.log(`audit-ui : ${CHAMPS.map((c) => `${c} ${actuel[c]}`).join(' · ')}`);
  if (process.argv.includes('--update')) {
    writeFileSync(fichierBase, `${JSON.stringify(actuel, null, 2)}\n`);
    console.log('audit-ui : ligne de base réécrite.');
  } else {
    const base = JSON.parse(readFileSync(fichierBase, 'utf8'));
    const hausses = CHAMPS.filter((c) => actuel[c] > base[c]);
    for (const c of hausses) console.error(`audit-ui : ${c} monte de ${actuel[c] - base[c]} (${base[c]} → ${actuel[c]})`);
    if (hausses.length) process.exit(1);
    const baisses = CHAMPS.filter((c) => actuel[c] < base[c]);
    if (baisses.length) console.log(`audit-ui : ${baisses.join(', ')} en baisse, pensez à « node scripts/audit-ui.mjs --update ».`);
  }
}
