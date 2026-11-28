// src/lib/aspirateur/codes.js
// Module PUR (copié pour Deno et pour le service VPS) : codes d'erreur de l'aspirateur ↔ messages affichés.
// Les edges rendent `{ data, error: code }` ; tout code rendu par une edge existe ici (test scripts/aspirateur/edges.test.mjs).
// Testé : node --test scripts/aspirateur/recette.test.mjs

/** @type {Readonly<Record<string, string>>} */
export const CODES_ASPIRATEUR = Object.freeze({
  acces_absents: 'Enregistrez d’abord l’identifiant et le mot de passe du compte en ligne',
  acces_refuses: 'Identifiant ou mot de passe refusés par le site',
  site_absent: 'Renseignez d’abord l’adresse du site sur la fiche',
  site_protege: 'Le site bloque les robots : aspiration impossible',
  recette_obsolete: 'La recette ne marche plus : réapprenez le site',
  recette_refusee: 'Recette écartée : rien n’a été aspiré',
  recette_contient_secret: 'La recette contenait un identifiant : elle a été refusée',
  plafond_atteint: 'Plafond de dépense atteint : travail arrêté',
  quota_atteint: 'Trop d’aspirations aujourd’hui : réessayez demain',
  deja_en_cours: 'Une aspiration de ce site est déjà en cours',
  service_indisponible: 'Service d’aspiration indisponible : réessayez plus tard',
  travail_inconnu: 'Travail d’aspiration introuvable',
  non_autorise: 'Réservé à un administrateur',
  nature_prix_absente: 'Indiquez d’abord la nature des prix lus sur le site',
  propositions_absentes: 'Aucune proposition à appliquer',
  requete_invalide: 'Requête invalide',
});

const REPLI = 'Erreur inattendue de l’aspirateur';

/**
 * Message d'un code ; repli neutre pour un code inconnu ou absent.
 * @param {string | null | undefined} code
 * @returns {string}
 */
export function messageAspirateur(code) {
  return (typeof code === 'string' && Object.hasOwn(CODES_ASPIRATEUR, code)) ? CODES_ASPIRATEUR[code] : REPLI;
}
