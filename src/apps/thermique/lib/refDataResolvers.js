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

/** Année → label de période 3CL. Année inconnue → 'avant 1974' (sémantique « ou inconnu »). */
export function resolvePeriode(annee) {
  if (!Number.isFinite(annee)) return 'avant 1974';
  return PERIODES.find((p) => annee <= p.max).label;
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
