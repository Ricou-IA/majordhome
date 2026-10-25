// src/lib/catalogue/suggestions.js
// Suggestions de « Rattacher une ligne fournisseur » à un article Majord'home — module PUR, testé
// (scripts/catalogue/suggestions.test.mjs). Décision d'Eric (2026-10-25) : « l'outil devrait proposer une ou des
// correspondances ». On classe les lignes candidates par : même marque, référence fabricant identique ou à un suffixe
// près (TRY32-1-SO / TRY32-1-SO-F), mots du libellé en commun, prix d'achat du même ordre. Chaque suggestion porte ses
// raisons, affichées telles quelles.

/** Normalise une référence en clé (majuscules, A-Z0-9), comme normaliserModele. */
const cle = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Mots d'un libellé : minuscules sans accents, décimale française gardée (« 7,4 » ⇒ « 7.4 »), séparateurs retirés.
 * @param {string} s
 * @returns {Set<string>}
 */
export function jetons(s) {
  const t = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
  return new Set(t.split(/[^a-z0-9.]+/).map((m) => m.replace(/^\.+|\.+$/g, '')).filter(Boolean));
}

/**
 * Compare deux références fabricant : 'identique', 'proche' (l'une = l'autre + 1 ou 2 lettres, clé ≥ 5 caractères) ou null.
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {'identique'|'proche'|null}
 */
export function comparerReferences(a, b) {
  const x = cle(a);
  const y = cle(b);
  if (!x || !y) return null;
  if (x === y) return 'identique';
  const [court, long] = x.length <= y.length ? [x, y] : [y, x];
  if (court.length >= 5 && long.startsWith(court) && /^[A-Z]{1,2}$/.test(long.slice(court.length))) return 'proche';
  return null;
}

/**
 * Score d'une ligne fournisseur candidate pour un article (0 = écartée).
 * @param {{ name: string, brand?: string|null, model_key?: string|null, references?: string[], prix?: number|null }} article
 * @param {{ name: string, brand?: string|null, reference?: string|null, model_key?: string|null, purchase_price_ht?: number|null }} ligne
 * @returns {{ score: number, raisons: string[] }}
 */
export function scorerCandidat(article, ligne) {
  const raisons = [];
  let score = 0;
  const ma = String(article.brand ?? '').trim().toLowerCase();
  const ml = String(ligne.brand ?? '').trim().toLowerCase();
  if (ma && ml) {
    if (ma !== ml) return { score: 0, raisons: [] };
    score += 3; raisons.push('même marque');
  }
  // références : celles de l'article (clé modèle, références de ses lignes) contre celles de la ligne
  const refsArticle = [article.model_key, ...(article.references || [])].filter(Boolean);
  const refsLigne = [ligne.reference, ligne.model_key].filter(Boolean);
  let meilleure = null;
  for (const ra of refsArticle) for (const rl of refsLigne) {
    const c = comparerReferences(ra, rl);
    if (c === 'identique') meilleure = 'identique';
    else if (c === 'proche' && meilleure !== 'identique') meilleure = 'proche';
  }
  if (meilleure === 'identique') { score += 6; raisons.push('même référence fabricant'); }
  else if (meilleure === 'proche') { score += 5; raisons.push('référence fabricant proche'); }
  // libellé : part des mots en commun (Jaccard), la marque mise à part
  const ja = jetons(article.name); const jl = jetons(ligne.name);
  if (ma) { ja.delete(ma); jl.delete(ma); }
  const communs = [...ja].filter((m) => jl.has(m)).length;
  const union = new Set([...ja, ...jl]).size;
  const jaccard = union ? communs / union : 0;
  score += jaccard * 4;
  if (jaccard >= 0.4) raisons.push('libellé proche');
  // prix d'achat du même ordre (un accessoire qui cite le produit n'est pas le produit)
  const pa = Number(article.prix); const pl = Number(ligne.purchase_price_ht);
  if (pa > 0 && pl > 0) {
    const rapport = Math.max(pa, pl) / Math.min(pa, pl);
    if (rapport <= 2) { score += 1; raisons.push('prix du même ordre'); } else if (rapport > 3) score -= 2;
  }
  return { score: Math.max(0, Math.round(score * 100) / 100), raisons };
}

/**
 * Lignes candidates classées pour un article : écarte celles déjà rattachées à cet article et celles sous le seuil.
 * @param {{ id: string } & Parameters<typeof scorerCandidat>[0]} article
 * @param {Array<{ id: string, catalog_item_id?: string|null } & Parameters<typeof scorerCandidat>[1]>} lignes
 * @param {{ max?: number, seuil?: number }} [opts]
 * @returns {Array<{ ligne: object, score: number, raisons: string[] }>}
 */
export function suggestions(article, lignes, { max = 8, seuil = 2.5 } = {}) {
  return (lignes || [])
    .filter((l) => l && l.catalog_item_id !== article.id)
    .map((l) => ({ ligne: l, ...scorerCandidat(article, l) }))
    .filter((s) => s.score >= seuil)
    .sort((a, b) => b.score - a.score || String(a.ligne.name).localeCompare(String(b.ligne.name), 'fr'))
    .slice(0, max);
}

/**
 * Avertissement affiché sur une ligne candidate au rattachement. Chaque ligne fournisseur a son article (rattachement
 * automatique) : dire « déjà rattachée » à chaque fois ne dit rien. On ne signale que la ligne qui QUITTE un article
 * regroupant d'autres lignes (ce groupe perd une offre) ; une ligne seule sur son article se rattache sans mention
 * (l'article vidé est désactivé par la RPC). Article non chargé ⇒ null (on ne devine pas).
 * @param {{ catalog_item_id?: string | null }} ligne
 * @param {Map<string, { name: string, offres_total: number }>} articles article actuel de chaque ligne, par id
 * @returns {string | null}
 */
export function avertissementDepart(ligne, articles) {
  const a = ligne?.catalog_item_id ? articles.get(ligne.catalog_item_id) : null;
  const autres = a ? Number(a.offres_total || 0) - 1 : 0;
  if (!a || autres < 1) return null;
  return `quittera « ${a.name} » (${autres} autre${autres > 1 ? 's' : ''} ligne${autres > 1 ? 's' : ''})`;
}
