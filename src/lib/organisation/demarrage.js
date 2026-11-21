// Démarrage d'une entreprise : ce qu'il reste à renseigner pour qu'elle serve vraiment (documents, carte, e-mails).
// Module PUR, dérivé des réglages de l'organisation : aucune étape n'est stockée, une étape cesse d'être
// proposée dès que son réglage est posé. Règles de l'identité : identite.js ; modules : modules.js.
import { CLES_COORDONNEES, CLES_IDENTITE, validerSaisie } from './identite.js';
import { centresValides } from '../territoire-config.js';
import { moduleActif } from '../modules.js';

/**
 * @param {Object|null} settings core.organizations.settings
 * @returns {Array<{ cle: string, titre: string, detail: string, vers: string, fait: boolean }>}
 */
export function etapesDeDemarrage(settings) {
  const s = settings || {};
  const complet = (cles) => Object.keys(validerSaisie(s, cles)).length === 0;
  const etapes = [
    { cle: 'identite', titre: 'Identité de l’entreprise', detail: 'Raison sociale, SIRET, forme juridique : elles figurent sur vos documents.', vers: '/settings/organization', fait: complet(CLES_IDENTITE) },
    { cle: 'coordonnees', titre: 'Adresse et téléphone', detail: 'Imprimés sur vos devis, contrats et e-mails.', vers: '/settings/organization?tab=contact', fait: complet(CLES_COORDONNEES) },
    { cle: 'logo', titre: 'Logo', detail: 'En tête de vos documents.', vers: '/settings/organization', fait: Boolean((s.logo_url || '').trim()) },
    { cle: 'siege', titre: 'Siège sur la carte', detail: 'Point de départ des trajets, centre de la carte du territoire.', vers: '/settings/organization?tab=territory', fait: centresValides(s.territoire_centers).length > 0 },
  ];
  // L'adresse d'expédition ne sert qu'avec le module Communication : sans lui, rien à proposer.
  if (moduleActif(s, 'communication')) {
    etapes.push({ cle: 'expediteur', titre: 'Adresse d’envoi des e-mails', detail: 'Sans elle, aucun e-mail ne part (factures, rendez-vous, mailing).', vers: '/settings/emails', fait: Boolean((s.from_email || '').trim()) });
  }
  return etapes;
}
