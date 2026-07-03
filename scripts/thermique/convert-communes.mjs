// Conversion `Base de données - Coordonnées des villes.txt` -> src/apps/thermique/data/communes.json
import { readSource, writeDataJson } from './lib/sourceFiles.js';
import { parseCommunesTsv } from './lib/parseCommunes.js';

const rows = parseCommunesTsv(readSource('Base de données - Coordonnées des villes.txt'));
if (rows.length < 30000) throw new Error(`${rows.length} communes seulement — parser à vérifier`);
writeDataJson('communes.json',
  { source: 'C:\\Thermique (base villes du logiciel historique)', license: 'proprietary-internal',
    note: 'altitude (m) et DJU (degrés-jours unifiés base 18) par commune ; insee est la seule clé quasi-unique (cp partagé par plusieurs communes) ; DJU absent pour ~750 communes dont la quasi-totalité du Var (83) et Corse/DOM — prévoir un fallback départemental côté consommateur' },
  { communes: rows });
