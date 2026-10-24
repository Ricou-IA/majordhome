// src/lib/catalogue/syncResult.js
// Mise en forme du dernier relevé d'un fournisseur (suppliers.catalog_sync_result) — module PUR, testé
// (scripts/catalogue/sync-result.test.mjs). Forme écrite par la RPC supplier_catalog_upsert :
//   { ok: true, at, version, inseres, mis_a_jour, desactives, total }
// et par l'edge supplier-catalog-sync en cas d'échec : { ok: false, code, detail?, at }.

/** Codes d'échec émis par l'edge supplier-catalog-sync. */
export const CODES_ERREUR = Object.freeze([
  'identifiants_absents', 'connexion_refusee', 'acces_bloque', 'releve_incomplet', 'releve_invalide', 'connector_inconnu', 'ecriture_refusee',
]);

const LIBELLES = Object.freeze({
  identifiants_absents: 'aucun identifiant enregistré pour ce fournisseur',
  connexion_refusee: 'le fournisseur a refusé les identifiants (e-mail ou mot de passe)',
  acces_bloque: 'BayWa a refusé la connexion serveur (protection anti-robot) : utilisez le relevé depuis votre navigateur',
  releve_incomplet: 'le relevé est incomplet, rien n\'a été écrit',
  releve_invalide: 'le fichier de relevé n\'est pas reconnu ou ne contient aucun article du périmètre',
  connector_inconnu: 'ce fournisseur n\'a pas de connexion automatique : importez un relevé',
  ecriture_refusee: 'la base a refusé l\'écriture du catalogue',
});

/**
 * Libellé français d'un code d'échec (le code brut si inconnu).
 * @param {string} code
 * @returns {string}
 */
export function libelleCodeErreur(code) {
  return LIBELLES[code] || `erreur ${code}`;
}

/**
 * Date courte française (JJ/MM/AAAA) ; '' si invalide.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
function dateCourte(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Phrase du dernier relevé : « Relevé du 24/10/2026 : 87 articles, 2 nouveaux, 1 désactivé »,
 * « Échec du relevé du 24/10/2026 : … » ou « Jamais relevé ».
 * @param {Record<string, any>|null|undefined} result
 * @returns {string}
 */
export function libelleResultat(result) {
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') return 'Jamais relevé';
  const quand = dateCourte(result.at);
  const du = quand ? ` du ${quand}` : '';
  if (!result.ok) return `Échec du relevé${du} : ${libelleCodeErreur(result.code)}`;
  const n = (v) => Number(v) || 0;
  const parts = [`${n(result.total)} article${n(result.total) > 1 ? 's' : ''}`];
  if (n(result.inseres) > 0) parts.push(`${n(result.inseres)} nouveau${n(result.inseres) > 1 ? 'x' : ''}`);
  if (n(result.desactives) > 0) parts.push(`${n(result.desactives)} désactivé${n(result.desactives) > 1 ? 's' : ''}`);
  return `Relevé${du} : ${parts.join(', ')}`;
}
