/**
 * config.js — interrupteur du module PROVISOIRE « Chantier Gaillac ».
 *
 * CHANTIER_GAILLAC_ACTIF = false masque d'un coup la route et l'entrée de menu.
 * Procédure de retrait complète : CLAUDE.md → « Modules provisoires – Chantier Gaillac ».
 *
 * Org codée en dur : exception assumée à la règle « pas de valeur d'org dans le code »,
 * le chantier est un contrat Mayer Énergie ponctuel, sans vocation multi-tenant.
 */

export const CHANTIER_GAILLAC_ACTIF = true;

/** Org CORE Mayer Énergie (useAuth().organization.id). */
const CHANTIER_GAILLAC_CORE_ORG_ID = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';

/** Le module est-il visible pour cette organisation ? */
export function chantierGaillacVisible(organization) {
  return CHANTIER_GAILLAC_ACTIF && organization?.id === CHANTIER_GAILLAC_CORE_ORG_ID;
}
