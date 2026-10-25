/**
 * DevisLineRow.jsx — Une ligne de devis (produit, article, main d'œuvre, ligne libre)
 * ============================================================================
 * Désignation (éditable pour une ligne libre ou de main d'œuvre), quantité, P.U. HT, TVA, total TTC, ordre.
 * Une ligne posée depuis un article de stock à plusieurs marques porte un sélecteur de marque : la marque se choisit
 * dans le devis (décision d'Eric, 2026-10-25), le prix d'achat suit la marque (module pur marqueLigne.js).
 * ============================================================================
 */

import { TVA_RATES, computeLineTotals } from '@services/devis.service';
import { formatEuro } from '@/lib/utils';
import { GripVertical, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';

/**
 * @param {{ line: object, index: number, onUpdate: Function, onRemove: Function, onMoveUp: Function, onMoveDown: Function,
 *   isFirst: boolean, isLast: boolean, marques?: Array<{ marque: string, prix: number|null }>, onMarque?: (marque: string) => void }} p
 */
export default function DevisLineRow({ line, index, onUpdate, onRemove, onMoveUp, onMoveDown, isFirst, isLast, marques = [], onMarque }) {
  const setLineField = (field, value) => onUpdate(index, { ...line, [field]: value });
  const lineTotals = computeLineTotals(line);
  const editable = line.is_freeform || line.line_type === 'labor';
  const choixMarque = marques.length >= 2 && onMarque;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 ml-4 border border-secondary-200 rounded-lg">
      <GripVertical className="w-3.5 h-3.5 text-secondary-300 flex-shrink-0" />
      {/* Désignation */}
      <div className="flex-1 min-w-0">
        {editable ? (
          <input
            type="text"
            value={line.designation}
            onChange={(e) => setLineField('designation', e.target.value)}
            placeholder={line.line_type === 'labor' ? 'Main d’œuvre…' : 'Désignation…'}
            className="w-full bg-transparent border-none outline-none text-sm text-secondary-900 placeholder:text-secondary-300"
          />
        ) : (
          <>
            <p className="text-sm text-secondary-900 truncate" title={line.designation}>
              {line.designation || 'Sans désignation'}
            </p>
            {(line.supplier_name || choixMarque) && (
              <div className="flex items-center gap-2 -mt-0.5">
                {choixMarque && (
                  <select
                    value={line.brand || ''}
                    onChange={(e) => onMarque(e.target.value)}
                    className="text-[11px] border border-secondary-200 rounded px-1 py-0 bg-white text-secondary-700"
                    title="Marque posée chez le client (le prix d'achat suit la marque)"
                  >
                    <option value="">Marque au choix</option>
                    {marques.map((m) => (
                      <option key={m.marque} value={m.marque}>{m.marque}{m.prix != null ? ` · achat ${formatEuro(m.prix)}` : ''}</option>
                    ))}
                  </select>
                )}
                {line.supplier_name && (
                  <span className="text-[10px] text-secondary-400 truncate">{line.supplier_name}{line.reference ? ` · ${line.reference}` : ''}</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {/* Qté */}
      <input
        type="number"
        value={line.quantity}
        onChange={(e) => setLineField('quantity', e.target.value)}
        min="0"
        step="1"
        className="w-10 px-1 py-1 border border-secondary-200 rounded text-xs text-center flex-shrink-0 bg-secondary-50"
      />
      {/* P.U. HT */}
      <input
        type="number"
        value={line.unit_price_ht}
        onChange={(e) => setLineField('unit_price_ht', e.target.value)}
        min="0"
        step="0.01"
        className="w-16 px-1 py-1 border border-secondary-200 rounded text-xs text-right flex-shrink-0 bg-secondary-50"
      />
      {/* TVA */}
      <select
        value={line.tva_rate}
        onChange={(e) => setLineField('tva_rate', e.target.value)}
        className="w-14 px-0.5 py-1 border border-secondary-200 rounded text-xs text-center flex-shrink-0 bg-secondary-50"
      >
        {TVA_RATES.map((t) => (
          <option key={t.value} value={t.value}>{t.value}%</option>
        ))}
      </select>
      {/* Total TTC */}
      <span className="w-[4.5rem] text-right text-sm font-semibold text-secondary-900 flex-shrink-0 tabular-nums">
        {formatEuro(lineTotals.total_ttc)}
      </span>
      {/* Actions */}
      <div className="flex gap-0.5 flex-shrink-0">
        <button type="button" onClick={() => onMoveUp(index)} disabled={isFirst} className="p-0.5 hover:bg-secondary-100 rounded disabled:opacity-30">
          <ChevronUp className="w-3 h-3" />
        </button>
        <button type="button" onClick={() => onMoveDown(index)} disabled={isLast} className="p-0.5 hover:bg-secondary-100 rounded disabled:opacity-30">
          <ChevronDown className="w-3 h-3" />
        </button>
        <button type="button" onClick={() => onRemove(index)} className="p-0.5 hover:bg-red-50 rounded">
          <Trash2 className="w-3 h-3 text-red-400" />
        </button>
      </div>
    </div>
  );
}
