/**
 * AccueilACorriger.jsx — bas de la page d'accueil, administrateur seulement : le
 * ménage des données (devis Pennylane non rattachés, fiches en double, leads à
 * plusieurs payeurs, appareils à contrôler). Rien ici ne bloque le travail du jour :
 * ces blocs étaient en tête de page, devant le planning.
 *
 * Chaque bloc ne s'affiche que s'il a quelque chose à montrer ; la section entière
 * disparaît quand ils sont tous vides (`:has` sur le conteneur vide).
 */

import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { PennylaneDoublonsClients } from '@apps/artisan/components/devis/PennylaneDoublonsClients';
import { PennylaneLeadsMultiPayeurs } from '@apps/artisan/components/devis/PennylaneLeadsMultiPayeurs';
import AppareilsAControler from '@apps/artisan/components/dashboard/AppareilsAControler';

/**
 * @param {Object} props
 * @param {boolean} props.pennylaneActif  l'entreprise utilise Pennylane
 * @param {number|null} props.devisNonRattaches  null = inconnu (Pennylane injoignable) : rien n'est affiché
 */
export function AccueilACorriger({ pennylaneActif, devisNonRattaches }) {
  return (
    <section className="space-y-3 [&:has(>[data-blocs]:empty)]:hidden">
      <div>
        <h2 className="text-sm font-semibold text-secondary-900">À corriger</h2>
        <p className="mt-0.5 text-xs text-secondary-500">Ménage des données. Rien ici ne bloque le travail du jour.</p>
      </div>
      <div data-blocs className="space-y-4">
        {pennylaneActif && devisNonRattaches > 0 && (
          <Link
            to="/devis"
            className="flex items-center gap-3 rounded-lg border border-secondary-200 bg-white px-4 py-3 text-sm hover:bg-secondary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <span className="text-base font-semibold tabular-nums text-secondary-900">
              {devisNonRattaches.toLocaleString('fr-FR')}
            </span>
            <span className="flex-1 text-secondary-700">
              devis Pennylane non {devisNonRattaches > 1 ? 'rattachés' : 'rattaché'} à un lead
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-secondary-400" aria-hidden="true" />
          </Link>
        )}
        {pennylaneActif && <PennylaneDoublonsClients />}
        {pennylaneActif && <PennylaneLeadsMultiPayeurs />}
        <AppareilsAControler />
      </div>
    </section>
  );
}

export default AccueilACorriger;
