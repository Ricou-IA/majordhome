// scripts/sync-tournee-engine.mjs
// ============================================================================
// Copie les modules PURS du moteur de tournées (src/lib/tournee/*.js +
// src/lib/sectorClustering.js) vers supabase/functions/_shared/tournee/, pour
// que l'edge slots-propose exécute EXACTEMENT le code de l'écran.
//
// Source unique = src/lib. Ne JAMAIS éditer les copies : elles sont régénérées
// par `npm run sync:tournee-engine`, et scripts/tournee/sync-engine.test.mjs
// (dans `npm run audit:quality`) échoue dès qu'une copie diverge de sa source.
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(racine, 'src', 'lib', 'tournee');
const DST = path.join(racine, 'supabase', 'functions', '_shared', 'tournee');
const NOMS = [
  'arrets', 'creneaux', 'duree', 'eligibilite', 'geo', 'matrice', 'timeline', 'sequence',
  'proposer-contrat', 'loaders', 'trajets-core', 'reglages',
];

export const FICHIERS = [
  ...NOMS.map((n) => ({ source: path.join(SRC, `${n}.js`), cible: path.join(DST, `${n}.js`) })),
  { source: path.join(racine, 'src', 'lib', 'sectorClustering.js'), cible: path.join(DST, 'sectorClustering.js') },
];

/**
 * Contenu d'une copie à partir de sa source. Seule réécriture : geo.js importe
 * sectorClustering depuis le même dossier (la copie est à plat).
 */
export function transformer(source, contenu) {
  const relatif = path.relative(racine, source).replace(/\\/g, '/');
  const entete = `// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis ${relatif} — ne pas éditer.\n`;
  return entete + contenu.replace("from '../sectorClustering.js'", "from './sectorClustering.js'");
}

const lanceDirectement = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (lanceDirectement) {
  mkdirSync(DST, { recursive: true });
  for (const { source, cible } of FICHIERS) {
    writeFileSync(cible, transformer(source, readFileSync(source, 'utf8')));
  }
  console.log(`${FICHIERS.length} fichiers synchronisés vers ${path.relative(racine, DST)}`);
}
