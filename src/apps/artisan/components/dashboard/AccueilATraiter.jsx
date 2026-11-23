/**
 * AccueilATraiter.jsx — bloc « À traiter » de la page d'accueil : ce qui attend,
 * une ligne par sujet, chacune ouvre l'écran où on le traite. Les lignes viennent
 * de lignesATraiter (src/lib/accueil.js) ; ce composant n'en calcule aucune.
 * « Rien n'attend » ne s'écrit que si toutes les sources sont connues.
 */

import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Loader2, Plus } from 'lucide-react';
import { Vide } from '@components/pipeline/dashboard/Tableau';
import { Card, CardHeader } from '@components/ui/card';

/**
 * @param {Object} props
 * @param {Array<{ cle: string, nombre: number, texte: string, href: string, attention: boolean }>} props.lignes
 * @param {boolean} props.isLoading  une source charge encore
 * @param {string[]} props.echecs  sources dont la lecture a échoué, en clair (« le pipeline », « les chantiers »)
 * @param {boolean} props.peutCreerLead
 */
export function AccueilATraiter({ lignes, isLoading, echecs = [], peutCreerLead }) {
  const total = lignes.reduce((somme, l) => somme + l.nombre, 0);
  return (
    <Card as="section" className="overflow-hidden">
      <CardHeader title={total > 0 ? `À traiter · ${total.toLocaleString('fr-FR')} ${total > 1 ? 'actions' : 'action'}` : 'À traiter'} />
      {lignes.length > 0 && (
        <ul className="divide-y divide-secondary-100 border-t border-secondary-100">
          {lignes.map((ligne) => (
            <li key={ligne.cle}>
              <Link
                to={ligne.href}
                className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-secondary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
              >
                <span className="w-8 shrink-0 text-right text-base font-semibold tabular-nums text-secondary-900">
                  {ligne.nombre.toLocaleString('fr-FR')}
                </span>
                <span className={`flex-1 ${ligne.attention ? 'font-medium text-st-attente' : 'text-secondary-700'}`}>
                  {ligne.texte}
                </span>
                {ligne.attention && <AlertTriangle className="h-4 w-4 shrink-0 text-st-attente" aria-hidden="true" />}
                <ChevronRight className="h-4 w-4 shrink-0 text-secondary-400" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {isLoading && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-secondary-400" />
        </div>
      )}

      {echecs.length > 0 && (
        <p className="flex items-start gap-2 border-t border-secondary-100 px-5 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Lecture impossible pour {echecs.join(' et ')} : ce qui en dépend n’est pas affiché.
        </p>
      )}

      {lignes.length === 0 && !isLoading && echecs.length === 0 && <Vide>Rien n’attend.</Vide>}

      {peutCreerLead && (
        <div className="border-t border-secondary-200 px-5 py-3">
          <Link
            to="/pipeline?tab=kanban&new=1"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nouveau lead
          </Link>
        </div>
      )}
    </Card>
  );
}

export default AccueilATraiter;
