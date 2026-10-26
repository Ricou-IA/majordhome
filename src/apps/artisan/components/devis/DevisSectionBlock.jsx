/**
 * DevisSectionBlock.jsx — Chapitre du devis (titre, lignes enfants, boutons d’ajout) et liste de lignes déplaçables
 * ============================================================================
 * Extrait de DevisStepLines (taille). Présentationnel : aucune logique métier, tout vient du parent.
 * Une ligne reliée à un article porte le crayon « Éditer l’article » quand le parent fournit `onEditerArticle(itemId)`.
 * ============================================================================
 */

import { computeLineTotals } from '@services/devis.service';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import DevisLineRow from './DevisLineRow';
import { formatEuro } from '@/lib/utils';
import { Ruler, PenLine, BookOpen, GripVertical } from 'lucide-react';

const TYPE_LABELS = {
  equipement: 'Équipement', option: 'Options', stock: 'Matériel stocké', main_oeuvre: 'Main d’œuvre', libre: 'Libre', fumisterie: 'Fumisterie',
};

// =============================================================================
// BLOC CHAPITRE (titre + lignes enfants + boutons d'ajout)
// =============================================================================

export function SectionBlock({ blocIndex, sectionIndex, section, type, childLines, poigneeChapitre, onUpdate, onRemove, onAddProducts, onAddLabor, onAddFreeform, onMetre, marquesParItem, nbParItem, onMarque, onCreerArticle, creationIndex, onEditerArticle }) {
  const productCount = childLines.length;
  const sectionTotalTtc = childLines.reduce((sum, { line }) => sum + (computeLineTotals(line).total_ttc || 0), 0);
  const btn = 'flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors';

  return (
    <div className="border border-secondary-200 rounded-xl overflow-hidden bg-white">
      {/* En-tête du chapitre : la poignée déplace le chapitre avec ses lignes */}
      <div className="flex items-center justify-between px-4 py-3 bg-secondary-50 border-b border-secondary-200">
        <div className="flex items-center gap-2 min-w-0">
          {poigneeChapitre && (
            <span {...poigneeChapitre} className="flex-shrink-0 cursor-grab active:cursor-grabbing text-secondary-300 hover:text-secondary-500" title="Glisser pour déplacer le chapitre">
              <GripVertical className="w-4 h-4" />
            </span>
          )}
          <input
            type="text"
            value={section.designation}
            onChange={(e) => onUpdate(sectionIndex, { ...section, designation: e.target.value })}
            className="bg-transparent border-none outline-none text-sm font-semibold text-secondary-700 uppercase tracking-wider min-w-0"
            placeholder="TITRE DU CHAPITRE"
          />
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-secondary-200 text-secondary-500 whitespace-nowrap" title="Ce que propose le catalogue de ce chapitre">{TYPE_LABELS[type] || type}</span>
          <label className="flex items-center gap-1.5 text-xs text-secondary-600 whitespace-nowrap cursor-pointer" title="Décochée : le document liste les lignes sans prix unitaire ni total, le sous-total du chapitre reste">
            <input
              type="checkbox"
              checked={section.hide_prices !== true}
              onChange={(e) => onUpdate(sectionIndex, { ...section, hide_prices: !e.target.checked })}
              className="rounded border-secondary-300"
            />
            Afficher le détail des prix
          </label>
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

      {/* Lignes : zone de dépôt toujours présente (on peut glisser une ligne dans un chapitre vide) */}
      <div className="p-2 space-y-1">
        {childLines.length > 0 && <EnTeteLignes />}
        <ListeLignes droppableId={`bloc-${blocIndex}`} childLines={childLines} type={type} onUpdate={onUpdate} onRemove={onRemove}
          marquesParItem={marquesParItem} nbParItem={nbParItem} onMarque={onMarque} onCreerArticle={onCreerArticle} creationIndex={creationIndex} onEditerArticle={onEditerArticle} />
      </div>

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

function EnTeteLignes() {
  return (
    <div className="flex items-center gap-1.5 px-3 ml-4 text-[10px] font-medium text-secondary-400 uppercase tracking-wider">
      <span className="w-3.5 flex-shrink-0" />
      <span className="flex-1">Désignation</span>
      <span className="w-10 text-center flex-shrink-0">Qté</span>
      <span className="w-16 text-right flex-shrink-0">P.U. HT</span>
      <span className="w-12 text-right flex-shrink-0">Rem. %</span>
      <span className="w-14 text-center flex-shrink-0">TVA</span>
      <span className="w-[4.5rem] text-right flex-shrink-0">Total TTC</span>
      <span className="w-[64px] flex-shrink-0" />
    </div>
  );
}

/** Lignes d'un bloc, déplaçables à la poignée (dans le bloc ou vers un autre bloc). */
export function ListeLignes({ droppableId, childLines, type, onUpdate, onRemove, marquesParItem, nbParItem, onMarque, onCreerArticle, creationIndex, onEditerArticle }) {
  return (
    <Droppable droppableId={droppableId} type="LIGNE">
      {(drop, etat) => (
        <div ref={drop.innerRef} {...drop.droppableProps} className={`space-y-1 rounded-lg ${childLines.length === 0 ? 'min-h-[8px]' : ''} ${etat.isDraggingOver ? 'bg-primary-50/60' : ''}`}>
          {childLines.map(({ line, globalIndex }, i) => (
            <Draggable key={`ligne-${globalIndex}`} draggableId={`ligne-${globalIndex}`} index={i}>
              {(drag) => (
                <div ref={drag.innerRef} {...drag.draggableProps}>
                  <DevisLineRow
                    line={line}
                    index={globalIndex}
                    poignee={drag.dragHandleProps}
                    onUpdate={onUpdate}
                    onRemove={onRemove}
                    marques={line.catalog_item_id ? (marquesParItem.get(line.catalog_item_id) || []) : []}
                    onMarque={(marque) => onMarque(globalIndex, marque)}
                    onCreerArticle={onCreerArticle && (line.is_freeform || line.line_type === 'labor') && !line.catalog_item_id && String(line.designation || '').trim()
                      ? () => onCreerArticle(globalIndex, type) : undefined}
                    creationEnCours={creationIndex === globalIndex}
                    nbCaracteristiques={line.catalog_item_id ? (nbParItem.get(line.catalog_item_id) || 0) : 0}
                    onEditerArticle={line.catalog_item_id && onEditerArticle ? () => onEditerArticle(line.catalog_item_id) : undefined}
                  />
                </div>
              )}
            </Draggable>
          ))}
          {drop.placeholder}
        </div>
      )}
    </Droppable>
  );
}
