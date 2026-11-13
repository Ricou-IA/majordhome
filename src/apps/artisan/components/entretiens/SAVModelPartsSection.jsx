/**
 * SAVModelPartsSection.jsx — Pièces détachées de l'appareil, dans la fiche SAV
 * ============================================================================
 * Le bloc « Pièces détachées » (vue éclatée + nomenclature du modèle fabricant) pour l'équipement du SAV, ou celui
 * que l'on choisit parmi les équipements du client. Une pièce cochée est ENREGISTRÉE aussitôt sur la carte
 * (`useSavPieces`, table sav_part_selections) et listée en tête (« Pièces identifiées »). « Créer un devis avec ces
 * pièces » part de cette liste enregistrée (tous appareils) : NOUVEAU devis fléché vers la carte (aucun lead, devis sur
 * le client), chapitre « PIÈCES » de la famille « Dépannage / SAV ». Le devis ne vide pas la liste.
 * ============================================================================
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingCart, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { useCanAccess } from '@hooks/usePermissions';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { moduleActif } from '@lib/modules';
import { buildDefaultSections } from '@services/devis.service';
import { buildDevisConfig, famillesActives, tvaFamille } from '@/lib/devisConfig';
import { lignesDevisAvecPieces } from '@/lib/catalogue/nomenclature';
import { leadDepuisCarteSav } from '@/lib/savDevis';
import { libelleEquipement } from '@/lib/equipmentReferential';
import {
  photoPiece, photoDepuisIdentifiee, quantitesPourEquipement, choixDepuisIdentifiees, modelesPourDevis, nomenclaturesParEquipement,
  selectionModifiable, etatDevisPieces,
} from '@/lib/catalogue/piecesIdentifiees';
import { useSavPieces } from '@hooks/useSavPieces';
import { useEquipmentModelParts, useEquipmentModelPartsMany } from '@hooks/useEquipmentModels';
import { EquipmentPartsSection } from '../equipements/EquipmentPartsSection';
import CreateDevisModal from '../devis/CreateDevisModal';
import TrouverPieceButton from '../assistant/TrouverPieceButton';
import PiecesIdentifieesListe from './PiecesIdentifieesListe';

const nomEquipement = (eq, referentiel) => [libelleEquipement(eq, referentiel), eq.brand, eq.model].filter(Boolean).join(' · ');

/**
 * @param {object} p
 * @param {object} p.item carte SAV (ligne de `majordhome_entretien_sav`)
 * @param {object[]} p.equipements équipements du client
 * @param {object} p.referentiel index du référentiel d'équipements (libellés)
 * @param {boolean} [p.canEdit] peut choisir le modèle fabricant et créer un devis depuis la fiche
 * @param {boolean} [p.peutIdentifier] peut cocher / changer / retirer une pièce identifiée (`peutIdentifierPieces`)
 * @param {object[]} [p.membres] équipe (user_id, first_name) : auteur d'une pièce identifiée
 * @param {() => void} [p.onUpdated] rafraîchir le kanban après la création d'un devis
 * @param {(ouvert: boolean) => void} [p.onAtelierChange] mode atelier ouvert / fermé (la fiche s'élargit)
 */
