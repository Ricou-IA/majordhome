/**
 * MarqueReference.jsx — propose l'écriture de référence de la marque saisie (« jollymec » → « JOLLY MEC »).
 * Un clic l'accepte ; rien n'est réécrit d'office. Règle : marqueDeReference (src/lib/equipements/saisieAppareil.js).
 */

import { Check } from 'lucide-react';
import { marqueDeReference } from '@/lib/equipements/saisieAppareil';

/**
 * @param {{ saisie: string, marques: Array<{ name: string, brand_key: string }>, onAccept: (name: string) => void }} p
 */
export default function MarqueReference({ saisie, marques, onAccept }) {
  const ref = marqueDeReference(saisie, marques);
  if (!ref || ref.name === String(saisie || '').trim()) return null;
  return (
    <button
      type="button"
      onClick={() => onAccept(ref.name)}
      className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-indigo-700 hover:text-indigo-900"
    >
      <Check className="w-3.5 h-3.5" />
      {ref.exacte ? <>Écrire « {ref.name} »</> : <>Vouliez-vous dire « {ref.name} » ?</>}
    </button>
  );
}
