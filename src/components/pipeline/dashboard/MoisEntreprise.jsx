/**
 * MoisEntreprise.jsx — bloc 1 du Dashboard : ce qui s'est passé pendant la période
 * (événements), comparé à la période précédente, puis les deux repères du cycle de
 * vie (gagnés à 30 jours, délai de signature).
 */

import { StatStrip } from '@apps/artisan/components/shared/StatStrip';
import { entier, euros, ecartSigne, gagnes30, delai, libelleComparaison } from './format';

export function MoisEntreprise({ entreprise, precedente }) {
  const { actuel, precedent } = entreprise;
  const versus = libelleComparaison(precedente);
  const ecart = (champ, formater) => `${ecartSigne(actuel[champ], precedent[champ], formater)} vs ${versus}`;
  const g30 = gagnes30(actuel);

  const items = [
    { key: 'leads', label: 'Leads reçus', value: entier(actuel.leads), sub: ecart('leads') },
    {
      key: 'rdv',
      label: 'RDV commerciaux',
      value: entier(actuel.rdv),
      sub: ecart('rdv'),
      title: 'Visites techniques et RDV agence datés de la période, hors annulés',
    },
    {
      key: 'devis',
      label: 'Devis émis',
      value: entier(actuel.devis),
      sub: `${euros(actuel.montantDevis)} HT · ${ecart('devis')}`,
    },
    { key: 'ventes', label: 'Ventes signées', value: entier(actuel.ventes), sub: ecart('ventes') },
    { key: 'ca', label: 'CA signé HT', value: euros(actuel.ca), sub: ecart('ca', euros) },
    {
      key: 'g30',
      label: 'Gagnés à 30 jours',
      value: g30.valeur,
      sub: g30.detail,
      title: 'Part des leads reçus pendant la période et signés dans les 30 jours suivant leur arrivée. Définitif 30 jours après la fin de la période.',
    },
    {
      key: 'delai',
      label: 'Délai de signature',
      value: delai(actuel),
      sub: actuel.ventesMesurees > 0
        ? `médiane sur ${entier(actuel.ventesMesurees)} vente${actuel.ventesMesurees > 1 ? 's' : ''}`
        : 'aucune vente mesurable',
      title: 'De l’arrivée du lead à la signature, pour les ventes de la période. Les leads saisis après leur devis ne comptent pas.',
    },
  ];

  return <StatStrip items={items} columns="grid-cols-2 sm:grid-cols-4 xl:grid-cols-7" />;
}