export function SAVModelPartsSection({ item, equipements = [], referentiel, canEdit = false, peutIdentifier = false, membres = [], onUpdated, onAtelierChange }) {
  const { can } = useCanAccess();
  const { settings } = useOrgSettings();
  const config = useMemo(() => buildDevisConfig(settings), [settings]);
  // Rattachements faits depuis cette fiche : la liste des équipements vient d'un chargement local, pas d'un cache.
  const [modeles, setModeles] = useState({}); // { equipmentId: modelId|null }
  const liste = useMemo(() => equipements.map((e) => (e.id in modeles ? { ...e, equipment_model_id: modeles[e.id] } : e)), [equipements, modeles]);

  const [choisi, setChoisi] = useState(null);
  useEffect(() => {
    if (choisi && liste.some((e) => e.id === choisi)) return;
    const defaut = liste.find((e) => e.id === item?.equipment_id) || liste.find((e) => e.equipment_model_id) || liste[0];
    setChoisi(defaut?.id || null);
  }, [liste, item?.equipment_id, choisi]);
  const equipement = liste.find((e) => e.id === choisi) || null;

  // Pièces identifiées, enregistrées sur la carte. La nomenclature affichée ne compte que celles de SON appareil.
  const { selections, isLoading: chargementSelections, error: erreurSelections, setQuantity } = useSavPieces(item?.id);
  // Liste inconnue (chargement / échec) ⇒ verrouillée : un « + » écraserait une quantité déjà enregistrée.
  const modifiable = selectionModifiable({ peutIdentifier, chargement: chargementSelections, erreur: erreurSelections });
  const modelId = equipement?.equipment_model_id || null;
  const { parts } = useEquipmentModelParts(modelId);
  const quantites = useMemo(() => quantitesPourEquipement(selections, equipement?.id, parts), [selections, equipement?.id, parts]);
  // Nomenclatures des appareils qui portent une pièce : le devis retrouve la ligne actuelle (prix de vente, article).
  const modelesDevis = useMemo(() => modelesPourDevis(selections, liste), [selections, liste]);
  const { partsByModel, isLoading: chargementNomenclatures, error: erreurNomenclatures } = useEquipmentModelPartsMany(modelesDevis);

  const enregistrer = (photo) => setQuantity(photo).catch(() => {}); // refus : toast + retour à la base (hook)
  const changerQuantite = (ligne, q) => enregistrer(photoPiece(ligne, { equipmentId: equipement.id, equipmentModelId: modelId }, q));
  const changerAtelier = (ouvert) => onAtelierChange?.(ouvert);

  const [lignesDevis, setLignesDevis] = useState(null);
  const familleSav = useMemo(() => famillesActives(config).find((f) => f.key === 'sav') || null, [config]);
  const peutCreerDevis = canEdit && can('devis', 'create') && !!item?.client_id;

  const etatDevis = etatDevisPieces({
    familleActive: !!familleSav, chargementSelections, erreurSelections, chargementNomenclatures, erreurNomenclatures,
    nbSelections: selections.length,
  });
  const creerDevis = () => {
    if (!etatDevis.pret) { toast.error(etatDevis.raison || 'Le devis ne peut pas être créé pour le moment'); return; }
    const label = familleSav?.label || '';
    const sections = label ? buildDefaultSections(label, config) : [];
    const choix = choixDepuisIdentifiees(selections, nomenclaturesParEquipement(liste, partsByModel));
    setLignesDevis({ famille: label, lignes: lignesDevisAvecPieces(sections, choix, tvaFamille(config, label)) });
  };

  if (!liste.length) return null;
  const selecteur = liste.length > 1 && (
    <select
      value={choisi || ''} onChange={(e) => { setChoisi(e.target.value); changerAtelier(false); }} aria-label="Appareil concerné"
      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
    >
      {liste.map((e) => <option key={e.id} value={e.id}>{nomEquipement(e, referentiel)}{e.id === item?.equipment_id ? ' (appareil du SAV)' : ''}</option>)}
    </select>
  );
  const nomAppareil = liste.length > 1
    ? (id) => { const e = liste.find((x) => x.id === id); return e ? nomEquipement(e, referentiel) : null; }
    : null;
  const identifiees = (
    <PiecesIdentifieesListe
      selections={selections} erreur={erreurSelections} nomAppareil={nomAppareil} membres={membres}
      peutModifier={modifiable} onQuantite={(s, q) => enregistrer(photoDepuisIdentifiee(s, q))}
      action={peutCreerDevis && (
        <span className="inline-flex flex-wrap items-center justify-end gap-2">
          {etatDevis.raison && <span className="text-xs text-amber-800">{etatDevis.raison}</span>}
          <button
            type="button" onClick={creerDevis} disabled={!etatDevis.pret}
            className="btn-primary btn-sm inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <ShoppingCart className="w-4 h-4" />Créer un devis avec ces pièces
          </button>
        </span>
      )}
    />
  );

  // Rien à montrer de la nomenclature à qui ne peut pas choisir un modèle, quand aucun équipement n'en a.
  // L'assistant « Trouver une pièce » n'en dépend pas : module ouvert + droit suffisent (état local, rien d'enregistré).
  if (!canEdit && !liste.some((e) => e.equipment_model_id)) {
    const assistant = equipement && moduleActif(settings, 'assistant') && can('assistant_pieces', 'use');
    if (!assistant && !selections.length && !erreurSelections) return null;
    return (
      <div className="space-y-2">
        {identifiees}
        {assistant && selecteur}
        {assistant && <TrouverPieceButton key={`assistant-${equipement.id}`} equipment={equipement} interventionId={item.id} />}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">
        <Wrench className="w-4 h-4" />
        Pièces détachées de l&apos;appareil
      </h3>
      {identifiees}
      {selecteur}
      {liste.length === 1 && equipement && <p className="text-sm text-gray-600">{nomEquipement(equipement, referentiel)}</p>}
      {equipement && (
        <EquipmentPartsSection
          key={equipement.id}
          equipment={equipement}
          canEdit={canEdit}
          defaultOpen={!!equipement.equipment_model_id}
          onModelChanged={(id) => setModeles((prev) => ({ ...prev, [equipement.id]: id }))}
          quantites={quantites}
          onQuantiteChange={changerQuantite}
          selectionLectureSeule={!modifiable}
          onAtelierChange={(a) => changerAtelier(a.ouvert)}
        />
      )}
      {equipement && <TrouverPieceButton key={`assistant-${equipement.id}`} equipment={equipement} interventionId={item.id} />}
      {equipement && !equipement.equipment_model_id && !canEdit && (
        <p className="text-xs text-gray-500">Le modèle fabricant de cet appareil n&apos;a pas encore été choisi.</p>
      )}

      {lignesDevis && createPortal(
        <CreateDevisModal
          lead={leadDepuisCarteSav(item)}
          interventionId={item.id}
          initialFamily={lignesDevis.famille}
          initialLines={lignesDevis.lignes}
          onClose={() => setLignesDevis(null)}
          onCreated={() => onUpdated?.()}
        />,
        document.body,
      )}
    </div>
  );
}

export default SAVModelPartsSection;
