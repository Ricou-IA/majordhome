/**
 * PiecesIdentifieesListe.jsx — Pièces identifiées enregistrées sur la fiche SAV
 * ============================================================================
 * Liste lue au bureau en tête du bloc « Pièces détachées » : appareil (si le client en a plusieurs), référence,
 * désignation, quantité, prix public HT, « par Prénom, le jj/mm ». + / − / retrait si `peutModifier` ; l'action de
 * devis est fournie par l'appelant. Le composant ne calcule rien (règles : src/lib/catalogue/piecesIdentifiees.js).
 * ============================================================================
 */

import { ClipboardList, Minus, Plus, X } from 'lucide-react';
import { formatEuro } from '@/lib/utils';
import { mentionIdentification } from '@/lib/catalogue/piecesIdentifiees';

/**
 * @param {object} p
 * @param {object[]} p.selections pièces identifiées (lignes de majordhome_sav_part_selections)
 * @param {(equipmentId: string) => string|null} [p.nomAppareil] libellé de l'appareil, affiché s'il est fourni
 * @param {object[]} [p.membres] équipe (user_id, first_name) pour l'auteur
 * @param {boolean} [p.peutModifier] + / − / retrait
 * @param {(selection: object, quantite: number) => void} [p.onQuantite]
 * @param {import('react').ReactNode} [p.action] bouton de devis
 * @param {unknown} [p.erreur] échec du chargement de la liste
 */
export default function PiecesIdentifieesListe({ selections = [], nomAppareil = null, membres = [], peutModifier = false, onQuantite, action = null, erreur = null }) {
  if (erreur) {
    return (
      <p className="text-sm text-red-700 bg-red-50 rounded px-2 py-1.5">
        Les pièces identifiées n&apos;ont pas pu être chargées. Rouvrez la fiche avant de modifier les quantités.
      </p>
    );
  }
  if (!selections.length) return null;

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
          <ClipboardList className="w-4 h-4 text-indigo-600" />
          Pièces identifiées ({selections.length})
        </h4>
        {action}
      </div>
      <ul className="divide-y divide-indigo-100">
        {selections.map((s) => {
          const q = Number(s.quantity) || 0;
          const appareil = nomAppareil ? nomAppareil(s.equipment_id) : null;
          return (
            <li key={s.id || `${s.equipment_id}-${s.piece_reference}-${s.repere}`} className="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <div className="min-w-0 flex-1">
                {appareil && <p className="text-[11px] text-gray-500 truncate">{appareil}</p>}
                <p className="text-gray-900">
                  <span className="font-mono text-xs text-gray-600">{s.piece_reference}</span>
                  {s.repere ? <span className="text-xs text-gray-500"> · repère {s.repere}</span> : null}
                  <span> — {s.piece_name || 'Pièce détachée'}</span>
                </p>
                <p className="text-[11px] text-gray-500">{mentionIdentification(s, membres)}</p>
              </div>
              <span className="text-xs text-gray-600 whitespace-nowrap">
                {s.public_price_ht != null ? `${formatEuro(s.public_price_ht)} HT (prix public)` : 'Prix à chiffrer'}
              </span>
              {peutModifier ? (
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onQuantite?.(s, q - 1)} aria-label={`Diminuer ${s.piece_reference}`} className="w-6 h-6 rounded-full border border-gray-300 bg-white flex items-center justify-center hover:bg-gray-100"><Minus className="w-3 h-3" /></button>
                  <span className="w-6 text-center font-semibold tabular-nums" aria-label="Quantité">{q}</span>
                  <button type="button" onClick={() => onQuantite?.(s, q + 1)} aria-label={`Augmenter ${s.piece_reference}`} className="w-6 h-6 rounded-full border border-gray-300 bg-white flex items-center justify-center hover:bg-gray-100"><Plus className="w-3 h-3" /></button>
                  <button type="button" onClick={() => onQuantite?.(s, 0)} aria-label={`Retirer ${s.piece_reference}`} title="Retirer" className="ml-1 w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50"><X className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <span className="text-sm font-semibold tabular-nums whitespace-nowrap">× {q}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
