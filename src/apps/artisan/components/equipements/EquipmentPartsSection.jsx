/**
 * EquipmentPartsSection.jsx — Bloc « Pièces détachées » d'un équipement client
 * ============================================================================
 * Fiche client (carte équipement) et fiche SAV. Si l'équipement est rattaché à un modèle fabricant : les vues éclatées,
 * un champ de recherche (repère, référence ou mot) et le tableau repère · référence · désignation · quantité · prix
 * public HT (`NomenclatureTable`). Sinon : « Choisir le modèle fabricant ». Avec `onQuantiteChange`, `actionsSelection`
 * ou une sélection contrôlée, les pièces se choisissent avec + / −.
 * « Lire avec la liste » (ou une vignette) ouvre le MODE ATELIER (`AtelierPieces`) : document en face de la liste,
 * dans la page, sans voile. Ouverture contrôlable de l'extérieur (`atelier` / `onAtelierChange`) : la fiche client
 * l'ouvre sur un document cliqué dans « Documents » (`doc:<id>`), y compris pour un appareil sans modèle fabricant
 * (document seul, sans liste).
 * Le prix affiché est le PRIX PUBLIC HT du fabricant au dernier relevé, libellé comme tel.
 * Règles (filtre, mentions, prix) : src/lib/catalogue/nomenclature.js (pur, testé). Aucun calcul ici.
 * ============================================================================
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Wrench, Loader2, Maximize2, AlertTriangle, ExternalLink, BookOpen } from 'lucide-react';
import { useEquipmentModel, useEquipmentModelParts, useEquipmentModelImages, useSetEquipmentModel } from '@hooks/useEquipmentModels';
import { useEquipmentModelDocuments } from '@hooks/useEquipmentDocuments';
import { listePiecesDisponible, liensFabricant } from '@/lib/catalogue/nomenclature';
import { ongletsAtelier, ongletActif, vuesDeclarees } from '@/lib/catalogue/documentsAppareil';
import EquipmentModelPicker from './EquipmentModelPicker';
import NomenclatureTable from './NomenclatureTable';
import AtelierPieces from './AtelierPieces';

const ATELIER_FERME = { ouvert: false, ongletId: null };

/**
 * @param {object} p
 * @param {object} p.equipment équipement client (id, brand, model, equipment_model_id)
 * @param {boolean} [p.canEdit] peut choisir / changer le modèle fabricant (droit clients.edit)
 * @param {boolean} [p.defaultOpen] bloc ouvert au montage (fiche SAV)
 * @param {(modelId: string|null) => void} [p.onModelChanged] après un rattachement réussi (appelant sans cache)
 * @param {number} [p.selectionVersion] change quand la sélection doit être vidée (devis créé) — la sélection est
 *   gardée tant que le devis n'existe pas (fermer la fenêtre de devis ne perd pas les pièces cochées). Sélection
 *   locale seulement : une sélection contrôlée est vidée par l'appelant.
 * @param {{ [ligneId: string]: number }} [p.quantites] sélection CONTRÔLÉE par l'appelant (sinon état local)
 * @param {(ligne: object, quantite: number) => void} [p.onQuantiteChange] + / − sur une ligne (sélection contrôlée)
 * @param {boolean} [p.selectionLectureSeule] + / − désactivés, quantités affichées
 * @param {{ ouvert: boolean, ongletId?: string|null }} [p.atelier] mode atelier CONTRÔLÉ (sinon état interne)
 * @param {(atelier: { ouvert: boolean, ongletId: string|null }) => void} [p.onAtelierChange] ouverture, onglet, « Réduire »
 * @param {import('react').ReactNode | ((choix: Array<{ ligne: object, quantite: number }>) => import('react').ReactNode)} [p.actionsSelection]
 *   boutons sous la liste ; une fonction reçoit les pièces choisies
 * @param {Array<object>} [p.documents] documents de l'appareil déjà chargés par l'appelant (fiche client) ; absent ⇒
 *   lus ici par l'équipement
 * @param {string} [p.className]
 */
