// src/apps/thermique/lib/refDataResolvers.js
// Résolution des données de référence (data/*.json passées en paramètres — module PUR, aucun import).
// NOTE : la forme de retour { thetaE, correctionAltitude } de thetaBasePour est temporaire —
// elle repassera scalaire (ou convention 'extras') quand la correction d'altitude sera calibrée.

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
 * (règle du logiciel historique non documentée — calibration prévue en phase de test A/B ;
 * décision et données : _meta.note de climat.json ; protocole détaillé :
 * docs/thermique-calibration-altitude.md, créé en Task 9 de ce plan). L'altitude est acceptée en
 * paramètre pour figer la signature ; elle sert aujourd'hui au choix de tranche (une seule tranche
 * ouverte par dépt). */
export function thetaBasePour(climat, dept, altitude) {
  if (/^(97|98)/.test(dept)) throw new Error(`thermique: départements DOM non couverts par la table climat (${dept})`);
  const tranches = climat.thetaBase[dept];
  if (!tranches) throw new Error(`thermique: département inconnu « ${dept} »`);
  const tr = tranches.find((t) => t.altMax === null || altitude <= t.altMax);
  return { thetaE: tr.thetaE, correctionAltitude: 'non-appliquée' };
}

/** Coefficient b : catégorie de coefficients-b.json + libellé (description) de la valeur choisie.
 * Sélection par libellé et non par index : l'index d'un tableau JSON n'est pas un contrat stable,
 * le libellé l'est. Les catégories à valeur unique sans libellé (description: null dans le JSON)
 * se sélectionnent avec description = null. */
export function coefficientBPour(coefficientsB, categorie, description) {
  const cat = coefficientsB.categories.find((c) => c.categorie === categorie);
  if (!cat) throw new Error(`thermique: catégorie b inconnue « ${categorie} »`);
  const v = cat.valeurs.find((val) => val.description === description);
  if (!v) throw new Error(`thermique: valeur b « ${description} » absente (${categorie})`);
  return v.b;
}

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Cache de normalisation des noms de communes (clé : le tableau lui-même — WeakMap, pas de fuite).
const NOMS_NORMALISES = new WeakMap();

function nomsNormalises(communes) {
  let cached = NOMS_NORMALISES.get(communes);
  if (!cached) {
    cached = communes.map((c) => ({ ref: c, nomNorm: norm(c.nom) }));
    NOMS_NORMALISES.set(communes, cached);
  }
  return cached;
}

/** Recherche de communes par préfixe de nom (insensible accents/casse), filtre dept optionnel
 * (chaîne ou nombre). Saisie non-chaîne ou vide → []. */
export function chercheCommunes(communes, saisie, dept = null) {
  if (typeof saisie !== 'string' || !saisie.trim()) return [];
  const q = norm(saisie.trim());
  if (q.length < 2) return [];
  const d = dept == null ? null : String(dept);
  return nomsNormalises(communes)
    .filter((e) => e.nomNorm.startsWith(q) && (!d || e.ref.dept === d))
    .map((e) => e.ref);
}

/** DJU de repli départemental = MÉDIANE des DJU non-null du département (décision plan 4 R2). */
export function djuDepartemental(communes, dept) {
  const djus = communes.filter((c) => c.dept === String(dept) && Number.isFinite(c.dju))
    .map((c) => c.dju).sort((a, b) => a - b);
  if (djus.length === 0) throw new Error(`thermique: aucun DJU disponible pour le département ${dept}`);
  const m = Math.floor(djus.length / 2);
  return djus.length % 2 ? djus[m] : (djus[m - 1] + djus[m]) / 2;
}

/**
 * Système + débit total réglementaire pour un type de ventilation et un nombre de pièces principales.
 * Palier clampé aux bornes de la table (T7 reconduit au-delà — _meta.notes ventilation.json).
 * @returns {{ systeme: object, debitTotal: number|null }} debitTotal null en mode 'taux'.
 */
export function debitVentilationPour(ventilation, systemeId, nbPiecesPrincipales) {
  const systeme = ventilation.systemes.find((s) => s.id === systemeId);
  if (!systeme) throw new Error(`thermique: système de ventilation inconnu « ${systemeId} »`);
  if (systeme.mode === 'taux') return { systeme, debitTotal: null };
  const table = ventilation.debitsExtraitsParTaille;
  const n = Math.min(Math.max(1, nbPiecesPrincipales), table[table.length - 1].piecesPrincipales);
  const row = table.find((r) => r.piecesPrincipales === n);
  return { systeme, debitTotal: row.debitTotal };
}

/**
 * Uw proposé depuis les composants menuiseries.json — forfait assumé (D3) :
 * Uw ≈ 0.7·Ug + 0.3·Uf (répartition surfacique vitrage/châssis typique), sans ψ intercalaire.
 * Volet : Ujn = 1/(1/Uw + ΔR) (résistance additionnelle fermée).
 */
export function uwDepuisComposants({ ug, uf, deltaR = null }) {
  if (!Number.isFinite(ug) || ug <= 0 || !Number.isFinite(uf) || uf <= 0) {
    throw new Error('thermique: ug et uf > 0 requis');
  }
  const uw = 0.7 * ug + 0.3 * uf;
  const ujn = Number.isFinite(deltaR) && deltaR > 0 ? 1 / (1 / uw + deltaR) : null;
  return { uw, ujn };
}
