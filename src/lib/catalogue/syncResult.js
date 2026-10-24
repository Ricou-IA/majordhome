// src/lib/catalogue/syncResult.js
// Mise en forme du dernier relevé d'un fournisseur (suppliers.catalog_sync_result) — module PUR, testé
// (scripts/catalogue/sync-result.test.mjs). Forme écrite par la RPC supplier_catalog_upsert :
//   { ok: true, at, version, inseres, mis_a_jour, desactives, total }
// et par l'edge supplier-catalog-sync en cas d'échec : { ok: false, code, detail?, at }.

/** Codes d'échec émis par l'edge supplier-catalog-sync. */
export const CODES_ERREUR = Object.freeze([
  'identifiants_absents', 'connexion_refusee', 'acces_bloque', 'releve_incomplet', 'releve_instable', 'releve_invalide',
  'connector_inconnu', 'ecriture_refusee', 'erreur_inattendue', 'site_absent',
  'document_absent', 'document_illisible', 'document_existant',
]);

const LIBELLES = Object.freeze({
  identifiants_absents: 'aucun identifiant enregistré pour ce fournisseur',
  connexion_refusee: 'le fournisseur a refusé les identifiants (e-mail ou mot de passe)',
  acces_bloque: 'le site du fournisseur a refusé la connexion serveur (protection anti-robot) : utilisez le relevé depuis votre navigateur',
  site_absent: 'aucune adresse de site renseignée pour ce fournisseur',
  document_absent: 'le fournisseur ne publie pas de fiche technique pour cet article',
  document_illisible: 'la fiche technique du fournisseur n\'a pas pu être téléchargée',
  document_existant: 'la fiche technique est déjà rangée dans les documents de l\'article',
  releve_incomplet: 'le relevé est incomplet, rien n\'a été écrit',
  releve_invalide: 'le fichier de relevé n\'est pas reconnu ou ne contient aucun article du périmètre',
  connector_inconnu: 'ce fournisseur n\'a pas de connexion automatique : importez un relevé',
  ecriture_refusee: 'la base a refusé l\'écriture du catalogue',
  releve_instable: 'le catalogue du fournisseur a changé pendant le relevé (référence en double), rien n\'a été écrit : réessayer',
  erreur_inattendue: 'erreur inattendue pendant le relevé (réseau ou réponse illisible), rien n\'a été écrit : réessayer plus tard',
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
