/**
 * AppareilsAControler.jsx — carte du tableau de bord (org_admin) : appareils trouvés sur le web et validés par un
 * intervenant, en attente de contrôle. Rien ne s'affiche quand la file est vide.
 * Spec : docs/superpowers/specs/2026-11-11-referentiel-appareils-installes-saisie-terrain-design.md § 6.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PackageCheck, X } from 'lucide-react';
import { useModelsToReview } from '@hooks/useEquipmentModels';
import AppareilAControlerFiche from './AppareilAControlerFiche';

export default function AppareilsAControler() {
  const { fiches } = useModelsToReview();
  const [ouvert, setOuvert] = useState(false);
  const [choisie, setChoisie] = useState(null);
  const fiche = fiches.find((f) => f.id === choisie) || fiches[0] || null;

  useEffect(() => { if (ouvert && !fiches.length) setOuvert(false); }, [ouvert, fiches.length]);

  if (!fiches.length) return null;

  return (
    <div className="card flex flex-wrap items-center gap-3">
      <PackageCheck className="w-5 h-5 text-amber-500" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-secondary-900">Appareils à contrôler ({fiches.length})</p>
        <p className="text-xs text-secondary-500">Trouvés sur le web et validés sur le terrain : validez, corrigez ou fusionnez.</p>
      </div>
      <button type="button" onClick={() => setOuvert(true)} className="btn-primary btn-sm">Contrôler</button>

      {ouvert && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Appareils à contrôler">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col m-4">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h2 className="text-base font-semibold text-gray-900">Appareils à contrôler ({fiches.length})</h2>
              <button type="button" onClick={() => setOuvert(false)} className="p-1 hover:bg-gray-100 rounded" aria-label="Fermer"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col md:flex-row">
              <div className="md:w-64 md:border-r border-b md:border-b-0 overflow-y-auto max-h-40 md:max-h-none">
                {fiches.map((f) => (
                  <button
                    key={f.id} type="button" onClick={() => setChoisie(f.id)}
                    className={`w-full text-left px-4 py-2.5 border-b border-gray-100 ${fiche?.id === f.id ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                  >
                    <p className="text-sm font-medium text-gray-900 truncate">{f.brand} · {f.model_name}</p>
                    <p className="text-xs text-gray-500 truncate">{Number(f.nb_equipements) ? `${f.nb_equipements} équipement(s)` : 'aucun client'}</p>
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {fiche && <AppareilAControlerFiche key={fiche.id} fiche={fiche} onDone={() => setChoisie(null)} />}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
