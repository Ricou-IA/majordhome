// src/apps/artisan/components/devis/metre/EtapesMetre.jsx
// Où en est le métré : Solution → Relevé → Récapitulatif (le choix du fabricant est dans le relevé, à côté de la liste
// de pièces qu'il chiffre). Une étape faite se coche et se rouvre d'un clic ; les suivantes sont grisées.
import { Check } from 'lucide-react';

const ETAPES = ['Solution', 'Relevé', 'Récapitulatif'];

export default function EtapesMetre({ etape, onAller }) {
  return (
    <ol className="flex items-center gap-2 px-4 py-2 bg-white border-b border-secondary-200 overflow-x-auto" aria-label="Étapes du métré">
      {ETAPES.map((libelle, i) => {
        const faite = i < etape;
        const courante = i === etape;
        const contenu = (
          <>
            <span className={`inline-grid place-items-center w-6 h-6 rounded-full text-caption font-semibold ${courante ? 'bg-primary-600 text-white' : faite ? 'bg-secondary-100 text-secondary-800' : 'bg-white border border-secondary-300 text-secondary-500'}`}>
              {faite ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : i + 1}
            </span>
            <span className={`text-sm ${courante ? 'font-semibold text-secondary-900' : faite ? 'text-secondary-800' : 'text-secondary-500'}`}>{libelle}</span>
          </>
        );
        return (
          <li key={libelle} className="flex items-center gap-2 shrink-0" aria-current={courante ? 'step' : undefined}>
            {i > 0 && <span aria-hidden="true" className="w-6 h-px bg-secondary-300" />}
            {faite
              ? <button type="button" onClick={() => onAller(i)} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-secondary-50 focus-visible:outline-none focus-visible:shadow-ring">{contenu}</button>
              : <span className="flex items-center gap-2 px-1 py-1">{contenu}</span>}
          </li>
        );
      })}
    </ol>
  );
}
