/**
 * EquipmentPartsSection.jsx — Bloc « Pièces détachées » d'un équipement client
 * ============================================================================
 * Fiche client (carte équipement) et fiche SAV. Si l'équipement est rattaché à un modèle fabricant : la vue éclatée
 * (agrandissable), un champ « Numéro de repère » et le tableau repère · référence · désignation · quantité · prix
 * public HT. Sinon : « Choisir le modèle fabricant ». Avec `onAddToQuote` (fiche SAV), les pièces se cochent et
 * partent dans un devis.
 * Le prix affiché est le PRIX PUBLIC HT du fabricant au dernier relevé, libellé comme tel.
 * Règles (filtre, mentions, prix) : src/lib/catalogue/nomenclature.js (pur, testé). Aucun calcul ici.
 * ============================================================================
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Wrench, Loader2, Search, Maximize2, ShoppingCart, AlertTriangle, Minus, Plus } from 'lucide-react';
import { useEquipmentModel, useEquipmentModelParts, useEquipmentModelImages, useSetEquipmentModel } from '@hooks/useEquipmentModels';
import { filtrerParReperes, mentionsPiece, prixPublicPiece } from '@/lib/catalogue/nomenclature';
import { formatEuro } from '@/lib/utils';
import EquipmentModelPicker from './EquipmentModelPicker';
import ExplodedViewViewer from './ExplodedViewViewer';

function Mentions({ ligne }) {
  const mentions = mentionsPiece(ligne);
  if (!mentions.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 ml-1.5 align-middle">
      {mentions.map((m) => (
        <span key={m.cle} className={`inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full ${m.ton === 'alerte' ? 'bg-amber-100 text-amber-900' : 'bg-secondary-100 text-secondary-600'}`}>
          {m.ton === 'alerte' && <AlertTriangle className="w-3 h-3" />}{m.texte}
        </span>
      ))}
    </span>
  );
}

/**
 * @param {object} p
 * @param {object} p.equipment équipement client (id, brand, model, equipment_model_id)
 * @param {boolean} [p.canEdit] peut choisir / changer le modèle fabricant (droit clients.edit)
 * @param {boolean} [p.defaultOpen] bloc ouvert au montage (fiche SAV)
 * @param {(choix: Array<{ ligne: object, quantite: number }>) => void} [p.onAddToQuote] active la sélection de pièces
 * @param {(modelId: string|null) => void} [p.onModelChanged] après un rattachement réussi (appelant sans cache)
 * @param {number} [p.selectionVersion] change quand la sélection doit être vidée (devis créé) — la sélection est
 *   gardée tant que le devis n'existe pas (fermer la fenêtre de devis ne perd pas les pièces cochées)
 * @param {string} [p.className]
 */
