// src/apps/maintenance/components/borne/PavePin.jsx
// Pavé numérique à l'écran (TV + cadre tactile ou souris) : 4 chiffres, validation
// automatique au 4ᵉ. Gros boutons, aucun clavier physique requis.
import { Delete } from 'lucide-react';

const TOUCHES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'effacer'];

export default function PavePin({ valeur, onChange, onComplet, desactive }) {
  const appuyer = (t) => {
    if (desactive) return;
    if (t === 'effacer') { onChange(valeur.slice(0, -1)); return; }
    if (valeur.length >= 4) return;
    const suivant = valeur + t;
    onChange(suivant);
    if (suivant.length === 4) onComplet(suivant);
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex gap-4" aria-label="Code PIN saisi">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`w-6 h-6 rounded-full border-2 ${i < valeur.length ? 'bg-blue-600 border-blue-600' : 'border-slate-400'}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {TOUCHES.map((t, i) => (t === null ? <span key={i} /> : (
          <button
            key={t}
            type="button"
            disabled={desactive}
            onClick={() => appuyer(t)}
            className="w-24 h-20 rounded-2xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-3xl font-semibold
              text-slate-900 flex items-center justify-center disabled:opacity-40"
            aria-label={t === 'effacer' ? 'Effacer' : t}
          >
            {t === 'effacer' ? <Delete className="w-8 h-8" /> : t}
          </button>
        )))}
      </div>
    </div>
  );
}
