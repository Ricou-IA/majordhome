/**
 * CertificatsSection.jsx - Majord'home Artisan
 * ============================================================================
 * Section certificats multi-équipements intégrée dans EntretienSAVModal.
 *
 * Encapsule :
 * - Chargement des équipements du contrat
 * - Lazy create des interventions enfants (1 par équipement)
 * - Barre de progression
 * - Liste CertificatEquipmentRow avec actions Remplir/Néant
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardCheck } from 'lucide-react';
import { contractsService } from '@services/contracts.service';
import { equipmentsService } from '@services/equipments.service';
import { savService } from '@services/sav.service';
import { certificatsService } from '@services/certificats.service';
import { useCertificatChildren, useCertificatEntretienMutations } from '@hooks/useCertificatEntretien';
import { useInterventionCertificats } from '@hooks/useCertificats';
import { useTeamMembers } from '@hooks/useAppointments';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { certificatKeys } from '@hooks/cacheKeys';
import { unwrapResult } from '@/lib/serviceHelpers';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { formatDateForInput } from '@/lib/utils';
import {
  blocageConforme, brouillonRemplace, certificatAllegePayload, dateDePassage, peutAnnulerConforme,
} from '@/lib/certificatConformeModel';
import { sectionsPourProfil } from '@/apps/artisan/components/certificat/constants';
import { useAuth } from '@/contexts/AuthContext';
import { CertificatEquipmentRow } from './CertificatEquipmentRow';
import { CertificatConformeDialog } from './CertificatConformeDialog';
import { logger } from '@lib/logger';

// ============================================================================
// COMPOSANT
// ============================================================================

/**
 * @param {Object} props
 * @param {Object} props.item - Intervention parent (entretien)
 * @param {Function} props.onCloseModal - Ferme la modale parente (pour CertificatLink navigation)
 */