export function EquipmentPartsSection({ equipment, canEdit = false, defaultOpen = false, onAddToQuote = null, onModelChanged = null, selectionVersion = 0, className = '' }) {
  const modelId = equipment?.equipment_model_id || null;
  const [ouvert, setOuvert] = useState(defaultOpen);
  const [choixModele, setChoixModele] = useState(false);
  const [reperes, setReperes] = useState('');
  const [agrandie, setAgrandie] = useState(null);
  const [quantites, setQuantites] = useState({}); // { idLigne: quantité }
  useEffect(() => { setQuantites({}); }, [selectionVersion]);

  const { model, isLoading: chargementModele, error: erreurModele } = useEquipmentModel(modelId);
  const { parts, isLoading: chargementPieces, error: erreurPieces } = useEquipmentModelParts(modelId, ouvert);
  const { vues, manquantes, isLoading: chargementImages } = useEquipmentModelImages(model, ouvert);
  const { setModel, isSaving } = useSetEquipmentModel();

  const lignes = useMemo(() => filtrerParReperes(parts, reperes), [parts, reperes]);
  const choisies = useMemo(() => parts.filter((l) => quantites[l.id] > 0), [parts, quantites]);

  const choisirModele = async (id) => {
    try {
      await setModel({ equipmentId: equipment.id, modelId: id });
      setChoixModele(false);
      setQuantites({});
      setReperes('');
      if (id) setOuvert(true);
      onModelChanged?.(id);
      toast.success(id ? 'Modèle fabricant enregistré' : 'Modèle fabricant retiré');
    } catch {
      toast.error('Le modèle n\'a pas pu être enregistré');
    }
  };

  const regler = (id, q) => setQuantites((prev) => {
    const next = { ...prev };
    if (q <= 0) delete next[id]; else next[id] = q;
    return next;
  });

  const ajouterAuDevis = () => {
    if (!choisies.length) return;
    onAddToQuote(choisies.map((ligne) => ({ ligne, quantite: quantites[ligne.id] })));
  };

  // Équipement sans modèle fabricant : une ligne discrète, un seul geste.
  if (!modelId) {
    if (!canEdit) return null;
    return (
      <div className={`flex items-center gap-2 text-xs text-secondary-500 ${className}`}>
        <Wrench className="w-3.5 h-3.5 flex-shrink-0" />
        <span>Pièces détachées :</span>
        <button type="button" onClick={() => setChoixModele(true)} className="text-indigo-600 hover:text-indigo-800 font-medium">
          Choisir le modèle fabricant
        </button>
        {choixModele && (
          <EquipmentModelPicker equipment={equipment} currentModelId={null} isSaving={isSaving} onSelect={choisirModele} onClose={() => setChoixModele(false)} />
        )}
      </div>
    );
  }

  const titreModele = model ? `${model.model_name || model.name} · réf. ${model.reference}` : (chargementModele ? 'Chargement…' : 'Modèle introuvable');

  return (
    <div className={`rounded-lg border border-secondary-200 ${className}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOuvert((v) => !v)} aria-expanded={ouvert} className="flex-1 min-w-0 flex items-center gap-2 text-left">
          <Wrench className="w-4 h-4 text-indigo-500 flex-shrink-0" />
          <span className="text-sm font-medium text-secondary-900 flex-shrink-0">Pièces détachées</span>
          <span className="text-xs text-secondary-500 truncate">{titreModele}</span>
          {ouvert ? <ChevronUp className="w-4 h-4 text-secondary-400 flex-shrink-0 ml-auto" /> : <ChevronDown className="w-4 h-4 text-secondary-400 flex-shrink-0 ml-auto" />}
        </button>
        {canEdit && (
          <button type="button" onClick={() => setChoixModele(true)} className="text-xs text-indigo-600 hover:text-indigo-800 flex-shrink-0">Changer</button>
        )}
      </div>

      {ouvert && (
        <div className="border-t border-secondary-200 p-3 space-y-3">
          {(erreurModele || erreurPieces) && (
            <p className="text-sm text-red-700">Les pièces de ce modèle n&apos;ont pas pu être chargées. Rechargez la page ; si cela persiste, prévenez l&apos;administrateur.</p>
          )}
          {!chargementModele && !erreurModele && !model && (
            <p className="text-sm text-secondary-600">Ce modèle fabricant n&apos;existe plus dans le référentiel.{canEdit ? ' Choisissez-en un autre avec « Changer ».' : ''}</p>
          )}
          {model && model.is_active === false && (
            <p className="text-xs text-amber-900 bg-amber-50 rounded px-2 py-1.5">Ce modèle n&apos;est plus au catalogue du fabricant : la liste est celle du dernier relevé où il figurait.</p>
          )}

          {/* Vues éclatées */}
          {chargementImages && <div className="h-24 flex items-center justify-center text-secondary-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {!chargementImages && vues.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {vues.map((v, i) => (
                <button
                  key={v.url} type="button" onClick={() => setAgrandie(i)}
                  className="relative group border border-secondary-200 rounded-lg overflow-hidden bg-white"
                  title="Agrandir la vue éclatée"
                >
                  <img src={v.url} alt={`Vue éclatée ${model?.model_name || ''}${vues.length > 1 ? ` (${i + 1}/${vues.length})` : ''}`} className="h-48 w-auto max-w-full object-contain" loading="lazy" />
                  <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-white/90 text-secondary-700 border border-secondary-200">
                    <Maximize2 className="w-3 h-3" />Agrandir
                  </span>
                </button>
              ))}
            </div>
          )}
          {!chargementImages && model && vues.length === 0 && (
            <p className="text-xs text-secondary-500">Pas de vue éclatée pour ce modèle sur le site du fabricant.</p>
          )}
          {manquantes > 0 && <p className="text-xs text-amber-900">{manquantes} image{manquantes > 1 ? 's' : ''} n&apos;{manquantes > 1 ? 'ont' : 'a'} pas pu être affichée{manquantes > 1 ? 's' : ''}.</p>}

          {/* Filtre par repère */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-secondary-400" />
              <input
                type="text" value={reperes} onChange={(e) => setReperes(e.target.value)}
                placeholder="Numéro de repère (ex. 12, 30)"
                aria-label="Numéro de repère"
                className="pl-8 pr-3 py-1.5 w-56 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <span className="text-xs text-secondary-500">
              {chargementPieces ? 'Chargement des pièces…' : reperes.trim() ? `${lignes.length} ligne${lignes.length > 1 ? 's' : ''} sur ${parts.length}` : `${parts.length} ligne${parts.length > 1 ? 's' : ''}`}
            </span>
          </div>

          {/* Tableau */}
          {!chargementPieces && parts.length > 0 && (
            <div className="overflow-x-auto -mx-1">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-secondary-500 border-b border-secondary-200">
                    <th className="px-1 py-1.5 font-medium w-14">Repère</th>
                    <th className="px-1 py-1.5 font-medium w-28">Référence</th>
                    <th className="px-1 py-1.5 font-medium">Désignation</th>
                    <th className="px-1 py-1.5 font-medium text-right w-12">Qté</th>
                    <th className="px-1 py-1.5 font-medium text-right w-28">Prix public HT</th>
                    {onAddToQuote && <th className="px-1 py-1.5 font-medium text-right w-28">Pour le devis</th>}
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => {
                    const prix = prixPublicPiece(l);
                    const q = quantites[l.id] || 0;
                    return (
                      <tr key={l.id} className={`border-b border-secondary-100 ${q > 0 ? 'bg-primary-50/60' : ''}`}>
                        <td className="px-1 py-1.5 tabular-nums text-secondary-700">{l.repere || '—'}</td>
                        <td className="px-1 py-1.5 font-mono text-xs text-secondary-800 whitespace-nowrap">{l.piece_reference}</td>
                        <td className="px-1 py-1.5 text-secondary-900">
                          {l.piece_name}
                          {l.notes ? <span className="text-secondary-500"> {l.notes}</span> : null}
                          <Mentions ligne={l} />
                        </td>
                        <td className="px-1 py-1.5 text-right tabular-nums text-secondary-700">{Number(l.quantity) || 1}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums text-secondary-900 whitespace-nowrap">{prix != null ? formatEuro(prix) : <span className="text-secondary-400">non communiqué</span>}</td>
                        {onAddToQuote && (
                          <td className="px-1 py-1.5">
                            <div className="flex items-center justify-end gap-1">
                              <button type="button" onClick={() => regler(l.id, q - 1)} disabled={q === 0} aria-label={`Retirer ${l.piece_reference}`} className="w-6 h-6 rounded-full border border-secondary-300 flex items-center justify-center hover:bg-secondary-100 disabled:opacity-30"><Minus className="w-3 h-3" /></button>
                              <span className="w-5 text-center tabular-nums text-sm">{q}</span>
                              <button type="button" onClick={() => regler(l.id, q + 1)} aria-label={`Ajouter ${l.piece_reference}`} className="w-6 h-6 rounded-full border border-secondary-300 flex items-center justify-center hover:bg-secondary-100"><Plus className="w-3 h-3" /></button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {lignes.length === 0 && <p className="px-1 py-3 text-sm text-secondary-500">Aucune pièce au repère « {reperes} » sur ce modèle.</p>}
            </div>
          )}
          {!chargementPieces && !erreurPieces && model && parts.length === 0 && (
            <p className="text-sm text-secondary-500">Aucune pièce détachée relevée pour ce modèle.</p>
          )}

          <p className="text-[11px] text-secondary-400">
            Prix public HT du fabricant au dernier relevé. Vérifiez la pièce sur la vue éclatée fournie avec l&apos;appareil : certaines pièces ont évolué.
          </p>

          {onAddToQuote && (
            <div className="flex items-center justify-end gap-3 pt-1">
              <span className="text-xs text-secondary-500">{choisies.length > 0 ? `${choisies.length} pièce${choisies.length > 1 ? 's' : ''} choisie${choisies.length > 1 ? 's' : ''}` : 'Choisissez les pièces avec + pour créer un devis'}</span>
              <button type="button" onClick={ajouterAuDevis} disabled={choisies.length === 0} className="btn-primary btn-sm inline-flex items-center gap-1.5 disabled:opacity-50">
                <ShoppingCart className="w-4 h-4" />Créer un devis avec ces pièces
              </button>
            </div>
          )}
        </div>
      )}

      {choixModele && (
        <EquipmentModelPicker equipment={equipment} currentModelId={modelId} isSaving={isSaving} onSelect={choisirModele} onClose={() => setChoixModele(false)} />
      )}
      {agrandie != null && vues[agrandie] && (
        <ExplodedViewViewer vues={vues} index={agrandie} titre={model?.name || 'Vue éclatée'} onChange={setAgrandie} onClose={() => setAgrandie(null)} />
      )}
    </div>
  );
}

export default EquipmentPartsSection;
