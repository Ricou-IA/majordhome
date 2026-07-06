// src/apps/thermique/components/wizard/ComposeurParoiModal.jsx
// Modale « Composer la paroi » (étape 3 wizard Thermique) : empile des couches de matériaux
// (materiaux.json Th-U, via MateriauPicker), calcule le U en direct (uParoiDepuisCouches) et le
// remonte au composant famille. Pattern modale du repo (overlay + panneau fixed, cf. UwHelperModal —
// pas de @radix-ui/react-dialog installé). Le moteur reste INTACT : on ne produit que { u, couches }.
import { useEffect, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import MateriauPicker from './MateriauPicker';
import { uParoiDepuisCouches } from '../../lib/composeurParois';

export default function ComposeurParoiModal({ famille, label, couchesInitiales, onApply, onClose }) {
  // Copie profonde des couches d'entrée (jamais muter la prop) ; vide sinon.
  const [couches, setCouches] = useState(
    () => (Array.isArray(couchesInitiales) ? couchesInitiales.map((c) => ({ ...c })) : []),
  );

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ajoute = (m) => setCouches((prev) => [...prev, { materiauNom: m.nom, lambda: m.lambda, e: 10 }]);
  const setEpaisseur = (i, brut) => setCouches((prev) => prev.map((c, j) => (
    j === i ? { ...c, e: brut === '' ? '' : Number(brut) } : c
  )));
  const supprime = (i) => setCouches((prev) => prev.flatMap((c, j) => (j === i ? [] : [c])));

  const { u, erreur } = uParoiDepuisCouches(couches, famille);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Composer la paroi — ${label}`}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-lg rounded-xl border border-secondary-200 bg-white p-5 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-secondary-900">Composer la paroi — {label}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-secondary-500 hover:bg-secondary-100 rounded-lg"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-secondary-700">Ajouter une couche</label>
          <MateriauPicker famille={null} onSelect={ajoute} />
        </div>

        {couches.length === 0 ? (
          <p className="text-sm text-secondary-500">
            Ajoutez des couches (de l’extérieur vers l’intérieur).
          </p>
        ) : (
          <ul className="divide-y divide-secondary-100 border border-secondary-100 rounded-lg">
            {couches.map((c, i) => (
              <li key={`${c.materiauNom}-${i}`} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-secondary-900 truncate">{c.materiauNom}</p>
                  <p className="text-xs text-secondary-500">
                    λ {c.lambda}
                    {Number.isFinite(c.e) && c.e > 0 && ` · R ${(c.e / 100 / c.lambda).toFixed(3)} m²·K/W`}
                  </p>
                </div>
                <label className="flex items-center gap-1 text-xs text-secondary-600">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={c.e}
                    onChange={(e) => setEpaisseur(i, e.target.value)}
                    className="w-16 px-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    aria-label="Épaisseur (cm)"
                  />
                  cm
                </label>
                <button
                  type="button"
                  onClick={() => supprime(i)}
                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg flex-shrink-0"
                  title="Supprimer la couche"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div
          className={`px-3 py-2 rounded-lg border text-sm ${
            erreur
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-secondary-50 border-secondary-200 text-secondary-900'
          }`}
        >
          {erreur ? erreur : <>U = <span className="font-semibold">{u}</span> W/(m²·K)</>}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-secondary-700 border border-secondary-300 rounded-lg hover:bg-secondary-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onApply({ u, couches })}
            disabled={u == null}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Utiliser cette paroi
          </button>
        </div>
      </div>
    </>
  );
}
