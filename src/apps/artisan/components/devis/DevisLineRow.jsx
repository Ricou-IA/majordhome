/**
 * DevisLineRow.jsx — Une ligne de devis (produit, article, main d'œuvre, ligne libre)
 * ============================================================================
 * Désignation (éditable pour une ligne libre ou de main d'œuvre), quantité, P.U. HT, remise %, TVA, total TTC.
 * Poignée (six points) = glisser-déposer (la ligne se déplace dans son chapitre ou vers un autre, DevisStepLines).
 * Ligne libre sans article : bouton « créer l'article » (org_admin) qui la range dans la base d'articles.
 * Une ligne posée depuis un article de stock à plusieurs marques porte un sélecteur de marque : la marque se choisit
 * dans le devis (décision d'Eric, 2026-10-25), le prix d'achat suit la marque (module pur marqueLigne.js).
 * Description libre imprimée sous la ligne ; pour une ligne reliée à un article, coche « Caractéristiques » (nombre de
 * lignes fournies par le parent) : les lignes de texte sont figées à l'enregistrement du devis (CreateDevisModal).
 * Crayon « Éditer l'article » (parent : `onEditerArticle`) : ouvre la fiche de l'article, la ligne se réaligne à la fermeture.
 * ============================================================================
 */

import { useState } from 'react';
import { TVA_RATES, computeLineTotals } from '@services/devis.service';
import { formatEuro } from '@/lib/utils';
import { GripVertical, Trash2, BookmarkPlus, Loader2, AlignLeft, Pencil } from 'lucide-react';

/**
 * @param {{ line: object, index: number, onUpdate: Function, onRemove: Function, poignee?: object,
 *   marques?: Array<{ marque: string, prix: number|null }>, onMarque?: (marque: string) => void,
 *   onCreerArticle?: () => void, creationEnCours?: boolean, nbCaracteristiques?: number, onEditerArticle?: () => void }} p
 */
export default function DevisLineRow({ line, index, onUpdate, onRemove, poignee, marques = [], onMarque, onCreerArticle, creationEnCours = false, nbCaracteristiques = 0, onEditerArticle }) {
  const [descriptionOuverte, setDescriptionOuverte] = useState(false);
  const setLineField = (field, value) => onUpdate(index, { ...line, [field]: value });
  const lineTotals = computeLineTotals(line);
  const editable = line.is_freeform || line.line_type === 'labor';
  const choixMarque = marques.length >= 2 && onMarque;
  const afficherDescription = descriptionOuverte || !!line.description;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 ml-4 border border-secondary-200 rounded-lg bg-white">
      <span {...(poignee || {})} className="flex-shrink-0 cursor-grab active:cursor-grabbing text-secondary-300 hover:text-secondary-500" title="Glisser pour déplacer la ligne">
        <GripVertical className="w-3.5 h-3.5" />
      </span>
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
        {afficherDescription && (
          <textarea
            rows={2}
            value={line.description || ''}
            onChange={(e) => setLineField('description', e.target.value)}
            placeholder="Description imprimée sous la ligne…"
            className="w-full mt-1 text-xs border border-secondary-200 rounded px-2 py-1"
          />
        )}
        {line.catalog_item_id && (
          <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-secondary-500">
            <label className={`flex items-center gap-1 cursor-pointer ${nbCaracteristiques === 0 ? 'opacity-50' : ''}`} title={nbCaracteristiques === 0 ? 'Aucune caractéristique renseignée sur l’article' : 'Imprimer les caractéristiques de l’article sous la ligne'}>
              <input type="checkbox" checked={line.show_specs === true} onChange={(e) => setLineField('show_specs', e.target.checked)} className="rounded border-secondary-300" />
              {nbCaracteristiques} caract.
            </label>
            {onEditerArticle && (
              <button type="button" onClick={onEditerArticle} className="p-0.5 hover:bg-secondary-100 rounded" title="Éditer l’article (libellé, prix de vente, caractéristiques)" aria-label="Éditer l’article">
                <Pencil className="w-3 h-3" />
              </button>
            )}
          </div>
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
      {/* Remise de ligne (%) */}
      <input
        type="number"
        value={line.discount_percent ?? ''}
        onChange={(e) => setLineField('discount_percent', e.target.value)}
        min="0"
        max="100"
        step="1"
        placeholder="0"
        title="Remise sur cette ligne, en %"
        className="w-12 px-1 py-1 border border-secondary-200 rounded text-xs text-right flex-shrink-0 bg-secondary-50"
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
      <div className="flex gap-0.5 flex-shrink-0 w-[64px] justify-end">
        {!afficherDescription && (
          <button type="button" onClick={() => setDescriptionOuverte(true)} className="p-0.5 hover:bg-secondary-100 rounded" title="Ajouter une description imprimée sous la ligne">
            <AlignLeft className="w-3 h-3 text-secondary-400" />
          </button>
        )}
        {onCreerArticle && (
          <button type="button" onClick={onCreerArticle} disabled={creationEnCours} className="p-0.5 hover:bg-primary-50 rounded disabled:opacity-40" title="Créer l'article dans la base (ligne libre)">
            {creationEnCours ? <Loader2 className="w-3 h-3 animate-spin text-primary-600" /> : <BookmarkPlus className="w-3 h-3 text-primary-600" />}
          </button>
        )}
        <button type="button" onClick={() => onRemove(index)} className="p-0.5 hover:bg-red-50 rounded" title="Retirer la ligne">
          <Trash2 className="w-3 h-3 text-red-400" />
        </button>
      </div>
    </div>
  );
}
