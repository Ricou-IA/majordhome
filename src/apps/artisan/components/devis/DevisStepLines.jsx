/**
 * DevisStepLines.jsx — Étape 2 du wizard : éditeur de lignes
 * ============================================================================
 * - Chapitres prédéfinis par la famille, chacun typé (équipement, option, stock, main d'œuvre, libre, fumisterie) :
 *   le « Catalogue » du chapitre propose les articles de cette nature (décisions d'Eric, 2026-10-25)
 * - « Ligne libre » dans tout chapitre (petite fourniture au forfait, prestation, main d'œuvre ponctuelle)
 * - TVA du devis : celle de la famille par défaut, changeable d'un geste pour toutes les lignes
 * - Marque d'une ligne de stock choisie dans le devis (prix d'achat de la marque)
 * - Remise par ligne (%) ; glisser-déposer des lignes (poignée, entre chapitres) et des chapitres (devisOrdre.js)
 * - Lignes libres sans article : création de l'article à la ligne ou en lot (org_admin, natures.js)
 * - « Importer une offre fournisseur » : lignes d'une offre PDF rangées dans les chapitres par nature (ImportOffreDevisModal)
 * - Coche « Caractéristiques » par ligne d'article (compteur calculé ici, une fois pour tout l'écran) et description libre
 * - Totaux en temps réel
 * ============================================================================
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { computeLineTotals, productCategoriesForSection } from '@services/devis.service';
import { typeChapitre, tvaDuDevis, TAUX_TVA } from '@/lib/devisConfig.js';
import { marquesDesOffres, appliquerMarque } from '@/lib/catalogue/marqueLigne.js';
import { lignesCaracteristiques } from '@/lib/devisCaracteristiques.js';
import { canonicalFieldsForCategory } from '@/shared/specs';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useCatalogItemOffers, useCatalogItemMutations } from '@hooks/useCatalogItems';
import { deplacerLigne, deplacerChapitre } from '@/lib/devisOrdre.js';
import { articleDepuisLigne, lignesSansArticle } from '@/lib/catalogue/natures.js';
import { insererLignesOffre } from '@/lib/catalogue/offreRapprochement.js';
import DevisProductPicker from './DevisProductPicker';
import DevisLineRow from './DevisLineRow';
import MetreFumisterie from './metre/MetreFumisterie';
import ImportOffreDevisModal from './ImportOffreDevisModal';
import { formatEuro } from '@/lib/utils';
import { Plus, Package, Ruler, PenLine, BookOpen, GripVertical, BookmarkPlus } from 'lucide-react';

const TYPE_LABELS = {
  equipement: 'Équipement', option: 'Options', stock: 'Matériel stocké', main_oeuvre: 'Main d’œuvre', libre: 'Libre', fumisterie: 'Fumisterie',
};
// Références stables : une valeur par défaut recréée à chaque rendu relancerait les useMemo qui en dépendent
const AUCUN_ARTICLE = new Map();
const AUCUN_COMPTE = new Map();


// =============================================================================
// BLOC CHAPITRE (titre + lignes enfants + boutons d'ajout)
// =============================================================================

function SectionBlock({ blocIndex, sectionIndex, section, type, childLines, poigneeChapitre, onUpdate, onRemove, onAddProducts, onAddLabor, onAddFreeform, onMetre, marquesParItem, nbParItem, onMarque, onCreerArticle, creationIndex }) {
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
          marquesParItem={marquesParItem} nbParItem={nbParItem} onMarque={onMarque} onCreerArticle={onCreerArticle} creationIndex={creationIndex} />
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
function ListeLignes({ droppableId, childLines, type, onUpdate, onRemove, marquesParItem, nbParItem, onMarque, onCreerArticle, creationIndex }) {
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

// =============================================================================
// COMPOSANT PRINCIPAL
// =============================================================================

export default function DevisStepLines({ orgId, lines, setLines, leadId, family, onMetreValidated, devisConfig, importOffreOuvert = false, onFermerImportOffre, articles = AUCUN_ARTICLE }) {
  const [pickerForSection, setPickerForSection] = useState(null); // { index, categories, type }
  const [metreForSection, setMetreForSection] = useState(null); // index global de la section FUMISTERIE
  // TVA du devis DÉRIVÉE à chaque rendu (tvaDuDevis) : les lignes chiffrées font foi (devis repris, devis type chargé) ;
  // le choix mémorisé ne sert que tant que le devis n'a aucune ligne chiffrée ; changer de famille l'oublie.
  const [tvaChoisie, setTvaChoisie] = useState(null);
  useEffect(() => { setTvaChoisie(null); }, [family]);
  const tvaDevis = tvaDuDevis({ forcee: tvaChoisie, lines, config: devisConfig, famille: family });

  const changerTvaDevis = useCallback((valeur) => {
    const t = Number(valeur);
    setTvaChoisie(t);
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

  // Nombre de caractéristiques imprimables par article (le schéma est celui de la catégorie de l'article)
  const nbParItem = useMemo(() => {
    if (articles.size === 0) return AUCUN_COMPTE;
    const m = new Map();
    for (const [id, article] of articles) m.set(id, lignesCaracteristiques(article, canonicalFieldsForCategory(article.category)).length);
    return m;
  }, [articles]);

  const updateLine = useCallback((index, updatedLine) => {
    setLines((prev) => prev.map((l, i) => (i === index ? updatedLine : l)));
  }, [setLines]);

  const changerMarque = useCallback((index, marque) => {
    setLines((prev) => prev.map((l, i) => (i === index ? appliquerMarque(l, marque, offresParItem.get(l.catalog_item_id) || []) : l)));
  }, [setLines, offresParItem]);

  const removeLine = useCallback((index) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }, [setLines]);

  // Glisser-déposer : une ligne (dans son chapitre ou vers un autre) ou un chapitre entier avec ses lignes
  const onDragEnd = useCallback(({ source, destination, type }) => {
    if (!destination) return;
    if (type === 'CHAPITRE') {
      if (source.index !== destination.index) setLines((prev) => deplacerChapitre(prev, source.index, destination.index));
      return;
    }
    const deBloc = Number(source.droppableId.replace('bloc-', ''));
    const versBloc = Number(destination.droppableId.replace('bloc-', ''));
    if (deBloc === versBloc && source.index === destination.index) return;
    setLines((prev) => deplacerLigne(prev, { deBloc, deRang: source.index, versBloc, versRang: destination.index }));
  }, [setLines]);

  // Créer l'article de la base depuis une ligne libre (org_admin) : la ligne reste telle quelle et pointe vers l'article
  const { isOrgAdmin } = useAuth();
  const { createItem } = useCatalogItemMutations(orgId);
  const [creationIndex, setCreationIndex] = useState(null);
  const typeDeLigne = useCallback((index) => {
    for (let i = index; i >= 0; i--) if (lines[i]?.line_type === 'section_title') return typeChapitre(devisConfig, family, lines[i].designation);
    return 'libre';
  }, [lines, devisConfig, family]);
  const creerUnArticle = useCallback(async (index, type) => {
    const ligne = lines[index];
    const titre = [...lines.slice(0, index + 1)].reverse().find((l) => l.line_type === 'section_title')?.designation;
    const article = articleDepuisLigne(ligne, type, productCategoriesForSection(titre, family, devisConfig)[0] || null);
    if (!article) return false;
    const item = await createItem(article);
    setLines((prev) => prev.map((l) => (l === ligne ? { ...l, catalog_item_id: item.id } : l)));
    return true;
  }, [lines, family, devisConfig, createItem, setLines]);
  const creerArticle = useCallback(async (index, type) => {
    setCreationIndex(index);
    try { if (await creerUnArticle(index, type)) toast.success('Article créé dans la base'); }
    catch (err) { toast.error(err?.message || 'Création refusée'); }
    finally { setCreationIndex(null); }
  }, [creerUnArticle]);
  const aCreer = useMemo(() => (isOrgAdmin ? lignesSansArticle(lines) : []), [isOrgAdmin, lines]);
  const creerTousLesArticles = useCallback(async () => {
    let faits = 0;
    const echecs = [];
    for (const i of aCreer) {
      setCreationIndex(i);
      try { if (await creerUnArticle(i, typeDeLigne(i))) faits += 1; }
      catch (err) { echecs.push(`${lines[i].designation} : ${err?.message || 'refusé'}`); }
    }
    setCreationIndex(null);
    if (faits) toast.success(`${faits} article${faits > 1 ? 's' : ''} créé${faits > 1 ? 's' : ''} dans la base`);
    echecs.forEach((e) => toast.error(e));
  }, [aCreer, creerUnArticle, typeDeLigne, lines]);

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
    designation: '', description: '', reference: '', quantity: 1, purchase_price_ht: null, unit_price_ht: 0, tva_rate: tvaDevis,
    show_specs: false, caracteristiques: [], ...extra,
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
    setLines((prev) => [...prev, { line_type: 'section_title', designation: '', hide_prices: false, quantity: 0, unit_price_ht: 0, tva_rate: 0 }]);
  }, [setLines]);

  // Offre fournisseur importée : chaque ligne part dans le premier chapitre du type de sa nature (secours : nouveau chapitre)
  const insererOffre = useCallback((nouvelles, titreSecours) => {
    setLines((prev) => insererLignesOffre(prev, nouvelles, { typeDe: (titre) => typeChapitre(devisConfig, family, titre), titreSecours }));
  }, [setLines, devisConfig, family]);

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

      {aCreer.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-secondary-600 bg-primary-50/60 border border-primary-100 rounded-lg px-3 py-2">
          <BookmarkPlus className="w-4 h-4 text-primary-600 flex-shrink-0" />
          <span className="flex-1 min-w-0">
            {aCreer.length} ligne{aCreer.length > 1 ? 's' : ''} saisie{aCreer.length > 1 ? 's' : ''} à la main {aCreer.length > 1 ? 'ne sont' : 'n’est'} pas dans la base d’articles.
          </span>
          <button type="button" onClick={creerTousLesArticles} disabled={creationIndex != null} className="btn-secondary btn-sm">
            Créer {aCreer.length > 1 ? `les ${aCreer.length} articles` : 'l’article'}
          </button>
        </div>
      )}

      {hasSections ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="space-y-3">
            {/* lignes avant le premier chapitre (bloc sans titre, toujours en tête) */}
            {sections[0] && !sections[0].section && (
              <ListeLignes droppableId="bloc-0" childLines={sections[0].children} type="libre" onUpdate={updateLine} onRemove={removeLine}
                marquesParItem={marquesParItem} nbParItem={nbParItem} onMarque={changerMarque} onCreerArticle={isOrgAdmin ? creerArticle : undefined} creationIndex={creationIndex} />
            )}
            <Droppable droppableId="chapitres" type="CHAPITRE">
              {(drop) => (
                <div ref={drop.innerRef} {...drop.droppableProps} className="space-y-3">
                  {sections.filter((sec) => sec.section).map((sec, rang) => {
                    const blocIndex = sections.indexOf(sec);
                    return (
                      <Draggable key={`chap-${sec.sectionIndex}`} draggableId={`chap-${sec.sectionIndex}`} index={rang}>
                        {(drag) => (
                          <div ref={drag.innerRef} {...drag.draggableProps}>
                            <SectionBlock
                              blocIndex={blocIndex}
                              sectionIndex={sec.sectionIndex}
                              section={sec.section}
                              type={typeChapitre(devisConfig, family, sec.section.designation)}
                              childLines={sec.children}
                              poigneeChapitre={drag.dragHandleProps}
                              onUpdate={updateLine}
                              onRemove={removeLine}
                              onAddProducts={handleAddProductsToSection}
                              onAddLabor={addLaborToSection}
                              onAddFreeform={addFreeformToSection}
                              onMetre={setMetreForSection}
                              marquesParItem={marquesParItem}
                              nbParItem={nbParItem}
                              onMarque={changerMarque}
                              onCreerArticle={isOrgAdmin ? creerArticle : undefined}
                              creationIndex={creationIndex}
                            />
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {drop.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        </DragDropContext>
      ) : (
        <div className="text-center py-8 text-secondary-500 text-sm">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
          Choisissez une installation ci-dessus pour créer les chapitres du devis
        </div>
      )}

      <button type="button" onClick={addSection} className="btn-secondary btn-sm w-full">
        <Plus className="w-3.5 h-3.5 mr-1" /> Ajouter un chapitre
      </button>

      {/* ouverte depuis l'en-tête du devis (DevisEntete), gérée ici : TVA du devis et chapitres sont connus ici */}
      {importOffreOuvert && <ImportOffreDevisModal orgId={orgId} tva={tvaDevis} onInsert={insererOffre} onClose={() => onFermerImportOffre?.()} />}

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
