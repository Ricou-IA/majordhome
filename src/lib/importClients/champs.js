// src/lib/importClients/champs.js
// Catalogue des champs d'une fiche client importable — module PUR (aucun import React, Supabase ni alias),
// testé par scripts/import-clients/champs.test.mjs, destiné à être copié pour Deno.

/** Cibles particulières d'une colonne du fichier (hors champs du catalogue). */
export const CIBLE_NOTES = '@notes';
export const CIBLE_IGNORER = '@ignorer';
export const CIBLE_A_CHOISIR = '';

/**
 * Les vingt champs d'un client, dans l'ordre du fichier type.
 * `valeurs` : valeurs admises par la colonne pour un champ de type « enum ».
 * @type {Array<{ cle: string, libelle: string, colonne: string, type: string, synonymes: string[], exemple: string, aide: string, valeurs?: string[] }>}
 */
export const CHAMPS = [
  { cle: 'type_client', libelle: 'Type de client', colonne: 'client_category', type: 'enum', valeurs: ['particulier', 'entreprise', 'public'],
    synonymes: ['Catégorie', 'Catégorie client', 'Nature du client', 'Type'], exemple: 'particulier', aide: 'Particulier, entreprise ou collectivité (public). Vide : particulier.' },
  { cle: 'nom', libelle: 'Nom', colonne: 'last_name', type: 'texte',
    synonymes: ['Nom de famille', 'Nom client', 'Nom du client', 'Patronyme'], exemple: 'Dupont', aide: 'Nom de famille du client.' },
  { cle: 'prenom', libelle: 'Prénom', colonne: 'first_name', type: 'texte',
    synonymes: ['Prénom client'], exemple: 'Jean', aide: 'Prénom du client.' },
  { cle: 'societe', libelle: 'Société', colonne: 'company_name', type: 'texte',
    synonymes: ['Raison sociale', 'Entreprise', 'Nom société', 'Nom de la société'], exemple: 'SARL Dupont', aide: 'Nom de la société, pour un client professionnel.' },
  { cle: 'email', libelle: 'E-mail', colonne: 'email', type: 'email',
    synonymes: ['Email', 'Mail', 'Courriel', 'Adresse e-mail', 'Adresse mail'], exemple: 'jean.dupont@orange.fr', aide: 'Adresse e-mail du client.' },
  { cle: 'telephone', libelle: 'Téléphone', colonne: 'phone', type: 'telephone',
    synonymes: ['Tél', 'Tel', 'Portable', 'Mobile', 'GSM', 'Tél. portable', 'Téléphone portable', 'Numéro de téléphone'], exemple: '06 12 34 56 78', aide: 'Numéro principal (de préférence le portable).' },
  { cle: 'telephone_2', libelle: 'Téléphone 2', colonne: 'phone_secondary', type: 'telephone',
    synonymes: ['Téléphone fixe', 'Fixe', 'Tél. 2', 'Tél. fixe', 'Autre téléphone'], exemple: '04 72 00 00 00', aide: 'Second numéro (fixe ou autre).' },
  { cle: 'adresse', libelle: 'Adresse', colonne: 'address', type: 'texte',
    synonymes: ['Rue', 'Adresse postale', 'Adresse 1', 'Numéro et rue'], exemple: '12 rue de la République', aide: 'Numéro et nom de la rue.' },
  { cle: 'complement_adresse', libelle: 'Complément d\'adresse', colonne: 'address_complement', type: 'texte',
    synonymes: ['Complément', 'Adresse 2', 'Lieu-dit', 'Bâtiment'], exemple: 'Bâtiment B', aide: 'Lieu-dit, bâtiment, étage…' },
  { cle: 'code_postal', libelle: 'Code postal', colonne: 'postal_code', type: 'code_postal',
    synonymes: ['CP'], exemple: '69003', aide: 'Cinq chiffres.' },
  { cle: 'ville', libelle: 'Ville', colonne: 'city', type: 'texte',
    synonymes: ['Commune', 'Localité'], exemple: 'Lyon', aide: 'Commune du client.' },
  { cle: 'type_logement', libelle: 'Type de logement', colonne: 'housing_type', type: 'enum', valeurs: ['maison', 'appartement', 'local_commercial', 'immeuble', 'autre'],
    synonymes: ['Logement', 'Type de bien', 'Type d\'habitation', 'Habitation'], exemple: 'maison', aide: 'Maison, appartement, local commercial, immeuble ou autre.' },
  { cle: 'surface', libelle: 'Surface', colonne: 'surface', type: 'nombre',
    synonymes: ['Surface habitable', 'Superficie', 'Surface en m²'], exemple: '120', aide: 'Surface en m², nombre seul.' },
  { cle: 'annee_construction', libelle: 'Année de construction', colonne: 'construction_year', type: 'entier',
    synonymes: ['Année construction', 'Construction', 'Année du bâtiment'], exemple: '1985', aide: 'Quatre chiffres.' },
  { cle: 'consignes_acces', libelle: 'Consignes d\'accès', colonne: 'access_instructions', type: 'texte',
    synonymes: ['Accès', 'Code portail', 'Digicode', 'Instructions d\'accès'], exemple: 'Portail vert, sonner', aide: 'Ce que le technicien doit savoir pour entrer.' },
  // Aucun synonyme : une colonne « Note » ou « Remarques » d'un autre logiciel ne part jamais d'office chez le client.
  { cle: 'notes', libelle: 'Notes (visibles par le client)', colonne: 'notes', type: 'texte',
    synonymes: [], exemple: 'Client fidèle depuis 2015', aide: 'Notes que le client peut voir.' },
  { cle: 'notes_internes', libelle: 'Notes internes', colonne: 'internal_notes', type: 'texte',
    synonymes: ['Note interne', 'Note', 'Observations', 'Informations', 'Remarques', 'Remarque', 'Commentaires', 'Commentaire'],
    exemple: 'Ne pas appeler le lundi', aide: 'Notes réservées à l\'entreprise.' },
  { cle: 'accepte_emails', libelle: 'Accepte les e-mails', colonne: 'mail_optin', type: 'oui_non', valeurs: ['oui', 'non'],
    synonymes: ['Accord e-mails', 'Accepte les emails', 'Optin e-mail', 'Newsletter'], exemple: 'oui', aide: 'Oui ou non. Vide : oui.' },
  { cle: 'accepte_sms', libelle: 'Accepte les SMS', colonne: 'sms_optin', type: 'oui_non', valeurs: ['oui', 'non'],
    synonymes: ['Accord SMS', 'Optin SMS'], exemple: 'oui', aide: 'Oui ou non. Vide : oui.' },
  { cle: 'ancien_numero', libelle: 'Ancien numéro', colonne: 'external_ref', type: 'texte',
    synonymes: ['N° client', 'Numéro client', 'Code client', 'Réf. client', 'Référence client', 'Ancien numéro client'], exemple: 'C-04521', aide: 'Numéro du client dans l\'ancien logiciel.' },
];