export function EquipmentPartsSection({
  equipment, canEdit = false, defaultOpen = false, onModelChanged = null, selectionVersion = 0,
  quantites: quantitesControlees = null, onQuantiteChange = null,
  selectionLectureSeule = false, atelier: atelierControle = null, onAtelierChange = null, actionsSelection = null,
  documents: documentsFournis, className = '',
}) {
  const modelId = equipment?.equipment_model_id || null;
  const [ouvert, setOuvert] = useState(defaultOpen);
  const [choixModele, setChoixModele] = useState(false);
  const [reperes, setReperes] = useState('');
  const [atelierInterne, setAtelierInterne] = useState(ATELIER_FERME);
  const [quantitesLocales, setQuantitesLocales] = useState({}); // { idLigne: quantité }
  // Vidée quand l'appelant le demande, et quand le modèle change (les lignes d'un autre modèle n'ont plus de sens)
  useEffect(() => { setQuantitesLocales({}); }, [selectionVersion, modelId]);

  const atelier = atelierControle || atelierInterne;
  const actif = ouvert || !!atelier.ouvert;
  const quantites = quantitesControlees || quantitesLocales;
  const avecSelection = !!(onQuantiteChange || actionsSelection || quantitesControlees);

  const { model, isLoading: chargementModele, error: erreurModele } = useEquipmentModel(modelId);
  const { parts, isLoading: chargementPieces, error: erreurPieces } = useEquipmentModelParts(modelId, actif);
  const { vues, manquantes, isLoading: chargementImages } = useEquipmentModelImages(model, actif);
  const lireDocuments = documentsFournis === undefined && modelId && equipment?.id;
  const { documentsByEquipmentId } = useEquipmentModelDocuments(lireDocuments ? [equipment.id] : []);
  const { setModel, isSaving } = useSetEquipmentModel();

  const documents = documentsFournis !== undefined ? documentsFournis : (modelId ? documentsByEquipmentId[equipment.id] : null);
  const onglets = useMemo(() => ongletsAtelier({ vues, documents }), [vues, documents]);
  const lisible = onglets.length > 0 || vuesDeclarees(model) > 0;
  const vuesDeNotice = vues.some((v) => v.origine === 'notice');
  const choisies = useMemo(
    () => parts.filter((l) => quantites[l.id] > 0).map((ligne) => ({ ligne, quantite: quantites[ligne.id] })),
    [parts, quantites],
  );

  const changerAtelier = (suivant) => {
    const a = { ouvert: !!suivant.ouvert, ongletId: suivant.ongletId ?? null };
    if (!atelierControle) setAtelierInterne(a);
    onAtelierChange?.(a);
  };
  const lireAvecLaListe = (ongletId = null) => changerAtelier({ ouvert: true, ongletId });

  const choisirModele = async (id) => {
    try {
      await setModel({ equipmentId: equipment.id, modelId: id });
      setChoixModele(false);
      setQuantitesLocales({});
      setReperes('');
      if (atelier.ouvert) changerAtelier(ATELIER_FERME);
      if (id) setOuvert(true);
      onModelChanged?.(id);
      toast.success(id ? 'Modèle fabricant enregistré' : 'Modèle fabricant retiré');
    } catch {
      toast.error('Le modèle n\'a pas pu être enregistré');
    }
  };

  const regler = (ligne, q) => {
    if (selectionLectureSeule) return;
    const quantite = Math.max(0, q);
    onQuantiteChange?.(ligne, quantite);
    if (quantitesControlees) return;
    setQuantitesLocales((prev) => {
      const next = { ...prev };
      if (quantite <= 0) delete next[ligne.id]; else next[ligne.id] = quantite;
      return next;
    });
  };

  const selecteurModele = choixModele && (
    <EquipmentModelPicker equipment={equipment} currentModelId={modelId} isSaving={isSaving} onSelect={choisirModele} onClose={() => setChoixModele(false)} />
  );
  const titreModele = !modelId
    ? [equipment?.brand, equipment?.model].filter(Boolean).join(' ')
    : model ? `${model.model_name || model.name} · réf. ${model.reference}` : (chargementModele ? 'Chargement…' : 'Modèle introuvable');
  // Un document demandé s'affiche tout de suite : l'attente des vues éclatées ne concerne qu'un onglet de vue (ou aucun)
  const attenteVues = chargementImages && !String(atelier.ongletId || '').startsWith('doc:');
  const boutonLire = (libelle) => (
    <button type="button" onClick={() => lireAvecLaListe()} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium flex-shrink-0">
      <BookOpen className="w-3.5 h-3.5" />{libelle}
    </button>
  );
  const atelierOuvert = (liste) => (
    <AtelierPieces
      titre={titreModele} onglets={onglets} ongletId={atelier.ongletId ?? null}
      onOnglet={(id) => changerAtelier({ ouvert: true, ongletId: id })}
      vueNotice={ongletActif(onglets, atelier.ongletId)?.vueDeNotice === true}
      chargement={attenteVues} liste={liste} onReduire={() => changerAtelier(ATELIER_FERME)}
    />
  );

  // Équipement sans modèle fabricant : une ligne discrète, un seul geste — ou le document seul, ouvert depuis « Documents ».
  if (!modelId) {
    if (atelier.ouvert) return <div className={className}>{atelierOuvert(null)}{selecteurModele}</div>;
    if (!canEdit) return null;
    return (
      <div className={`flex items-center gap-2 text-xs text-secondary-500 ${className}`}>
        <Wrench className="w-3.5 h-3.5 flex-shrink-0" />
        <span>Pièces détachées :</span>
        <button type="button" onClick={() => setChoixModele(true)} className="text-indigo-600 hover:text-indigo-800 font-medium">
          Choisir le modèle fabricant
        </button>
        {selecteurModele}
      </div>
    );
  }

  // Fiche trouvée sur le web ou créée depuis un article : jamais de liste de pièces — une ligne, pas un tableau vide ;
  // l'atelier y montre le document seul.
  if (model && !listePiecesDisponible(model)) {
    if (atelier.ouvert) return <div className={className}>{atelierOuvert(null)}{selecteurModele}</div>;
    const liens = liensFabricant(model);
    return (
      <div className={`space-y-1.5 text-xs text-secondary-500 ${className}`}>
        {liens.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-secondary-600">Site du fabricant :</span>
            {liens.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800">
                <ExternalLink className="w-3 h-3" />{l.label}
              </a>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Wrench className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Pièces détachées : pas de liste de pièces pour cet appareil.</span>
          {lisible && boutonLire('Lire les documents')}
          {canEdit && <button type="button" onClick={() => setChoixModele(true)} className="text-indigo-600 hover:text-indigo-800">Changer</button>}
        </div>
        {selecteurModele}
      </div>
    );
  }

  const erreurs = (
    <>
      {(erreurModele || erreurPieces) && (
        <p className="text-sm text-red-700">Les pièces de ce modèle n&apos;ont pas pu être chargées. Rechargez la page ; si cela persiste, prévenez l&apos;administrateur.</p>
      )}
      {!chargementModele && !erreurModele && !model && (
        <p className="text-sm text-secondary-600">Ce modèle fabricant n&apos;existe plus dans le référentiel.{canEdit ? ' Choisissez-en un autre avec « Changer ».' : ''}</p>
      )}
      {model && model.is_active === false && (
        <p className="text-xs text-amber-900 bg-amber-50 rounded px-2 py-1.5">Ce modèle n&apos;est plus au catalogue du fabricant : la liste est celle du dernier relevé où il figurait.</p>
      )}
    </>
  );

  const nbChoisies = `${choisies.length} pièce${choisies.length > 1 ? 's' : ''} choisie${choisies.length > 1 ? 's' : ''}`;
  const actions = actionsSelection && (
    <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
      {choisies.length > 0 && <span className="text-xs text-secondary-500">{nbChoisies}</span>}
      {typeof actionsSelection === 'function' ? actionsSelection(choisies) : actionsSelection}
    </div>
  );

  const liste = (
    <>
      <NomenclatureTable
        parts={parts} chargement={chargementPieces} recherche={reperes} onRecherche={setReperes}
        quantites={quantites} onRegler={regler} avecSelection={avecSelection}
        libelleSelection="Choisies" lectureSeule={selectionLectureSeule}
      />
      {!chargementPieces && !erreurPieces && model && parts.length === 0 && (
        <p className="text-sm text-secondary-500">Aucune pièce détachée relevée pour ce modèle.</p>
      )}
      <p className="text-[11px] text-secondary-400">
        Prix public HT du fabricant au dernier relevé. Vérifiez la pièce sur la vue éclatée fournie avec l&apos;appareil : certaines pièces ont évolué.
      </p>
      {actions}
    </>
  );

  if (atelier.ouvert) {
    return <div className={className}>{atelierOuvert(<>{erreurs}{liste}</>)}{selecteurModele}</div>;
  }

  return (
    <div className={`rounded-lg border border-secondary-200 ${className}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOuvert((v) => !v)} aria-expanded={ouvert} className="flex-1 min-w-0 flex items-center gap-2 text-left">
          <Wrench className="w-4 h-4 text-indigo-500 flex-shrink-0" />
          <span className="text-sm font-medium text-secondary-900 flex-shrink-0">Pièces détachées</span>
          <span className="text-xs text-secondary-500 truncate">{titreModele}</span>
          {ouvert ? <ChevronUp className="w-4 h-4 text-secondary-400 flex-shrink-0 ml-auto" /> : <ChevronDown className="w-4 h-4 text-secondary-400 flex-shrink-0 ml-auto" />}
        </button>
        {lisible && boutonLire('Lire avec la liste')}
        {canEdit && (
          <button type="button" onClick={() => setChoixModele(true)} className="text-xs text-indigo-600 hover:text-indigo-800 flex-shrink-0">Changer</button>
        )}
      </div>

      {ouvert && (
        <div className="border-t border-secondary-200 p-3 space-y-3">
          {erreurs}

          {/* Vues éclatées : une vignette ouvre l'atelier sur cette vue */}
          {chargementImages && <div className="h-24 flex items-center justify-center text-secondary-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {!chargementImages && vues.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {vues.map((v, i) => (
                <button
                  key={v.url} type="button" onClick={() => lireAvecLaListe(`vue:${i}`)}
                  className="relative group border border-secondary-200 rounded-lg overflow-hidden bg-white"
                  title="Lire la vue éclatée à côté de la liste"
                >
                  <img src={v.url} alt={`${v.role === 'nomenclature' ? 'Nomenclature de la notice' : 'Vue éclatée'} ${model?.model_name || ''}${vues.length > 1 ? ` (${i + 1}/${vues.length})` : ''}`} className="h-48 w-auto max-w-full object-contain" loading="lazy" />
                  <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-white/90 text-secondary-700 border border-secondary-200">
                    <Maximize2 className="w-3 h-3" />Agrandir
                  </span>
                  {v.origine === 'notice' && (
                    <span className="absolute top-1 left-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200">
                      {v.role === 'nomenclature' ? 'Nomenclature de la notice' : 'Vue de la notice'}{v.page ? `, p. ${v.page}` : ''}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {vuesDeNotice && (
            <p className="flex items-start gap-1.5 text-xs text-amber-900 bg-amber-50 rounded px-2 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>Le fabricant ne publie pas de vue éclatée pour ce modèle : celle-ci vient de la notice. <strong>Ses repères sont ceux de la notice, pas ceux de la liste ci-dessous.</strong> Lisez la référence dans la nomenclature de la notice, puis cherchez-la dans la liste.</span>
            </p>
          )}
          {!chargementImages && model && vues.length === 0 && (
            <p className="text-xs text-secondary-500">Pas de vue éclatée pour ce modèle sur le site du fabricant.</p>
          )}
          {manquantes > 0 && <p className="text-xs text-amber-900">{manquantes} image{manquantes > 1 ? 's' : ''} n&apos;{manquantes > 1 ? 'ont' : 'a'} pas pu être affichée{manquantes > 1 ? 's' : ''}.</p>}

          {liste}
        </div>
      )}

      {selecteurModele}
    </div>
  );
}

export default EquipmentPartsSection;
