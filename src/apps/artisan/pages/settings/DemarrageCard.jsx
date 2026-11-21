// Paramètres → « Pour démarrer » : ce qu'il reste à renseigner pour que l'entreprise serve vraiment.
// Dérivé des réglages (src/lib/organisation/demarrage.js), rien n'est stocké ; disparaît quand tout est fait.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight } from 'lucide-react';
import { etapesDeDemarrage } from '@/lib/organisation/demarrage';

export default function DemarrageCard({ settings }) {
  const etapes = useMemo(() => etapesDeDemarrage(settings), [settings]);
  const faites = etapes.filter((e) => e.fait).length;
  if (faites === etapes.length) return null;

  return (
    <section className="card" aria-labelledby="demarrage-titre">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="demarrage-titre" className="font-semibold text-secondary-900">Pour démarrer</h2>
        <span className="text-sm text-secondary-500 tabular-nums">{faites} sur {etapes.length}</span>
      </div>
      <ul className="mt-3 divide-y divide-secondary-100">
        {etapes.map((e) => (
          <li key={e.cle}>
            <Link to={e.vers} className="flex items-center gap-3 py-2.5 hover:bg-secondary-50 -mx-2 px-2 rounded">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${e.fait ? 'bg-primary-700 text-white' : 'border border-secondary-300'}`}
                aria-hidden="true"
              >
                {e.fait && <Check className="w-3.5 h-3.5" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-medium ${e.fait ? 'text-secondary-500 line-through' : 'text-secondary-900'}`}>{e.titre}</span>
                {!e.fait && <span className="block text-xs text-secondary-500">{e.detail}</span>}
              </span>
              <span className="sr-only">{e.fait ? 'Fait' : 'À faire'}</span>
              <ChevronRight className="w-4 h-4 text-secondary-400" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
