// Script à usage unique (refonte UI, 2026-11-22) : les gris Tailwind codés en dur
// (gray-* / slate-*) passent sur l'échelle `secondary` (pierre chaude, mêmes paliers).
// Seules les classes utilitaires sont touchées : un préfixe d'utilitaire est exigé.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UTILITAIRES = 'bg|text|border|ring|divide|from|via|to|placeholder|fill|stroke|outline|shadow|decoration|accent|caret';
const GRIS = new RegExp(
  `(?<![\\w-])((?:${UTILITAIRES})(?:-[trblxyse])?)-(?:gray|slate)-(50|100|200|300|400|500|600|700|800|900|950)(?![\\w-])`,
  'g',
);

export function remplacerGris(source) {
  return source.replace(GRIS, '$1-secondary-$2');
}

const EXCLUS_LIB = ['orgBranding.js', 'pagePublique.js', 'mailHabillage.js'];

function exclu(chemin) {
  const p = chemin.split('\\').join('/');
  const nom = p.split('/').pop();
  if (EXCLUS_LIB.some((n) => p.endsWith(`src/lib/${n}`))) return true;
  if (/\.jsx$/.test(nom) && (nom.includes('PDF') || nom.startsWith('pdf'))) return true;
  if (/\/src\/apps\/solaire\/(?:.*\/)?pdf\//i.test(p)) return true;
  return false;
}

function fichiers(dossier) {
  const sortie = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) sortie.push(...fichiers(chemin));
    else if (/\.(jsx|js)$/.test(nom) && !exclu(chemin)) sortie.push(chemin);
  }
  return sortie;
}

const estPrincipal = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (estPrincipal) {
  let modifies = 0;
  let occurrences = 0;
  for (const f of fichiers(resolve('src'))) {
    const avant = readFileSync(f, 'utf8');
    const apres = remplacerGris(avant);
    if (apres !== avant) {
      occurrences += (avant.match(GRIS) || []).length;
      writeFileSync(f, apres);
      modifies += 1;
      console.log(f);
    }
  }
  console.log(`${modifies} fichier(s) modifié(s), ${occurrences} occurrence(s)`);
}
