import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useClientEquipments, clientKeys } from '@hooks/useClients';
import { useClientContract, useContractEquipments, contractKeys } from '@hooks/useContracts';
import { contractsService } from '@services/contracts.service';
import { EquipmentList } from '@/apps/artisan/components/clients/EquipmentList';
import { EquipmentFormModal } from '@/apps/artisan/components/clients/EquipmentFormModal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export const TabEquipments = ({ clientId }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState(null);
  const [deletingEquipment, setDeletingEquipment] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const {
    equipments, isLoading,
    addEquipment, isAdding,
    updateEquipment, isUpdating,
    deleteEquipment,
  } = useClientEquipments(clientId);
  const { contract } = useClientContract(clientId);
  const { equipments: contractEquipments } = useContractEquipments(contract?.id);
  const queryClient = useQueryClient();

  const hasContract = !!contract?.id;
  const contractEquipmentIds = useMemo(() => {
    return new Set((contractEquipments || []).map(e => e.id));
  }, [contractEquipments]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: contractKeys.all });
    queryClient.invalidateQueries({ queryKey: clientKeys.equipments(clientId) });
    if (contract?.id) {
      queryClient.invalidateQueries({ queryKey: contractKeys.equipments(contract.id) });
    }
  };

  const handleOpenAdd = () => { setEditingEquipment(null); setShowModal(true); };
  const handleOpenEdit = (equipment) => { setEditingEquipment(equipment); setShowModal(true); };
  const handleCloseModal = () => { setShowModal(false); setEditingEquipment(null); };

  const handleAdd = async (formData) => {
    try {
      const result = await addEquipment({
        category: formData.category,
        equipmentTypeId: formData.equipmentTypeId,
        brand: formData.brand,
        model: formData.model,
        serialNumber: formData.serialNumber,
        installationYear: formData.installationYear,
        notes: formData.notes,
      });

      const equipmentId = result?.data?.id || result?.id;
      if (hasContract && equipmentId) {
        try {
          await contractsService.addEquipmentToContract(contract.id, equipmentId);
          await resetSignatureIfNeeded();
          invalidateAll();
          toast.success('Équipement ajouté et lié au contrat');
        } catch (linkError) {
          console.error('[TabEquipments] Erreur liaison contrat:', linkError);
          toast.success('Équipement ajouté (liaison contrat échouée)');
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

  const handleEdit = async (formData) => {
    try {
      await updateEquipment(editingEquipment.id, {
        category: formData.category,
        equipmentTypeId: formData.equipmentTypeId,
        brand: formData.brand,
        model: formData.model,
        serialNumber: formData.serialNumber,
        installationYear: formData.installationYear,
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
      // Si l’équipement supprimé était lié au contrat, invalider la signature
      if (hasContract && contractEquipmentIds.has(deletingEquipment.id)) {
        await resetSignatureIfNeeded();
      }
      await deleteEquipment(deletingEquipment.id);
      invalidateAll();
      toast.success('Équipement supprimé');
      setDeletingEquipment(null);
    } catch (error) {
      console.error('[TabEquipments] Erreur suppression:', error);
      toast.error('Erreur lors de la suppression');
    } finally {
      setIsDeleting(false);
    }
  };

  // Si le contrat est signé et qu’on modifie les équipements, invalider la signature
  const resetSignatureIfNeeded = async () => {
    if (contract?.signed_at) {
      await contractsService.resetContractSignature(contract.id);
      toast.info('Le contrat doit être re-signé car les équipements ont changé.');
    }
  };

  const handleAddToContract = async (equipment) => {
    if (!hasContract) return;
    try {
      await contractsService.addEquipmentToContract(contract.id, equipment.id);
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
      await contractsService.removeEquipmentFromContract(contract.id, equipment.id);
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
      />
      <EquipmentFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSubmit={editingEquipment ? handleEdit : handleAdd}
        isSubmitting={editingEquipment ? isUpdating : isAdding}
        equipment={editingEquipment}
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
