// src/apps/solaire/lib/consentItems.js
// Consentements recueillis au dossier PV (v1). Texte légal brandé via le nom de société
// (buildCompanyInfo(settings).name — jamais « Mayer » en dur). Constante éditable : ajuster
// le texte ou ajouter un item (RGPD, accès toiture…) sans toucher au composant.

/** Phrase affichée sous les consentements : ces autorisations sont le résumé du mandat complet. */
export const CONSENT_FOOTNOTE = 'Ces autorisations constituent le mandat de représentation (mairie et Enedis). Le mandat complet vous est remis avec le dossier ; il ne prend effet qu’à l’acceptation du devis.';

export function buildConsentItems(companyName) {
  const soc = companyName || 'Votre entreprise';
  return [
    {
      key: 'dp_depot',
      required: true,
      label: 'Dépôt de la déclaration préalable',
      legalText: `J'autorise ${soc} à établir et à déposer en mon nom la déclaration préalable de travaux relative à l'installation photovoltaïque décrite, auprès de la mairie compétente.`,
    },
    {
      key: 'enedis_raccordement',
      required: true,
      label: 'Raccordement ENEDIS',
      legalText: `J'autorise ${soc} à réaliser en mon nom les démarches de raccordement de l'installation au réseau public de distribution d'électricité (ENEDIS), y compris la demande de raccordement.`,
    },
  ];
}
