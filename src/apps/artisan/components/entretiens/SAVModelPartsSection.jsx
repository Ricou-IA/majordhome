/**
 * SAVModelPartsSection.jsx — Pièces détachées de l'appareil, dans la fiche SAV
 * ============================================================================
 * Le bloc « Pièces détachées » (vue éclatée + nomenclature du modèle fabricant) pour l'équipement du SAV, ou celui
 * que l'on choisit parmi les équipements du client. Les pièces cochées partent dans un NOUVEAU devis fléché vers la carte
 * (même fenêtre que « Créer un devis » de la fiche : aucun lead, devis sur le client), rangées sous le chapitre
 * « PIÈCES » de la famille « Dépannage / SAV », au prix public.
 * ============================================================================
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Wrench } from 'lucide-react';
import { useCanAccess } from '@hooks/usePermissions';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildDefaultSections } from '@services/devis.service';
import { buildDevisConfig, famillesActives, tvaFamille } from '@/lib/devisConfig';
import { lignesDevisAvecPieces } from '@/lib/catalogue/nomenclature';
import { leadDepuisCarteSav } from '@/lib/savDevis';
import { libelleEquipement } from '@/lib/equipmentReferential';
import { EquipmentPartsSection } from '../equipements/EquipmentPartsSection';
import CreateDevisModal from '../devis/CreateDevisModal';

const nomEquipement = (eq, referentiel) => [libelleEquipement(eq, referentiel), eq.brand, eq.model].filter(Boolean).join(' · ');

/**
 * @param {object} p
 * @param {object} p.item carte SAV (ligne de `majordhome_entretien_sav`)
 * @param {object[]} p.equipements équipements du client
 * @param {object} p.referentiel index du référentiel d'équipements (libellés)
 * @param {boolean} [p.canEdit] peut choisir le modèle fabricant et créer un devis depuis la fiche
 * @param {() => void} [p.onUpdated] rafraîchir le kanban après la création d'un devis
 */
export function SAVModelPartsSection({ item, equipements = [], referentiel, canEdit = false, onUpdated }) {
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

  const [lignesDevis, setLignesDevis] = useState(null);
  const [versionSelection, setVersionSelection] = useState(0); // incrémentée quand le devis est créé : vide la sélection
  const familleSav = useMemo(() => famillesActives(config).find((f) => f.key === 'sav') || null, [config]);
  const peutCreerDevis = canEdit && can('devis', 'create') && !!item?.client_id;

  const ajouterAuDevis = (choix) => {
    const label = familleSav?.label || '';
    const sections = label ? buildDefaultSections(label, config) : [];
    setLignesDevis({ famille: label, lignes: lignesDevisAvecPieces(sections, choix, tvaFamille(config, label)) });
  };

  if (!liste.length) return null;
  // Rien à montrer à qui ne peut pas choisir un modèle, quand aucun équipement n'en a.
  if (!canEdit && !liste.some((e) => e.equipment_model_id)) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">
        <Wrench className="w-4 h-4" />
        Pièces détachées de l&apos;appareil
      </h3>
      {liste.length > 1 && (
        <select
          value={choisi || ''} onChange={(e) => setChoisi(e.target.value)} aria-label="Appareil concerné"
          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
        >
          {liste.map((e) => <option key={e.id} value={e.id}>{nomEquipement(e, referentiel)}{e.id === item?.equipment_id ? ' (appareil du SAV)' : ''}</option>)}
        </select>
      )}
      {liste.length === 1 && equipement && <p className="text-sm text-gray-600">{nomEquipement(equipement, referentiel)}</p>}
      {equipement && (
        <EquipmentPartsSection
          key={equipement.id}
          equipment={equipement}
          canEdit={canEdit}
          defaultOpen={!!equipement.equipment_model_id}
          onModelChanged={(modelId) => setModeles((prev) => ({ ...prev, [equipement.id]: modelId }))}
          onAddToQuote={peutCreerDevis ? ajouterAuDevis : null}
          selectionVersion={versionSelection}
        />
      )}
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
          onCreated={() => { setVersionSelection((v) => v + 1); onUpdated?.(); }}
        />,
        document.body,
      )}
    </div>
  );
}

export default SAVModelPartsSection;
