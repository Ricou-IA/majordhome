// src/lib/clientDisplayName.js
// Nom affiché d'un client — module PUR (aucun import), partagé par le service clients et l'import de clients.

/**
 * Catégories pour lesquelles la raison sociale prime sur le nom du contact.
 * Les particuliers gardent NOM PRÉNOM : sur ces fiches le champ société est
 * souvent un nom de personne recopié, pas une entreprise.
 */
export const COMPANY_FIRST_CATEGORIES = ['entreprise', 'public'];

/**
 * Construit le nom affiché d'un client.
 *
 * Source unique de la règle : une fiche entreprise/public dont la société est
 * renseignée s'affiche et se cherche sous sa raison sociale, pas sous le nom
 * de son contact (sinon la fiche est introuvable par le nom de la société).
 * @param {{ firstName?: string, lastName?: string, companyName?: string, clientCategory?: string }} [fiche]
 * @returns {string}
 */
export function buildClientDisplayName({ firstName, lastName, companyName, clientCategory } = {}) {
  const company = (companyName || '').trim();
  if (company && COMPANY_FIRST_CATEGORIES.includes(clientCategory)) {
    return company.toUpperCase();
  }
  return `${(lastName || '').trim()} ${(firstName || '').trim()}`.trim().toUpperCase();
}