export function CertificatsSection({ item, onCloseModal }) {
  // --- Hooks certificats ---
  const { children, isLoading: childrenLoading, refetch } = useCertificatChildren(item?.id);
  const {
    createChildren, markNeant, unmarkNeant, completeParent,
    poserConforme, regenererConforme, annulerConforme, isPosingConforme,
  } = useCertificatEntretienMutations();
  const { organization, user, isTeamLeaderOrAbove } = useAuth();
  const orgId = organization?.id;

  // --- Certificat « Conforme » allégé (bureau seulement, spec 2026-11-16) ---
  // Les certificats de la carte disent ce qui existe déjà sur chaque ligne (brouillon du
  // technicien, anomalie notée). Liste inconnue (chargement, erreur) ⇒ geste fermé : on ne pose
  // pas « conforme » par-dessus un certificat qu'on n'a pas pu lire.
  const { certificats, isLoading: certificatsLoading, error: certificatsError } =
    useInterventionCertificats(orgId, item?.id);
  const certByChildId = useMemo(
    () => Object.fromEntries((certificats || []).map((c) => [c.intervention_id, c])),
    [certificats],
  );
  const peutPoserConforme = !!isTeamLeaderOrAbove && !certificatsLoading && !certificatsError;
  const { members: teamMembers } = useTeamMembers(isTeamLeaderOrAbove ? orgId : null);
  const { settings } = useOrgSettings();
  const { index: referentiel } = useEquipmentReferential();
  const [conformeChild, setConformeChild] = useState(null);
  const { data: rdvTechnicianIds, isLoading: rdvTechLoading } = useQuery({
    queryKey: certificatKeys.rdvTechniciens(orgId, item?.id),
    queryFn: () => unwrapResult(certificatsService.listRdvTechnicianIds(item.id)),
    enabled: !!orgId && !!item?.id && !!conformeChild,
    staleTime: 60_000,
  });

  // --- State local ---
  const [equipments, setEquipments] = useState([]);
  const [equipmentsLoading, setEquipmentsLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState(null);
  const creatingRef = useRef(false);
  const selfHealRef = useRef(false);

  // Contrat effectif : photo `contract_id` si posée, sinon contrat actif du client
  // dérivé par la vue (migration 20260728_1). Voir EntretienSAVModal pour le détail.
  const contractId = item?.effective_contract_id || item?.contract_id || null;

  // --- Charger les équipements du contrat (fallback: équipements du client) ---
  useEffect(() => {
    if (!contractId) {
      setEquipmentsLoading(false);
      return;
    }
    contractsService.getContractEquipments(contractId).then(async ({ data }) => {
      if (data && data.length > 0) {
        setEquipments(data);
      } else if (item.client_id) {
        // Fallback : contrats legacy sans contract_equipments
        const fallback = await equipmentsService.getClientEquipments(item.client_id);
        setEquipments(fallback.data || []);
      }
      setEquipmentsLoading(false);
    });
  }, [contractId, item?.client_id]);

  // --- Derived ---
  const childByEquipId = Object.fromEntries(children.map((c) => [c.equipment_id, c]));
  const equipmentIds = new Set(equipments.map((eq) => eq.id));
  // Enfants dont l'équipement n'est plus dans le contrat (retiré / supprimé) et qui
  // ont été conservés par la base parce qu'ils ne sont pas vierges (néant, certificat).
  // Les vierges sont purgés par trigger (20260922_2) ; s'il en reste un, on le montre
  // quand même : invisible, il bloquait la clôture (GOMES CTR-00821, 2026-09-22).
  const orphanChildren = children.filter((c) => !c.equipment_id || !equipmentIds.has(c.equipment_id));
  const doneCount = children.filter((c) => c.workflow_status === 'realise').length;
  const totalCount = children.length;

  // --- Réconciliation : un enfant par équipement du contrat. Crée les manquants
  // (première ouverture, ou équipement ajouté au contrat après coup). ---
  useEffect(() => {
    if (creatingRef.current || childrenLoading || equipmentsLoading || !item) return;
    const covered = new Set(children.map((c) => c.equipment_id));
    const missing = equipments.filter((eq) => !covered.has(eq.id));
    if (missing.length === 0) return;

    creatingRef.current = true;
    createChildren(item.id, missing, {
      projectId: item.project_id || item.client_project_id,
      clientId: item.client_id,
      contractId,
    }).then(() => {
      // Rattrapage de la photo : la carte a été créée avant que le contrat n'existe
      // (ou avant qu'il ne passe en `active`). On grave le lien maintenant qu'il est
      // dérivé et réellement utilisé — les certificats enfants viennent d'être créés
      // dessus. Best effort : la vue continue de dériver si l'écriture échoue.
      if (contractId && !item.contract_id) {
        savService.updateFields(item.id, { contract_id: contractId })
          .catch((err) => logger.warn('[CertificatsSection] backfill contract_id:', err));
      }
      refetch();
    }).catch(() => {
      // Toast d'erreur déjà émis par le hook (onError) ; pas de nouvelle tentative
      // automatique — l'utilisateur rouvre la modale pour relancer.
    });
  }, [childrenLoading, equipmentsLoading, children, equipments, item, contractId, createChildren, refetch]);

  // --- Handlers (toasts d'erreur émis par le hook) ---
  const handleMarkNeant = useCallback(async (childId) => {
    setMutatingId(childId);
    try { await markNeant(childId, item.id); } catch { /* toast émis par le hook */ } finally { setMutatingId(null); }
  }, [markNeant, item?.id]);

  const handleUnmarkNeant = useCallback(async (childId) => {
    setMutatingId(childId);
    try { await unmarkNeant(childId, item.id); } catch { /* toast émis par le hook */ } finally { setMutatingId(null); }
  }, [unmarkNeant, item?.id]);

  // --- Certificat « Conforme » : ce que la fenêtre et la lettre lisent de la ligne choisie ---
  const lettreCtxPour = useCallback((equipment) => {
    const type = equipment?.equipment_type_id ? referentiel.typesById.get(equipment.equipment_type_id) : null;
    const categorie = equipment?.category_id ? referentiel.categoriesById.get(equipment.category_id) : null;
    return {
      appareil: type?.label || categorie?.label || null,
      contractNumber: item?.contract_number || null,
      client: {
        name: item?.client_name || `${item?.client_first_name || ''} ${item?.client_last_name || ''}`.trim(),
        address: item?.client_address,
        postal_code: item?.client_postal_code,
        city: item?.client_city,
      },
      company: buildCompanyInfo(settings),
      orgId,
    };
  }, [referentiel, item, settings, orgId]);

  const conformeEquipment = conformeChild ? equipments.find((eq) => eq.id === conformeChild.equipment_id) || null : null;
  const conformeCategorie = conformeEquipment?.category_id ? referentiel.categoriesById.get(conformeEquipment.category_id) : null;
  const conformeExistant = conformeChild ? certByChildId[conformeChild.id] || null : null;
  const conformeBlocage = !conformeChild ? null
    : !conformeCategorie
      ? 'Cet équipement n’a pas de catégorie : renseignez-la sur la fiche client avant de poser le certificat.'
      : blocageConforme(conformeExistant);
  const today = formatDateForInput(new Date());

  const handleConfirmConforme = async ({ date, technicienId, ramonage }) => {
    if (!conformeChild || !conformeEquipment || !conformeCategorie) return;
    const technicien = teamMembers.find((m) => m.id === technicienId);
    const payload = certificatAllegePayload({
      interventionId: conformeChild.id,
      clientId: item.client_id,
      equipmentId: conformeEquipment.id,
      contractId: contractId || null,
      orgId,
      userId: user?.id || null,
      equipement: {
        code: conformeCategorie.code,
        marque: conformeEquipment.brand,
        modele: conformeEquipment.model,
        numeroSerie: conformeEquipment.serial_number,
      },
      tvaTaux: referentiel.tvaParCode(conformeCategorie.code),
      technicien: { id: technicien?.id || null, nom: technicien?.display_name || '' },
      date,
      ramonage,
    });
    try {
      await poserConforme({
        payload, childId: conformeChild.id, parentId: item.id, lettreCtx: lettreCtxPour(conformeEquipment),
      });
      setConformeChild(null);
    } catch { /* toast émis par le hook ; la fenêtre reste ouverte pour réessayer */ }
  };

  // « Voir certificat » d'une ligne conforme : le PDF archivé, régénéré s'il manque (jamais la
  // saisie complète, qui écraserait un certificat allégé).
  const handleVoirConforme = useCallback(async (child) => {
    const certificat = certByChildId[child.id];
    if (!certificat) return;
    setMutatingId(child.id);
    try {
      let path = certificat.pdf_storage_path;
      if (!path) {
        const equipment = equipments.find((eq) => eq.id === child.equipment_id) || null;
        const regen = await regenererConforme({ certificat, parentId: item.id, lettreCtx: lettreCtxPour(equipment) });
        path = regen.storagePath;
      }
      const { data: url } = await certificatsService.getSignedUrl(path);
      if (url) window.open(url, '_blank');
      else toast.error('Lien vers le document indisponible.');
    } catch { /* toast émis par le hook */ } finally { setMutatingId(null); }
  }, [certByChildId, equipments, regenererConforme, lettreCtxPour, item?.id]);

  const handleAnnulerConforme = useCallback(async (child) => {
    const certificat = certByChildId[child.id];
    if (!certificat) return;
    setMutatingId(child.id);
    try { await annulerConforme({ certificat, childId: child.id, parentId: item.id }); }
    catch { /* toast émis par le hook */ } finally { setMutatingId(null); }
  }, [certByChildId, annulerConforme, item?.id]);

  const conformeRowProps = (child) => ({
    certificat: child ? certByChildId[child.id] || null : null,
    canConforme: peutPoserConforme,
    onConforme: setConformeChild,
    onVoirConforme: handleVoirConforme,
    canAnnulerConforme: !!isTeamLeaderOrAbove && peutAnnulerConforme(item),
    onAnnulerConforme: handleAnnulerConforme,
  });

  // --- Self-healing : si tous les enfants sont done mais le parent est encore planifie,
  // déclencher la clôture automatique. Couvre les cas legacy où la transition manquait. ---
  useEffect(() => {
    if (selfHealRef.current) return;
    if (childrenLoading || equipmentsLoading) return;
    if (totalCount === 0 || doneCount !== totalCount) return;
    if (!item || item.workflow_status !== 'planifie') return;
    if (!organization?.id) return;

    selfHealRef.current = true;
    completeParent(item.id, organization.id).catch((err) => {
      logger.warn('[CertificatsSection] self-heal completeParent error:', err);
      selfHealRef.current = false;
    });
  }, [
    childrenLoading,
    equipmentsLoading,
    doneCount,
    totalCount,
    item,
    organization?.id,
    completeParent,
  ]);

  // Ne rien afficher si pas encore chargé ou pas d'équipements
  if (equipmentsLoading || equipments.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4" />
        Certificats
      </h3>

      {/* Barre de progression */}
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-secondary-200 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              doneCount === totalCount ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
          />
        </div>
        <span className="text-xs text-secondary-500">{doneCount}/{totalCount}</span>
      </div>

      {/* Liste équipements */}
      {equipments.map((eq) => (
        <CertificatEquipmentRow
          key={eq.id}
          equipment={eq}
          childIntervention={childByEquipId[eq.id] || null}
          onMarkNeant={handleMarkNeant}
          onUnmarkNeant={handleUnmarkNeant}
          isLoading={mutatingId === childByEquipId[eq.id]?.id}
          onCloseModal={onCloseModal}
          {...conformeRowProps(childByEquipId[eq.id] || null)}
        />
      ))}

      {/* Enfants conservés dont l'équipement a quitté le contrat */}
      {orphanChildren.map((child) => (
        <CertificatEquipmentRow
          key={child.id}
          equipment={null}
          orphan
          childIntervention={child}
          onMarkNeant={handleMarkNeant}
          onUnmarkNeant={handleUnmarkNeant}
          isLoading={mutatingId === child.id}
          onCloseModal={onCloseModal}
          {...conformeRowProps(child)}
        />
      ))}

      {isTeamLeaderOrAbove && (
        <CertificatConformeDialog
          open={!!conformeChild}
          onOpenChange={(open) => { if (!open) setConformeChild(null); }}
          equipmentLabel={[lettreCtxPour(conformeEquipment).appareil, conformeEquipment?.brand, conformeEquipment?.model].filter(Boolean).join(' · ') || 'Équipement'}
          defaultDate={dateDePassage(item?.scheduled_date, today)}
          today={today}
          technicians={teamMembers}
          defaultTechnicianId={rdvTechnicianIds?.length === 1 ? rdvTechnicianIds[0] : null}
          loadingTechnician={rdvTechLoading}
          showRamonage={sectionsPourProfil(conformeCategorie?.certificate_profile).showRamonage}
          blocage={conformeBlocage}
          remplaceBrouillon={brouillonRemplace(conformeExistant)}
          loading={isPosingConforme}
          onConfirm={handleConfirmConforme}
        />
      )}
    </div>
  );
}
