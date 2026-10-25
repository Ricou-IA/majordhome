/**
 * DevisStepLines.jsx — Étape 2 du wizard : éditeur de lignes
 * ============================================================================
 * - Chapitres prédéfinis par la famille, chacun typé (équipement, option, stock, main d'œuvre, libre, fumisterie) :
 *   le « Catalogue » du chapitre propose les articles de cette nature (décisions d'Eric, 2026-10-25)
 * - « Ligne libre » dans tout chapitre (petite fourniture au forfait, prestation, main d'œuvre ponctuelle)
 * - TVA du devis : celle de la famille par défaut, changeable d'un geste pour toutes les lignes
 * - Marque d'une ligne de stock choisie dans le devis (prix d'achat de la marque)
 * - Totaux en temps réel
 * ============================================================================
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { computeLineTotals, productCategoriesForSection } from '@services/devis.service';
import { typeChapitre, tvaFamille, TAUX_TVA } from '@/lib/devisConfig.js';
import { marquesDesOffres, appliquerMarque } from '@/lib/catalogue/marqueLigne.js';
import { useCatalogItemOffers } from '@hooks/useCatalogItems';
import DevisProductPicker from './DevisProductPicker';
import DevisLineRow from './DevisLineRow';
import MetreFumisterie from './metre/MetreFumisterie';
import { formatEuro } from '@/lib/utils';
import { Plus, Package, Ruler, PenLine, BookOpen } from 'lucide-react';

const TYPE_LABELS = {
  equipement: 'Équipement', option: 'Options', stock: 'Matériel stocké', main_oeuvre: 'Main d’œuvre', libre: 'Libre', fumisterie: 'Fumisterie',
};

/** Taux le plus fréquent parmi les lignes chiffrées (devis repris, lignes pré-remplies), sinon null. */
function tvaDesLignes(lines) {
  const compte = new Map();
  for (const l of lines) {
    if (l.line_type === 'section_title') continue;
    const t = Number(l.tva_rate);
    if (TAUX_TVA.includes(t)) compte.set(t, (compte.get(t) || 0) + 1);
  }
  let meilleur = null;
  for (const [t, n] of compte) if (meilleur == null || n > compte.get(meilleur)) meilleur = t;
  return meilleur;
}

// =============================================================================
// BLOC CHAPITRE (titre + lignes enfants + boutons d'ajout)
// =============================================================================

function SectionBlock({ sectionIndex, section, type, childLines, onUpdate, onRemove, onMoveUp, onMoveDown, onAddProducts, onAddLabor, onAddFreeform, onMetre, marquesParItem, onMarque }) {
  const productCount = childLines.length;
  const sectionTotalTtc = childLines.reduce((sum, { line }) => sum + (computeLineTotals(line).total_ttc || 0), 0);
  const btn = 'flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors';

  return (
    <div className="border border-secondary-200 rounded-xl overflow-hidden">
      {/* En-tête du chapitre */}
      <div className="flex items-center justify-between px-4 py-3 bg-secondary-50 border-b border-secondary-200">
        <div className="flex items-center gap-2 min-w-0">
          <input
            type="text"
            value={section.designation}
            onChange={(e) => onUpdate(sectionIndex, { ...section, designation: e.target.value })}
            className="bg-transparent border-none outline-none text-sm font-semibold text-secondary-700 uppercase tracking-wider min-w-0"
            placeholder="TITRE DU CHAPITRE"
          />
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-secondary-200 text-secondary-500 whitespace-nowrap" title="Ce que propose le catalogue de ce chapitre">{TYPE_LABELS[type] || type}</span>
        </div>
        <div className="flex items-center gap-3">
          {productCount > 0 && (
            <span className="text-xs text-secondary-500">
              {productCount} ligne{productCount > 1 ? 's' : ''} · {formatEuro(sectionTotalTtc)} TTC
            </span>
          )}
          {type === 'fumisterie' && onMetre && (
            <button type="button" onClick={() => onMetre(sectionIndex)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-secondary-900 bg-primary-400 hover:bg-primary-500 rounded-lg" title="Métré assisté sur coupe cotée"><Ruler className="w-4 h-4" /> Métré assisté</button>
          )}
        </div>
      </div>

      {/* Lignes */}
      {childLines.length > 0 && (
        <div className="p-2 space-y-1">
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
            <DevisLineRow
              key={globalIndex}
              line={line}
              index={globalIndex}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              isFirst={i === 0}
              isLast={i === childLines.length - 1}
              marques={line.catalog_item_id ? (marquesParItem.get(line.catalog_item_id) || []) : []}
              onMarque={(marque) => onMarque(globalIndex, marque)}
            />
          ))}
        </div>
      )}

      {/* Ajouts */}
      <div className="flex flex-wrap gap-2 px-4 py-1.5 bg-secondary-50/50 border-t border-secondary-100">
        <button type="button" onClick={() => onAddProducts(sectionIndex, section.designation, type)} className={`${btn} text-primary-700 bg-primary-50 hover:bg-primary-100 border-primary-200`} title="Ajouter des articles du catalogue">
          <BookOpen className="w-3.5 h-3.5" /> Catalogue
        </button>
        <button
          type="button"
          onClick={() => (type === 'main_oeuvre' ? onAddLabor(sectionIndex) : onAddFreeform(sectionIndex))}
          className={`${btn} text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200`}
          title={type === 'main_oeuvre' ? 'Ajouter une ligne de main d’œuvre saisie à la main' : 'Ajouter une ligne saisie à la main (forfait, petite fourniture)'}
        >
          <PenLine className="w-3.5 h-3.5" /> Ligne libre
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// COMPOSANT PRINCIPAL
// =============================================================================

