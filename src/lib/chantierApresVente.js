/**
 * chantierApresVente.js — l'après-vente d'un chantier réceptionné.
 * ============================================================================
 * Module PUR (aucun import). Un chantier réceptionné porte quatre repères :
 * PV de réception, demande d'avis, contrat d'entretien, facturation.
 *
 * Deux listes viennent d'ailleurs que du chantier (contrats par client, clients à
 * qui l'avis a déjà été demandé). Tant qu'elles ne sont pas connues (chargement,
 * erreur) le repère est `inconnu` et l'envoi du SMS est fermé : une liste vide
 * prise pour « personne n'a été sollicité » renverrait le SMS à tout le monde.
 * ============================================================================
 */

/** Campagne SMS de la demande d'avis après une installation (registre smsCampaigns.js). */
export const CAMPAGNE_AVIS_POSE = 'avis_pose';

const STATUTS_APRES_VENTE = ['realise', 'facture'];

/** L'après-vente s'affiche-t-elle pour ce chantier ? */
export function enApresVente(chantier) {
  return STATUTS_APRES_VENTE.includes(chantier?.chantier_status);
}

/**
 * Contrat d'entretien du client, d'après les statuts de ses contrats.
 * @param {string[]|undefined|null} statuts statuts des contrats du client (`active`, `pending`…)
 * @returns {'actif'|'propose'|'aucun'}
 */
export function etatContrat(statuts) {
  const liste = statuts || [];
  if (liste.includes('active')) return 'actif';
  if (liste.includes('pending')) return 'propose';
  return 'aucun';
}

/**
 * Regroupe les contrats par client.
 * @param {Array<{client_id: string|null, status: string|null}>} lignes
 * @returns {Map<string, string[]>}
 */
export function contratsParClient(lignes) {
  const map = new Map();
  for (const l of lignes || []) {
    if (!l?.client_id) continue;
    if (!map.has(l.client_id)) map.set(l.client_id, []);
    if (l.status) map.get(l.client_id).push(l.status);
  }
  return map;
}

/**
 * @typedef {Object} Repere
 * @property {'pv'|'avis'|'contrat'|'facture'} cle
 * @property {string} libelle   texte court de la pastille
 * @property {'fait'|'en_cours'|'attention'|'a_faire'|'inconnu'} etat
 * @property {string} titre     l'état en toutes lettres (infobulle, fiche)
 */

/** PV de réception : archivé ou signé en ligne = fait ; envoyé au client = en cours. */
export function reperePv(chantier) {
  const signe = Boolean(chantier?.pv_reception_path || chantier?.pv_signed_at);
  if (signe && chantier?.pv_avec_reserves) {
    return { cle: 'pv', libelle: 'Réserves', etat: 'attention', titre: 'PV de réception signé avec réserves' };
  }
  if (signe) return { cle: 'pv', libelle: 'PV', etat: 'fait', titre: 'PV de réception signé' };
  if (chantier?.pv_sent_at) {
    return { cle: 'pv', libelle: 'PV', etat: 'en_cours', titre: 'PV envoyé au client, pas encore signé' };
  }
  return { cle: 'pv', libelle: 'PV', etat: 'a_faire', titre: 'Pas de PV de réception' };
}

/**
 * @param {Object} chantier ligne de `majordhome_chantiers`
 * @param {{ contrats?: Map<string, string[]>, avis?: Set<string> }} [listes] `undefined` = pas encore connues
 * @returns {Repere[]}
 */
export function reperesApresVente(chantier, { contrats, avis } = {}) {
  const clientId = chantier?.client_id || null;

  let repereAvis;
  if (!avis) repereAvis = { etat: 'inconnu', titre: 'Demande d\'avis : vérification en cours' };
  else if (clientId && avis.has(clientId)) repereAvis = { etat: 'fait', titre: 'Avis demandé au client par SMS' };
  else repereAvis = { etat: 'a_faire', titre: 'Avis pas encore demandé' };

  let repereContrat;
  if (!contrats) repereContrat = { etat: 'inconnu', titre: 'Contrat d\'entretien : vérification en cours' };
  else {
    const etat = etatContrat(clientId ? contrats.get(clientId) : null);
    if (etat === 'actif') repereContrat = { etat: 'fait', titre: 'Contrat d\'entretien en cours' };
    else if (etat === 'propose') repereContrat = { etat: 'en_cours', titre: 'Contrat d\'entretien proposé, pas encore signé' };
    else repereContrat = { etat: 'a_faire', titre: 'Pas de contrat d\'entretien' };
  }

  const facture = chantier?.is_invoiced === true;

  return [
    reperePv(chantier),
    { cle: 'avis', libelle: 'Avis', ...repereAvis },
    { cle: 'contrat', libelle: 'Contrat', ...repereContrat },
    {
      cle: 'facture',
      libelle: 'Facturé',
      etat: facture ? 'fait' : 'a_faire',
      titre: facture ? 'Facturé dans Pennylane' : 'Pas encore facturé',
    },
  ];
}

/** Message après un envoi réussi (`sentCount` = nombre de mobiles servis). */
export function messageAvisEnvoye(resultat) {
  const n = Number(resultat?.sentCount) || 1;
  return n > 1 ? `${n} demandes d'avis envoyées` : 'Demande d\'avis envoyée';
}

/**
 * Message après un envoi refusé. Le gabarit absent est une information (le texte du
 * SMS reste à saisir), pas une erreur.
 * @param {{ message?: string }|null|undefined} erreur
 * @returns {{ texte: string, info: boolean }}
 */
export function messageAvisRefuse(erreur) {
  if (erreur?.message === 'campaign_template_missing') {
    return {
      texte: 'Le texte du SMS « Demande d\'avis après une installation » n\'est pas encore saisi (Paramètres → SMS & WhatsApp).',
      info: true,
    };
  }
  return { texte: erreur?.message || 'La demande d\'avis n\'a pas pu partir', info: false };
}

/**
 * Pourquoi la demande d'avis ne peut pas partir, ou `null` si elle le peut.
 * @param {Object} chantier
 * @param {Set<string>|undefined} avis clients déjà sollicités ; `undefined` = liste inconnue
 * @returns {string|null}
 */
export function blocageAvis(chantier, avis) {
  if (!enApresVente(chantier)) return 'L\'avis se demande une fois le chantier réceptionné';
  if (!chantier?.client_id) return 'Ce chantier n\'est rattaché à aucune fiche client';
  if (!avis) return 'Vérification des demandes déjà envoyées…';
  if (avis.has(chantier.client_id)) return 'Avis déjà demandé à ce client';
  if (!String(chantier?.phone || '').trim()) return 'Le client n\'a pas de numéro de téléphone';
  return null;
}
