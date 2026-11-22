// Script à usage unique (refonte UI, 2026-11-22) : le bouton d'action à texte blanc
// passe sur primary-600 (cuivre), survol primary-700. Chaque littéral de chaîne
// ("…", '…', `…`) est traité seul : sans `text-white` dedans, il n'est pas touché.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FOND = /(?<![\w:-])bg-(?:primary-700|(?:blue|indigo|sky)-(?:500|600|700))(?![\w/-])/g;
const SURVOL = /(?<![\w-])hover:bg-(?:primary-800|(?:blue|indigo|sky)-(?:600|700|800))(?![\w/-])/g;
const TEXTE_BLANC = /(?<![\w:-])text-white(?![\w/-])/;
const LITTERAL = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;

export function remplacerBoutonAction(source) {
  return source.replace(LITTERAL, (chaine) => {
    if (!TEXTE_BLANC.test(chaine)) return chaine;
    return chaine.replace(SURVOL, 'hover:bg-primary-700').replace(FOND, 'bg-primary-600');
  });
}

function fichiers(dossier) {
  const sortie = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      if (chemin.split(sep).join('/').endsWith('src/lib')) continue;
      sortie.push(...fichiers(chemin));
    } else if (/\.(jsx|js)$/.test(nom)) sortie.push(chemin);
  }
  return sortie;
}

const estPrincipal = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (estPrincipal) {
  let modifies = 0;
  for (const f of fichiers(resolve('src'))) {
    const avant = readFileSync(f, 'utf8');
    const apres = remplacerBoutonAction(avant);
    if (apres !== avant) { writeFileSync(f, apres); modifies += 1; }
  }
  console.log(`${modifies} fichier(s) modifié(s)`);
}