export default function DevisStepLines({ orgId, lines, setLines, leadId, family, onMetreValidated, devisConfig }) {
  const [pickerForSection, setPickerForSection] = useState(null); // { index, categories, type }
  const [metreForSection, setMetreForSection] = useState(null); // index global de la section FUMISTERIE
  // TVA du devis : celle des lignes déjà chiffrées (devis repris, pré-remplissage), sinon celle de la famille
  const [tvaDevis, setTvaDevis] = useState(() => tvaDesLignes(lines) ?? tvaFamille(devisConfig, family));

  // Changement de famille sur un devis encore vide : la TVA suit la nouvelle famille
  useEffect(() => {
    if (tvaDesLignes(lines) == null) setTvaDevis(tvaFamille(devisConfig, family));
  }, [family, devisConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const changerTvaDevis = useCallback((valeur) => {
    const t = Number(valeur);
    setTvaDevis(t);
    setLines((prev) => prev.map((l) => (l.line_type === 'section_title' ? l : { ...l, tva_rate: t })));
  }, [setLines]);

  // Offres des articles posés (marques des articles de stock)
  const itemIdsKey = useMemo(() => [...new Set(lines.map((l) => l.catalog_item_id).filter(Boolean))].sort().join(','), [lines]);
  const { offers } = useCatalogItemOffers(orgId, itemIdsKey ? itemIdsKey.split(',') : []);
  const offresParItem = useMemo(() => {
    const m = new Map();
    for (const o of offers) { if (!m.has(o.item_id)) m.set(o.item_id, []); m.get(o.item_id).push(o); }
    return m;
  }, [offers]);
  const marquesParItem = useMemo(() => {
    const m = new Map();
    for (const [id, os] of offresParItem) m.set(id, marquesDesOffres(os));
    return m;
  }, [offresParItem]);

  const updateLine = useCallback((index, updatedLine) => {
    setLines((prev) => prev.map((l, i) => (i === index ? updatedLine : l)));
  }, [setLines]);

  const changerMarque = useCallback((index, marque) => {
    setLines((prev) => prev.map((l, i) => (i === index ? appliquerMarque(l, marque, offresParItem.get(l.catalog_item_id) || []) : l)));
  }, [setLines, offresParItem]);

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

  // Structurer les lignes en chapitres
  const sections = useMemo(() => {
    const result = [];
    let currentSection = null;
    lines.forEach((line, globalIndex) => {
      if (line.line_type === 'section_title') {
        currentSection = { sectionIndex: globalIndex, section: line, children: [] };
        result.push(currentSection);
      } else if (currentSection) {
        currentSection.children.push({ line, globalIndex });
      } else if (result.length === 0 || result[result.length - 1].section) {
        currentSection = { sectionIndex: -1, section: null, children: [{ line, globalIndex }] };
        result.push(currentSection);
      } else {
        result[result.length - 1].children.push({ line, globalIndex });
      }
    });
    return result;
  }, [lines]);

  /** Index d'insertion : après le dernier enfant du chapitre (avant le chapitre suivant). */
  const insertionApres = (prev, sectionGlobalIndex) => {
    let insertAt = sectionGlobalIndex + 1;
    for (let i = sectionGlobalIndex + 1; i < prev.length; i++) {
      if (prev[i].line_type === 'section_title') break;
      insertAt = i + 1;
    }
    return insertAt;
  };

  const handleAddProductsToSection = useCallback((sectionGlobalIndex, sectionName, type) => {
    setPickerForSection({ index: sectionGlobalIndex, categories: productCategoriesForSection(sectionName, family, devisConfig), type });
  }, [family, devisConfig]);

  const handlePickerAddLines = useCallback((newLines) => {
    if (!pickerForSection) return;
    const sectionIdx = pickerForSection.index;
    setLines((prev) => {
      const result = [...prev];
      result.splice(insertionApres(prev, sectionIdx), 0, ...newLines);
      return result;
    });
  }, [pickerForSection, setLines]);

  // Métré assisté validé → lignes insérées après le dernier enfant de la section FUMISTERIE
  const handleMetreValidate = useCallback(({ lignesDevis, metre }) => {
    if (metreForSection == null) return;
    const sectionIdx = metreForSection;
    setLines((prev) => {
      const result = [...prev];
      result.splice(insertionApres(prev, sectionIdx), 0, ...lignesDevis);
      return result;
    });
    onMetreValidated?.(metre);
    setMetreForSection(null);
  }, [metreForSection, setLines, onMetreValidated]);

  const ligneVide = (extra) => ({
    catalog_item_id: null, brand: null, supplier_product_id: null, supplier_id: null, supplier_name: null,
    designation: '', description: '', reference: '', quantity: 1, purchase_price_ht: null, unit_price_ht: 0, tva_rate: tvaDevis, ...extra,
  });

  // Ligne de main d'œuvre saisie à la main
  const addLaborToSection = useCallback((sectionGlobalIndex) => {
    setLines((prev) => {
      const result = [...prev];
      result.splice(insertionApres(prev, sectionGlobalIndex), 0, ligneVide({ line_type: 'labor', unit: 'forfait' }));
      return result;
    });
  }, [setLines, tvaDevis]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ligne libre (forfait, petite fourniture, prestation)
  const addFreeformToSection = useCallback((sectionGlobalIndex) => {
    setLines((prev) => {
      const result = [...prev];
      result.splice(insertionApres(prev, sectionGlobalIndex), 0, ligneVide({ line_type: 'product', is_freeform: true, unit: 'u' }));
      return result;
    });
  }, [setLines, tvaDevis]); // eslint-disable-line react-hooks/exhaustive-deps

  const addSection = useCallback(() => {
    setLines((prev) => [...prev, { line_type: 'section_title', designation: '', quantity: 0, unit_price_ht: 0, tva_rate: 0 }]);
  }, [setLines]);

  const hasSections = lines.some((l) => l.line_type === 'section_title');

  return (
    <div className="space-y-4">
      {/* TVA du devis */}
      {hasSections && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-secondary-700">
          <label htmlFor="tva-devis" className="font-medium">TVA du devis</label>
          <select id="tva-devis" value={tvaDevis} onChange={(e) => changerTvaDevis(e.target.value)} className="border border-secondary-300 rounded-lg px-2 py-1 text-sm">
            {TAUX_TVA.map((t) => <option key={t} value={t}>{String(t).replace('.', ',')} %</option>)}
          </select>
          <span className="text-xs text-secondary-400">Taux de la famille par défaut ; le changer l&apos;applique à toutes les lignes (chaque ligne reste modifiable).</span>
        </div>
      )}

      {hasSections ? (
        <div className="space-y-3">
          {sections.map((sec) => {
            if (!sec.section) {
              return sec.children.map(({ line, globalIndex }, i) => (
                <DevisLineRow
                  key={globalIndex}
                  line={line}
                  index={globalIndex}
                  onUpdate={updateLine}
                  onRemove={removeLine}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  isFirst={i === 0}
                  isLast={i === sec.children.length - 1}
                  marques={line.catalog_item_id ? (marquesParItem.get(line.catalog_item_id) || []) : []}
                  onMarque={(marque) => changerMarque(globalIndex, marque)}
                />
              ));
            }
            return (
              <SectionBlock
                key={sec.sectionIndex}
                sectionIndex={sec.sectionIndex}
                section={sec.section}
                type={typeChapitre(devisConfig, family, sec.section.designation)}
                childLines={sec.children}
                onUpdate={updateLine}
                onRemove={removeLine}
                onMoveUp={moveUp}
                onMoveDown={moveDown}
                onAddProducts={handleAddProductsToSection}
                onAddLabor={addLaborToSection}
                onAddFreeform={addFreeformToSection}
                onMetre={setMetreForSection}
                marquesParItem={marquesParItem}
                onMarque={changerMarque}
              />
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8 text-secondary-500 text-sm">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
          Choisissez une installation ci-dessus pour créer les chapitres du devis
        </div>
      )}

      <button type="button" onClick={addSection} className="btn-secondary btn-sm w-full">
        <Plus className="w-3.5 h-3.5 mr-1" /> Ajouter un chapitre
      </button>

      {pickerForSection && (
        <DevisProductPicker
          orgId={orgId}
          categories={pickerForSection.categories || []}
          typeChapitre={pickerForSection.type}
          tvaDevis={tvaDevis}
          onAddLines={handlePickerAddLines}
          onClose={() => setPickerForSection(null)}
        />
      )}

      {metreForSection != null && (
        <MetreFumisterie
          orgId={orgId}
          leadId={leadId}
          family={family}
          onClose={() => setMetreForSection(null)}
          onValidate={handleMetreValidate}
        />
      )}
    </div>
  );
}
