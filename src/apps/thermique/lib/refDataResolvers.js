// src/apps/thermique/lib/refDataResolvers.js
// Résolution des données de référence (data/*.json passées en paramètres — module PUR, aucun import).

// Bornes exactes des périodes de u-defauts.json (labels vérifiés plan 1 / Open3CL).
const PERIODES = [
  { max: 1974, label: 'avant 1974' },
  { max: 1977, label: '1975-1977' },
  { max: 1982, label: '1978-1982' },
  { max: 1988, label: '1983-1988' },
  { max: 2000, label: '1989-2000' },
  { max: 2005, label: '2001-2005' },
  { max: 2012, label: '2006-2012' },
  { max: Infinity, label: 'après 2012' },
];

/** Année → label de période 3CL. Année inconnue → 'avant 1974' (sémantique « ou inconnu »).
 * Accepte les chaînes (formulaires HTML) : coercition numérique avant le test de validité. */
export function resolvePeriode(annee) {
  const n = typeof annee === 'string' && annee.trim() !== '' ? Number(annee) : annee;
  if (!Number.isFinite(n)) return 'avant 1974';
  const periode = PERIODES.find((p) => n <= p.max);
  if (!periode) throw new Error(`thermique: aucune période pour ${annee}`);
  return periode.label;
}

const TYPES_U_DEFAUT = ['mur', 'plancherBas', 'plafond', 'fenetre'];

/** U par défaut pour un type de paroi et une année. null si le type n'a pas de table (fenetre). */
export function uDefautPour(uDefauts, type, annee) {
  if (!TYPES_U_DEFAUT.includes(type)) throw new Error(`thermique: type de paroi inconnu « ${type} »`);
  const table = uDefauts[type];
  if (!table) return null; // fenetre : pas de table par période (plan 1)
  const periode = resolvePeriode(annee);
  const row = table.find((r) => r.periode === periode);
  if (!row) throw new Error(`thermique: période « ${periode} » absente de u-defauts (${type})`);
  return row.u;
}

/** θe de base pour un département. Correction d'altitude : volontairement non appliquée en v1
 * (règle du logiciel historique non documentée — calibration prévue en phase de test A/B,
 * cf. docs/thermique-calibration-altitude.md). L'altitude est acceptée en paramètre pour
 * figer la signature ; elle sert aujourd'hui au choix de tranche (une seule tranche ouverte par dépt). */
export function thetaBasePour(climat, dept, altitude) {
  if (/^97|^98/.test(dept)) throw new Error(`thermique: départements DOM non couverts par la table climat (${dept})`);
  const tranches = climat.thetaBase[dept];
  if (!tranches) throw new Error(`thermique: département inconnu « ${dept} »`);
  const tr = tranches.find((t) => t.altMax === null || altitude <= t.altMax);
  return { thetaE: tr.thetaE, correctionAltitude: 'non-appliquée' };
}

/** Coefficient b : catégorie de coefficients-b.json + index de la valeur choisie dans l'UI. */
export function coefficientBPour(coefficientsB, categorie, indexValeur) {
  const cat = coefficientsB.categories.find((c) => c.categorie === categorie);
  if (!cat) throw new Error(`thermique: catégorie b inconnue « ${categorie} »`);
  const v = cat.valeurs[indexValeur];
  if (!v) throw new Error(`thermique: valeur b index ${indexValeur} absente (${categorie})`);
  return v.b;
}

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Recherche de communes par préfixe de nom (insensible accents/casse), filtre dept optionnel. */
export function chercheCommunes(communes, saisie, dept = null) {
  const q = norm(saisie.trim());
  if (q.length < 2) return [];
  return communes.filter((c) => norm(c.nom).startsWith(q) && (!dept || c.dept === dept));
}
