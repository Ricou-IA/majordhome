/**
 * OffreDepot.jsx — Dépôt d'une offre de prix fournisseur (PDF) et lecture par l'IA
 * ============================================================================
 * Partagé par l'import dans un devis et l'import au catalogue d'un fournisseur. Glisser-déposer ou parcourir ;
 * la lecture (edge supplier-offer-import, extract) n'écrit rien. `onLue({ offre, controle, modele, conso })`.
 * ============================================================================
 */

import { useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOffreFournisseurMutations } from '@hooks/useOffresFournisseur';

export default function OffreDepot({ orgId, onLue }) {
  const { extraire, isExtracting } = useOffreFournisseurMutations(orgId);
  const inputRef = useRef(null);
  const [survol, setSurvol] = useState(false);
  const [nom, setNom] = useState('');

  const lire = async (file) => {
    if (!file) return;
    setNom(file.name);
    try {
      onLue(await extraire(file));
    } catch (err) {
      toast.error(err?.message || 'Lecture de l\'offre impossible');
      setNom('');
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
      onDragLeave={() => setSurvol(false)}
      onDrop={(e) => { e.preventDefault(); setSurvol(false); if (!isExtracting) lire(e.dataTransfer.files?.[0]); }}
      className={`border-2 border-dashed rounded-xl px-6 py-10 text-center transition-colors ${survol ? 'border-primary-400 bg-primary-50' : 'border-secondary-300 bg-secondary-50/50'}`}
    >
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; lire(f); }} />
      {isExtracting ? (
        <div className="space-y-2 text-secondary-600">
          <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary-600" />
          <p className="text-sm font-medium">Lecture de « {nom} »…</p>
          <p className="text-xs text-secondary-400">L&apos;IA recopie les lignes de l&apos;offre (une vingtaine de secondes).</p>
        </div>
      ) : (
        <div className="space-y-3">
          <FileUp className="w-8 h-8 mx-auto text-secondary-400" />
          <p className="text-sm text-secondary-700">Déposez ici le PDF de l&apos;offre de prix du fournisseur</p>
          <button type="button" onClick={() => inputRef.current?.click()} className="btn-secondary btn-sm">Choisir le fichier</button>
          <p className="text-xs text-secondary-400">Les lignes sont lues puis vérifiées ; rien n&apos;est enregistré avant votre validation.</p>
        </div>
      )}
    </div>
  );
}
