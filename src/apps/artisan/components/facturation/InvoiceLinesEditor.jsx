// ============================================================================
// Édition à la main des lignes d'une facture d'entretien AVANT envoi (modale « Facturer »).
// Eric, 2026-09-23 : « on paramètre 99 % des cas et on garde la main sur les edge cases ».
// Présentationnel : `lines` = lineEditsFromModel(...) ; chaque saisie remonte la liste
// complète via onChange. Le recalcul (montants, TVA, total, erreurs) est fait par
// applyLineEdits dans le parent — ce composant ne calcule rien.
// ============================================================================
import { Trash2, Plus } from 'lucide-react';
import { VAT_CODES, newFreeLine } from '@/lib/entretienInvoiceModel';

const VAT_OPTIONS = Object.keys(VAT_CODES).map(Number).sort((a, b) => b - a);
const CELL = 'w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500';

/**
 * @param {object} p
 * @param {Array} p.lines   lignes éditables (`lineEditsFromModel`)
 * @param {(lines: Array) => void} p.onChange
 * @param {object|null} p.model  modèle d'origine (pour `newFreeLine`)
 */
export default function InvoiceLinesEditor({ lines, onChange, model }) {
  const patch = (i, p) => onChange(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const remove = (i) => onChange(lines.filter((_, j) => j !== i));
  const add = () => onChange([...lines, newFreeLine(model)]);
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 border-b border-gray-200">
            <th className="text-left font-medium py-1">Libellé / description</th>
            <th className="text-right font-medium py-1 w-20">Qté</th>
            <th className="text-right font-medium py-1 w-32">PU HT</th>
            <th className="text-right font-medium py-1 w-24">TVA</th>
            <th className="text-right font-medium py-1 w-20">Rem. %</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-gray-100 align-top">
              <td className="py-1 pr-1 space-y-1">
                <input type="text" value={l.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Libellé" className={CELL} />
                <input type="text" value={l.description || ''} onChange={(e) => patch(i, { description: e.target.value })} placeholder="Description (facultatif)" className={`${CELL} text-gray-600`} />
              </td>
              <td className="py-1 px-0.5"><input type="number" min="0" step="0.01" value={l.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} className={`${CELL} text-right`} /></td>
              <td className="py-1 px-0.5"><input type="number" min="0" step="0.01" value={l.unitPriceHt} onChange={(e) => patch(i, { unitPriceHt: e.target.value })} className={`${CELL} text-right`} /></td>
              <td className="py-1 px-0.5">
                <select value={String(l.vatPercent)} onChange={(e) => patch(i, { vatPercent: Number(e.target.value) })} className={CELL}>
                  {VAT_OPTIONS.map((v) => <option key={v} value={String(v)}>{String(v).replace('.', ',')} %</option>)}
                </select>
              </td>
              <td className="py-1 px-0.5"><input type="number" min="0" max="100" step="1" value={l.discountPercent} onChange={(e) => patch(i, { discountPercent: e.target.value })} className={`${CELL} text-right`} /></td>
              <td className="py-1 text-right">
                <button type="button" onClick={() => remove(i)} title="Supprimer la ligne" className="text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={add} className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
        <Plus className="w-3.5 h-3.5" /> Ajouter une ligne
      </button>
    </div>
  );
}
