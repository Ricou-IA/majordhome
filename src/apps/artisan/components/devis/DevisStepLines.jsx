/**
 * DevisStepLines.jsx — Étape 2 du wizard : éditeur de lignes
 * ============================================================================
 * - Sections prédéfinies (depuis la famille) affichées comme blocs cliquables
 * - Clic sur section → ouvre le picker produit, produits insérés dans la section
 * - Ajout ligne main d'œuvre libre dans chaque section
 * - Modification quantité, prix, TVA par ligne
 * - Totaux en temps réel
 * ============================================================================
 */

import { useState, useCallback, useMemo } from 'react';
import { TVA_RATES, computeLineTotals, computeQuoteTotals } from '@services/devis.service';
import DevisProductPicker from './DevisProductPicker';
import DevisTvaSummary from './DevisTvaSummary';
import { formatEuro } from '@/lib/utils';
import {
  Plus, Trash2, GripVertical, ChevronUp, ChevronDown,
  Wrench, Type, Package, ChevronRight,
} from 'lucide-react';

// =============================================================================
// LIGNE PRODUIT / MAIN D'ŒUVRE
// =============================================================================

function LineRow({ line, index, onUpdate, onRemove, onMoveUp, onMoveDown, isFirst, isLast }) {
  const setLineField = (field, value) => {
    onUpdate(index, { ...line, [field]: value });
  };

  const lineTotals = computeLineTotals(line);

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 ml-4 border border-secondary-200 rounded-lg">
      <GripVertical className="w-3.5 h-3.5 text-secondary-300 flex-shrink-0" />
      {/* Désignation */}
      <div className="flex-1 min-w-0">
        {line.is_freeform || line.line_type === 'labor' ? (
          <input
            type="text"
            value={line.designation}
            onChange={(e) => setLineField('designation', e.target.value)}
            placeholder="Désignation..."
            className="w-full bg-transparent border-none outline-none text-sm text-secondary-900 placeholder:text-secondary-300"
          />
        ) : (
          <>
            <p className="text-sm text-secondary-900 truncate" title={line.designation}>
              {line.designation || 'Sans désignation'}
            </p>
            {line.supplier_name && (
              <p className="text-[10px] text-secondary-400 truncate -mt-0.5">
                {line.supplier_name}{line.reference ? ` · ${line.reference}` : ''}
              </p>
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
      {/* TVA (hidden select, juste l'affichage) */}
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

// =============================================================================
// BLOC SECTION (titre + lignes enfants + boutons d'ajout)
// =============================================================================

function SectionBlock({ sectionIndex, section, childLines, onUpdate, onRemove, onMoveUp, onMoveDown, onAddProducts, onAddLabor, onAddFreeform }) {
  const productCount = childLines.length;
  const sectionTotalTtc = childLines.reduce((sum, { line }) => {
    const t = computeLineTotals(line);
    return sum + (t.total_ttc || 0);
  }, 0);

  // Section MAIN D'ŒUVRE → seulement bouton main d'œuvre
  const isLaborSection = /main\s*d[''\u2019]?\s*[oœ]/i.test(section.designation);
  // Section AUTRE / PRESTATIONS → saisie libre
  const isFreeformSection = /^(autre|prestations?)$/i.test(section.designation.trim());

  return (
    <div className="border border-secondary-200 rounded-xl overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3 bg-secondary-50 border-b border-secondary-200">
        <input
          type="text"
          value={section.designation}
          onChange={(e) => onUpdate(sectionIndex, { ...section, designation: e.target.value })}
          className="bg-transparent border-none outline-none text-sm font-semibold text-secondary-700 uppercase tracking-wider"
          placeholder="TITRE DE SECTION"
        />
        <div className="flex items-center gap-3">
          {productCount > 0 && (
            <span className="text-xs text-secondary-500">
              {productCount} article{productCount > 1 ? 's' : ''} · {formatEuro(sectionTotalTtc)} TTC
            </span>
          )}
        </div>
      </div>

      {/* Child lines */}
      {childLines.length > 0 && (
        <div className="p-2 space-y-1">
          {/* En-têtes colonnes */}
          <div className="flex items-center gap-1.5 px-3 ml-4 text-[10px] font-medium text-secondary-400 uppercase tracking-wider">
            <span className="w-3.5 flex-shrink-0" />
            <span className="flex-1">Désignation</span>
            <span className="w-10 text-center flex-shrink-0">Qté</span>
            <span className="w-16 text-right flex-shrink-0">P.U. HT</span>
            <span className="w-14 text-center flex-shrink-0">TVA</span>
            <span className="w-[4.5rem] text-right flex-shrink-0">Total TTC</span>
            <span className="w-[52px] flex-shrink-0" />
          </div>
          {childLines.map(({ line, globalIndex }, i) => (
            <LineRow
              key={globalIndex}
              line={line}
              index={globalIndex}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              isFirst={i === 0}
              isLast={i === childLines.length - 1}
            />
          ))}
        </div>
      )}

      {/* Action button inside section */}
      <div className="flex gap-2 px-4 py-1.5 bg-secondary-50/50 border-t border-secondary-100">
        {isLaborSection ? (
          <button
            type="button"
            onClick={() => onAddLabor(sectionIndex)}
            className="flex items-center justify-center w-6 h-6 text-secondary-500 bg-white hover:bg-secondary-100 rounded-full border border-secondary-200 transition-colors"
            title="Ajouter main d'œuvre"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        ) : isFreeformSection ? (
          <button
            type="button"
            onClick={() => onAddFreeform(sectionIndex)}
            className="flex items-center justify-center w-6 h-6 text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-full border border-amber-200 transition-colors"
            title="Ajouter une ligne libre"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onAddProducts(sectionIndex, section.designation)}
            className="flex items-center justify-center w-6 h-6 text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-full border border-primary-200 transition-colors"
            title="Ajouter des produits"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// COMPOSANT PRINCIPAL
// =============================================================================

export default function DevisStepLines({ orgId, lines, setLines, globalDiscountPercent }) {
  const [pickerForSection, setPickerForSection] = useState(null); // { index, category }
  const pickerCategory = pickerForSection?.category || null;

  const updateLine = useCallback((index, updatedLine) => {
    setLines((prev) => prev.map((l, i) => (i === index ? updatedLine : l)));
  }, [setLines]);

  const removeLine = useCallback((index) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }, [setLines]);

  const moveUp = useCallback((index) => {
    if (index === 0) return;
    setLines((prev) => {
      const arr = [...prev];
      [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
      return arr;
    });
  }, [setLines]);

  const moveDown = useCallback((index) => {
    setLines((prev) => {
      if (index >= prev.length - 1) return prev;
      const arr = [...prev];
      [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
      return arr;
    });
  }, [setLines]);

  // Structurer les lignes en sections
  const sections = useMemo(() => {
    const result = [];
    let currentSection = null;

    lines.forEach((line, globalIndex) => {
      if (line.line_type === 'section_title') {
        currentSection = {
          sectionIndex: globalIndex,
          section: line,
          children: [],
        };
        result.push(currentSection);
      } else if (currentSection) {
        currentSection.children.push({ line, globalIndex });
      } else {
        // Ligne orpheline (sans section) → créer une section implicite
        if (result.length === 0 || result[result.length - 1].section) {
          currentSection = {
            sectionIndex: -1,
            section: null,
            children: [{ line, globalIndex }],
          };
          result.push(currentSection);
        } else {
          result[result.length - 1].children.push({ line, globalIndex });
        }
      }
    });

    return result;
  }, [lines]);

  // Ajouter des produits après la section (avant la section suivante)
  const handleAddProductsToSection = useCallback((sectionGlobalIndex, sectionName) => {
    setPickerForSection({ index: sectionGlobalIndex, category: sectionName });
  }, []);

  const handlePickerAddLines = useCallback((newLines, _sectionTitle) => {
    if (!pickerForSection) return;
    const sectionIdx = pickerForSection.index;
    setLines((prev) => {
      // Trouver l'index d'insertion : après le dernier enfant de cette section
      let insertAt = sectionIdx + 1;
      for (let i = sectionIdx + 1; i < prev.length; i++) {
        if (prev[i].line_type === 'section_title') break;
        insertAt = i + 1;
      }
      const result = [...prev];
      result.splice(insertAt, 0, ...newLines);
      return result;
    });
  }, [pickerForSection, setLines]);

  // Ajouter une ligne main d'œuvre dans une section
  const addLaborToSection = useCallback((sectionGlobalIndex) => {
    setLines((prev) => {
      let insertAt = sectionGlobalIndex + 1;
      for (let i = sectionGlobalIndex + 1; i < prev.length; i++) {
        if (prev[i].line_type === 'section_title') break;
        insertAt = i + 1;
      }
      const result = [...prev];
      result.splice(insertAt, 0, {
        line_type: 'labor',
        supplier_product_id: null,
        supplier_id: null,
        supplier_name: null,
        designation: '',
        description: '',
        reference: '',
        quantity: 1,
        unit: 'forfait',
        purchase_price_ht: null,
        unit_price_ht: 0,
        tva_rate: 5.5,
      });
      return result;
    });
  }, [setLines]);

  // Ajouter une ligne libre (saisie manuelle — section "AUTRE" ou "PRESTATIONS")
  const addFreeformToSection = useCallback((sectionGlobalIndex) => {
    setLines((prev) => {
      let insertAt = sectionGlobalIndex + 1;
      for (let i = sectionGlobalIndex + 1; i < prev.length; i++) {
        if (prev[i].line_type === 'section_title') break;
        insertAt = i + 1;
      }
      const result = [...prev];
      result.splice(insertAt, 0, {
        line_type: 'product',
        is_freeform: true,
        supplier_product_id: null,
        supplier_id: null,
        supplier_name: null,
        designation: '',
        description: '',
        reference: '',
        quantity: 1,
        unit: 'u',
        purchase_price_ht: null,
        unit_price_ht: 0,
        tva_rate: 5.5,
      });
      return result;
    });
  }, [setLines]);

  // Ajouter une nouvelle section
  const addSection = useCallback(() => {
    setLines((prev) => [...prev, {
      line_type: 'section_title',
      designation: '',
      quantity: 0,
      unit_price_ht: 0,
      tva_rate: 0,
    }]);
  }, [setLines]);

  const totals = computeQuoteTotals(lines, globalDiscountPercent);

  // Vérifier si on a des sections
  const hasSections = lines.some((l) => l.line_type === 'section_title');

  return (
    <div className="space-y-4">
      {/* Sections list */}
      {hasSections ? (
        <div className="space-y-3">
          {sections.map((sec) => {
            if (!sec.section) {
              // Lignes orphelines
              return sec.children.map(({ line, globalIndex }, i) => (
                <LineRow
                  key={globalIndex}
                  line={line}
                  index={globalIndex}
                  onUpdate={updateLine}
                  onRemove={removeLine}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  isFirst={i === 0}
                  isLast={i === sec.children.length - 1}
                />
              ));
            }
            return (
              <SectionBlock
                key={sec.sectionIndex}
                sectionIndex={sec.sectionIndex}
                section={sec.section}
                childLines={sec.children}
                onUpdate={updateLine}
                onRemove={removeLine}
                onMoveUp={moveUp}
                onMoveDown={moveDown}
                onAddProducts={handleAddProductsToSection}
                onAddLabor={addLaborToSection}
                onAddFreeform={addFreeformToSection}
              />
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8 text-secondary-500 text-sm">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
          Sélectionnez une famille à l'étape précédente pour commencer
        </div>
      )}

      {/* Add section button */}
      <button type="button" onClick={addSection} className="btn-secondary btn-sm w-full">
        <Plus className="w-3.5 h-3.5 mr-1" /> Ajouter une section
      </button>

      {/* Totals */}
      {lines.filter((l) => l.line_type !== 'section_title').length > 0 && (
        <DevisTvaSummary totals={totals} globalDiscountPercent={globalDiscountPercent} />
      )}

      {/* Product picker modal */}
      {pickerForSection && (
        <DevisProductPicker
          orgId={orgId}
          category={pickerCategory}
          onAddLines={handlePickerAddLines}
          onClose={() => setPickerForSection(null)}
        />
      )}
    </div>
  );
}
