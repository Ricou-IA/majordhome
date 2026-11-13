/**
 * PiecesSelectionActions.jsx — Boutons sous la liste des pièces d'une carte équipement (fiche client)
 * ============================================================================
 * « Mettre sur la demande SAV » (droit clients.edit, technicien compris) et « Créer un devis SAV » (devis.create +
 * sav.create), chacun affiché seulement si l'appelant fournit son geste. Désactivés tant qu'aucune pièce n'est
 * choisie. Les droits se décident chez l'appelant (src/lib/savCloture.js), pas ici.
 * ============================================================================
 */

import { ClipboardList, ShoppingCart } from 'lucide-react';

/**
 * @param {object} p
 * @param {Array<{ ligne: object, quantite: number }>} p.choix pièces choisies
 * @param {(choix: Array<{ ligne: object, quantite: number }>) => void} [p.onRanger] « Mettre sur la demande SAV »
 * @param {(choix: Array<{ ligne: object, quantite: number }>) => void} [p.onDevis] « Créer un devis SAV »
 */
export default function PiecesSelectionActions({ choix, onRanger, onDevis }) {
  const vide = !choix?.length;
  return (
    <>
      {vide && <span className="text-xs text-secondary-500">Choisissez les pièces avec +</span>}
      {onDevis && (
        <button type="button" onClick={() => onDevis(choix)} disabled={vide} className="btn-secondary btn-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          <ShoppingCart className="w-4 h-4" />Créer un devis SAV
        </button>
      )}
      {onRanger && (
        <button type="button" onClick={() => onRanger(choix)} disabled={vide} className="btn-primary btn-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          <ClipboardList className="w-4 h-4" />Mettre sur la demande SAV
        </button>
      )}
    </>
  );
}
