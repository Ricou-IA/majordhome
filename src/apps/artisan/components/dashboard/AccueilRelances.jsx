/**
 * AccueilRelances.jsx — bloc « Relances prioritaires » de la page d'accueil : les devis
 * en attente sans relance depuis plus de SEUIL_RELANCE_JOURS, au plus gros montant
 * (portefeuille.relancesPrioritaires, src/lib/pipelineDashboard.js). Affichage seul ;
 * chaque ligne ouvre la fiche du lead. Rien ne s'affiche quand la liste est vide.
 */

import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Card, CardHeader } from '@components/ui/card';
import { euros } from '@components/pipeline/dashboard/format';

/**
 * @param {Object} props
 * @param {Array<{ leadId: string, nom: string, montant: number, jours: number|null }>} props.relances
 */
export function AccueilRelances({ relances }) {
  if (!relances?.length) return null;
  return (
    <Card as="section" className="overflow-hidden">
      <CardHeader title="Relances prioritaires" subtitle="Devis sans relance, au plus gros montant" />
      <ul className="divide-y divide-secondary-100 border-t border-secondary-100">
        {relances.map((r) => (
          <li key={r.leadId}>
            <Link
              to={`/pipeline?tab=kanban&lead=${encodeURIComponent(r.leadId)}`}
              className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-secondary-50 focus:outline-none focus-visible:bg-secondary-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-secondary-900">{r.nom}</span>
                <span className="block text-st-attente">
                  {r.jours === null ? 'Jamais relancé' : `Sans relance depuis ${r.jours.toLocaleString('fr-FR')} j`}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-secondary-900">{euros(r.montant)} HT</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-secondary-400" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default AccueilRelances;
