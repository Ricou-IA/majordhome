/**
 * savDevis.js — devis d'une carte SAV (module PUR, testé scripts/sav-devis.test.mjs).
 *
 * Un devis créé depuis la fiche SAV est fléché vers la carte (`quotes.intervention_id`,
 * migration 20261109_2) : il reste au client, ne crée aucun lead et n'entre jamais dans le
 * pipeline commercial. La carte lit ses devis à la source (`majordhome_entretien_sav.sav_quotes`) ;
 * `devis_amount` saisi à la main ne sert plus que pour un devis fait hors de l'outil.
 */

/**
 * Devis qui fait foi sur la carte : le plus récent qui n'est pas refusé.
 * @param {Array<{ status?: string, created_at?: string }> | null | undefined} quotes
 * @returns {object | null}
 */
export function devisDeReference(quotes) {
  if (!Array.isArray(quotes) || quotes.length === 0) return null;
  const tries = [...quotes].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return tries.find((q) => q.status !== 'refuse') || null;
}

/**
 * Montant HT du devis affiché sur la carte SAV : devis de référence s'il existe, sinon le
 * montant saisi à la main. Un devis fléché à 0 € vaut 0 (il existe) — on ne retombe pas sur la
 * saisie manuelle, qui daterait d'avant le devis.
 * @param {{ sav_quotes?: Array<object> | null, devis_amount?: number | string | null } | null | undefined} item
 * @returns {number}
 */
export function montantDevisSav(item) {
  const reference = devisDeReference(item?.sav_quotes);
  if (reference) return Number(reference.total_ht) || 0;
  return Number(item?.devis_amount) || 0;
}

const STATUT_CARTE = { envoye: 'envoye', accepte: 'accepte', refuse: 'refuse' };

/**
 * Ce qu'un changement de statut du devis fait à la carte SAV — mêmes règles que les boutons
 * Envoyé / Accepté / Refusé de la fiche : envoyé ⇒ colonne « Devis envoyé » (depuis Demande),
 * accepté ⇒ « Pièces commandées » (depuis Demande ou Devis envoyé), refusé ⇒ la carte ne bouge pas.
 * Un brouillon ou un devis expiré ne change rien. Jamais de retour en arrière.
 * @param {{ devis_status?: string | null, workflow_status?: string }} card
 * @param {{ status?: string } | null | undefined} quote
 * @returns {{ devisStatus: string | null, workflow: string | null }} `null` = rien à écrire
 */
export function effetDevisSurCarte(card, quote) {
  const cible = STATUT_CARTE[quote?.status] || null;
  if (!cible || !card) return { devisStatus: null, workflow: null };
  let workflow = null;
  if (cible === 'envoye' && card.workflow_status === 'demande') workflow = 'devis_envoye';
  if (cible === 'accepte' && ['demande', 'devis_envoye'].includes(card.workflow_status)) workflow = 'pieces_commandees';
  return { devisStatus: card.devis_status === cible ? null : cible, workflow };
}

/**
 * Objet « lead » attendu par la fenêtre de devis, construit depuis la carte SAV. Pas d'`id` :
 * aucun lead n'existe ni n'est créé, le devis part sur le client.
 * @param {object} item carte SAV (ligne de `majordhome_entretien_sav`)
 * @returns {object}
 */
export function leadDepuisCarteSav(item) {
  const nomComplet = item?.client_name || '';
  return {
    id: null,
    client_id: item?.client_id || null,
    first_name: item?.client_first_name || '',
    last_name: item?.client_last_name || (item?.client_first_name ? '' : nomComplet),
    address: item?.client_address || '',
    postal_code: item?.client_postal_code || '',
    city: item?.client_city || '',
    phone: item?.client_phone || '',
    email: item?.client_email || '',
  };
}
