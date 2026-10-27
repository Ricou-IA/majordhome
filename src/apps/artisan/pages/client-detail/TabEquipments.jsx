import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useClientEquipments, usePricingEquipmentTypes, clientKeys } from '@hooks/useClients';
import { useClientContract, useContractEquipments, contractKeys } from '@hooks/useContracts';
import { useProductDocumentsByProductIds } from '@hooks/useSuppliers';
import { useEquipmentModelDocuments, useEquipmentDocumentMutations } from '@hooks/useEquipmentDocuments';
import { useCanAccess } from '@hooks/usePermissions';
import { contractsService } from '@services/contracts.service';
import { equipmentsService } from '@services/equipments.service';
import { reduireImage } from '@/lib/imageResize';
import { EquipmentList } from '@/apps/artisan/components/clients/EquipmentList';
import { EquipmentFormModal } from '@/apps/artisan/components/clients/EquipmentFormModal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export const TabEquipments = ({ clientId, prefillDraft = null, onPrefillConsumed }) => {
  const { organization, effectiveRole } = useAuth();
  const orgId = organization?.id;
  const { can } = useCanAccess();
  const [showModal, setShowModal] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState(null);
  const [isUploadingNameplate, setIsUploadingNameplate] = useState(false);
  const [prefillEquipment, setPrefillEquipment] = useState(null);
  const [deletingEquipment, setDeletingEquipment] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const {
    equipments, isLoading,
    addEquipment, isAdding,
    updateEquipment, isUpdating,
    deleteEquipment,
  } = useClientEquipments(clientId);
  const { equipmentTypes } = usePricingEquipmentTypes();
  const { contract } = useClientContract(clientId);
  // Mutations du hook (mutateAsync rejette sur refus) : un appel direct au service
  // renverrait `{ error }` sans throw et le catch ne verrait jamais le refus.
  const {
    equipments: contractEquipments,
    error: contractEquipmentsError,
    addEquipment: addEquipmentToContract,
    removeEquipment: removeEquipmentFromContract,
  } = useContractEquipments(contract?.id);
  const queryClient = useQueryClient();

  // Si la liste des liens ne charge pas, tout apparaît « Hors contrat » : le dire,
  // sinon l'écran invite à rattacher des équipements qui le sont déjà.
  useEffect(() => {
    if (!contractEquipmentsError) return;
    console.error('[TabEquipments] Liens contrat illisibles:', contractEquipmentsError);
    toast.error('Les équipements liés au contrat n\'ont pas pu être chargés — le statut affiché n\'est pas fiable.');
  }, [contractEquipmentsError]);

  const hasContract = !!contract?.id;
  const contractEquipmentIds = useMemo(() => {
    return new Set((contractEquipments || []).map(e => e.id));
  }, [contractEquipments]);

  // Récupérer les docs des produits liés aux équipements
  const linkedProductIds = useMemo(() => {
    return [...new Set(equipments.filter(e => e.supplier_product_id).map(e => e.supplier_product_id))];
  }, [equipments]);
  const { documents: allProductDocs } = useProductDocumentsByProductIds(linkedProductIds);

  // Map productId → documents[]
  const productDocumentsMap = useMemo(() => {
    const map = {};
    for (const doc of allProductDocs) {
      if (!map[doc.supplier_product_id]) map[doc.supplier_product_id] = [];
      map[doc.supplier_product_id].push(doc);
    }
    return map;
  }, [allProductDocs]);

  // Documents du modèle (notice, vue éclatée) : partagés par marque + modèle, lus par equipment_id.
  // Dépôt = droit clients.edit (le technicien peut) ; retrait = org_admin seul (comme toute suppression).
  const equipmentIds = useMemo(() => equipments.map((e) => e.id), [equipments]);
  const { documentsByEquipmentId: modelDocumentsMap } = useEquipmentModelDocuments(equipmentIds);
  const { upload: uploadModelDocument, remove: removeModelDocument } = useEquipmentDocumentMutations();
  const handleUploadDocument = (equipment, payload) => uploadModelDocument({ equipment, ...payload });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: clientKeys.equipments(orgId, clientId) });
    if (contract?.id) {
      queryClient.invalidateQueries({ queryKey: contractKeys.equipments(orgId, contract.id) });
    }
  };

  const handleOpenAdd = () => { setEditingEquipment(null); setShowModal(true); };
  const handleOpenEdit = (equipment) => { setEditingEquipment(equipment); setShowModal(true); };
  const handleCloseModal = () => {
    setShowModal(false);
    setEditingEquipment(null);
    setPrefillEquipment(null);
  };

  // Pré-remplissage venu de l'investigation bâtiment (panneau DPE de la fiche).
  // La catégorie deduite du DPE est resolue vers un type de LA grille de l'org :
  // `equipment_type_id` lui est propre, on ne peut pas le deviner en dur.
  // Aucun type correspondant → on ouvre quand même la modale, l'utilisateur
  // choisit ; mieux vaut un formulaire à compléter qu'un bouton sans effet.
  useEffect(() => {
    if (!prefillDraft) return;
    const match = equipmentTypes.find((t) => t.equipment_category === prefillDraft.category);
    setPrefillEquipment({
      equipment_type_id: match?.id || '',
      installation_year: prefillDraft.installationYear || '',
      notes: prefillDraft.notes || '',
    });
    setEditingEquipment(null); // reste en mode AJOUT → onSubmit = handleAdd
    setShowModal(true);
    onPrefillConsumed?.();
  }, [prefillDraft, equipmentTypes, onPrefillConsumed]);

  const handleAdd = async (formData) => {
    try {
      const payload = {
        equipmentTypeId: formData.equipmentTypeId,
        brand: formData.brand,
        model: formData.model,
        serialNumber: formData.serialNumber,
        installationYear: formData.installationYear,
        installationType: formData.installationType,
        supplierProductId: formData.supplierProductId,
        unitCount: formData.quantity || 1,
        notes: formData.notes,
      };

      const result = await addEquipment(payload);
      const eqId = result?.data?.id || result?.id;

      if (hasContract && eqId) {
        try {
          await addEquipmentToContract(eqId);
          await resetSignatureIfNeeded();
          invalidateAll();
          toast.success('Équipement ajouté et lié au contrat');
        } catch (linkError) {
          // L'équipement existe, seule la liaison a été refusée : le dire tel quel
          console.error('[TabEquipments] Erreur liaison contrat:', linkError);
          toast.warning('Équipement ajouté, mais la liaison au contrat a échoué');
        }
      } else {
        toast.success('Équipement ajouté');
      }
      handleCloseModal();
    } catch (error) {
      console.error('[TabEquipments] Erreur ajout équipement:', error);
      toast.error('Erreur lors de l\'ajout de l\'équipement');
    }
  };

  // Photo de la plaque signalétique depuis la fiche équipement (réduite à 1600 px, bucket certificats).
  // Le service renvoie { error } sans throw : on le lit, sinon un refus Storage passerait pour un succès.
  const handleNameplateUpload = async (file) => {
    if (!editingEquipment?.id || !orgId) return;
    setIsUploadingNameplate(true);
    try {
      const blob = await reduireImage(file);
      const { data, error } = await equipmentsService.uploadNameplatePhoto(orgId, clientId, editingEquipment.id, blob);
      if (error) throw error;
      await updateEquipment(editingEquipment.id, { nameplatePhotoPath: data.storagePath });
      setEditingEquipment((prev) => (prev ? { ...prev, nameplate_photo_path: data.storagePath } : prev));
      invalidateAll();
      toast.success('Photo de la plaque enregistrée');
    } catch (error) {
      console.error('[TabEquipments] photo plaque:', error);
      toast.error(`Photo non enregistrée : ${error?.message || 'erreur inconnue'}`);
      throw error;
    } finally {
      setIsUploadingNameplate(false);
    }
  };

  const handleNameplateDelete = async (storagePath) => {
    if (!editingEquipment?.id) return;
    setIsUploadingNameplate(true);
    try {
      const { error } = await equipmentsService.deleteNameplatePhoto(storagePath);
      if (error) throw error;
      await updateEquipment(editingEquipment.id, { nameplatePhotoPath: null });
      setEditingEquipment((prev) => (prev ? { ...prev, nameplate_photo_path: null } : prev));
      invalidateAll();
    } catch (error) {
      console.error('[TabEquipments] suppression photo plaque:', error);
      toast.error(`Photo non supprimée : ${error?.message || 'erreur inconnue'}`);
      throw error;
    } finally {
      setIsUploadingNameplate(false);
    }
  };

  const handleEdit = async (formData) => {
    try {
      await updateEquipment(editingEquipment.id, {
        equipmentTypeId: formData.equipmentTypeId,
        brand: formData.brand,
        model: formData.model,
        serialNumber: formData.serialNumber,
        installationYear: formData.installationYear,
        installationType: formData.installationType,
        supplierProductId: formData.supplierProductId,
        unitCount: formData.quantity || 1,
        notes: formData.notes,
      });
      toast.success('Équipement mis à jour');
      invalidateAll();
      handleCloseModal();
    } catch (error) {
      console.error('[TabEquipments] Erreur modification équipement:', error);
      toast.error('Erreur lors de la modification');
    }
  };

  const handleDelete = (equipment) => { setDeletingEquipment(equipment); };

  const confirmDelete = async () => {
    if (!deletingEquipment) return;
    setIsDeleting(true);
    try {
      // Si l’équipement supprimé était lié au contrat, invalider la signature.
      // Refus de la base → on ne supprime pas : un contrat signé ne doit pas
      // perdre un équipement en restant « signé ».
      if (hasContract && contractEquipmentIds.has(deletingEquipment.id)) {
        const ok = await resetSignatureIfNeeded();
        if (!ok) return;
      }
      await deleteEquipment(deletingEquipment.id);
      invalidateAll();
      toast.success('Équipement supprimé');
      setDeletingEquipment(null);
    } catch (error) {
      console.error('[TabEquipments] Erreur suppression:', error);
      // 23503 = la base refuse : une autre ligne pointe encore vers cet équipement
      toast.error(
        error?.code === '23503'
          ? 'Suppression refusée : cet équipement est encore référencé par un autre enregistrement.'
          : 'Erreur lors de la suppression'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  // Si le contrat est signé et qu’on modifie les équipements, invalider la signature.
  // Le service ne throw jamais (`{ data, error }`) : on lit `error` et on le dit,
  // sinon le contrat resterait signé en silence. Retourne false sur refus.
  const resetSignatureIfNeeded = async () => {
    if (!contract?.signed_at) return true;
    const { error } = await contractsService.resetContractSignature(contract.id);
    if (error) {
      console.error('[TabEquipments] Erreur invalidation signature:', error);
      toast.error('Le contrat signé n’a pas pu être remis en attente de signature.');
      return false;
    }
    toast.info('Le contrat doit être re-signé car les équipements ont changé.');
    return true;
  };

  const handleAddToContract = async (equipment) => {
    if (!hasContract) return;
    try {
      const link = await addEquipmentToContract(equipment.id);
      // Déjà lié : rien n'a changé, donc pas de re-signature à demander.
      if (link?.alreadyLinked) {
        invalidateAll();
        toast.info('Cet équipement était déjà lié au contrat');
        return;
      }
      await resetSignatureIfNeeded();
      invalidateAll();
      toast.success('Équipement ajouté au contrat');
    } catch (error) {
      console.error('[TabEquipments] Erreur liaison contrat:', error);
      toast.error('Erreur lors de la liaison au contrat');
    }
  };

  const handleRemoveFromContract = async (equipment) => {
    if (!hasContract) return;
    try {
      await removeEquipmentFromContract(equipment.id);
      await resetSignatureIfNeeded();
      invalidateAll();
      toast.success('Équipement retiré du contrat');
    } catch (error) {
      console.error('[TabEquipments] Erreur retrait contrat:', error);
      toast.error('Erreur lors du retrait du contrat');
    }
  };

  return (
    <>
      <EquipmentList
        equipments={equipments}
        loading={isLoading}
        onAdd={handleOpenAdd}
        onEdit={handleOpenEdit}
        onDelete={handleDelete}
        onAddToContract={hasContract ? handleAddToContract : undefined}
        onRemoveFromContract={hasContract ? handleRemoveFromContract : undefined}
        hasContract={hasContract}
        contractEquipmentIds={contractEquipmentIds}
        productDocumentsMap={productDocumentsMap}
        modelDocumentsMap={modelDocumentsMap}
        canUploadDocument={can('clients', 'edit')}
        canDeleteDocument={effectiveRole === 'org_admin'}
        onUploadDocument={handleUploadDocument}
        onDeleteDocument={removeModelDocument}
      />
      <EquipmentFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSubmit={editingEquipment ? handleEdit : handleAdd}
        isSubmitting={editingEquipment ? isUpdating : isAdding}
        orgId={orgId}
        equipment={editingEquipment || prefillEquipment}
        onNameplateUpload={editingEquipment ? handleNameplateUpload : null}
        onNameplateDelete={editingEquipment ? handleNameplateDelete : null}
        isUploadingNameplate={isUploadingNameplate}
      />
      <ConfirmDialog
        open={!!deletingEquipment}
        onOpenChange={(open) => { if (!open) setDeletingEquipment(null); }}
        title="Supprimer l'équipement"
        description={
          deletingEquipment
            ? `Voulez-vous vraiment supprimer l'équipement "${[deletingEquipment.brand, deletingEquipment.model].filter(Boolean).join(' ')}" ? Cette action est irréversible.`
            : ''
        }
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={confirmDelete}
        loading={isDeleting}
      />
    </>
  );
};