/** Colonnes du fichier qui remplissent plusieurs champs à la fois. */
export const CIBLES_COMPOSEES = [
  { cle: '@nom_prenom', libelle: 'Nom et prénom, dans cet ordre', remplit: ['nom', 'prenom'],
    // Ni « Client » ni « Contact » : dans beaucoup d'exports ils portent un numéro, un téléphone ou un e-mail.
    synonymes: ['Nom complet', 'Nom et prénom', 'Nom prénom'] },
  { cle: '@prenom_nom', libelle: 'Prénom et nom, dans cet ordre', remplit: ['prenom', 'nom'],
    synonymes: ['Prénom et nom', 'Prénom nom'] },
  { cle: '@cp_ville', libelle: 'Code postal et ville', remplit: ['code_postal', 'ville'],
    synonymes: ['CP Ville', 'CP / Ville', 'Code postal et ville', 'Code postal ville', 'CP et ville'] },
  { cle: '@adresse_complete', libelle: 'Adresse complète (rue, code postal, ville)', remplit: ['adresse', 'code_postal', 'ville'],
    synonymes: ['Adresse complète', 'Adresse postale complète', 'Adresse de facturation', 'Adresse du client'] },
];

/**
 * @param {string} cle
 * @returns {object|null} le champ du catalogue, ou null
 */
export function champParCle(cle) {
  return CHAMPS.find((c) => c.cle === cle) || null;
}

/**
 * Forme comparable d'un en-tête : minuscules, sans accent, ponctuation et espaces multiples réduits à une espace.
 * @param {string} texte
 * @returns {string}
 */
export function cleEntete(texte) {
  return String(texte ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const INDEX_ENTETES = (() => {
  const index = new Map();
  for (const c of CHAMPS) for (const s of [c.libelle, ...c.synonymes]) index.set(cleEntete(s), c.cle);
  for (const c of CIBLES_COMPOSEES) for (const s of c.synonymes) index.set(cleEntete(s), c.cle);
  return index;
})();

/**
 * Champ (ou cible composée) désigné par l'en-tête d'une colonne : libellé exact du catalogue ou synonyme.
 * @param {string} entete
 * @returns {string} la clé du champ ou de la cible composée, ou '' si l'en-tête n'est pas reconnu
 */
export function cibleDepuisEntete(entete) {
  return INDEX_ENTETES.get(cleEntete(entete)) || CIBLE_A_CHOISIR;
}
