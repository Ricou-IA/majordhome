/**
 * FicheTechniqueModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale orchestrateur pour la Fiche Technique Terrain.
 *
 * - Plein écran (overlay centré)
 * - Header sticky : titre + nom client + badge statut + badge verrouillé
 * - Body scrollable avec les 5 sections
 * - Auto-save sur blur de chaque champ (via autoSave mutation)
 * - Création lazy : fiche créée en DB au premier champ modifié
 * - Lock après "Gagné" avec déblocage exceptionnel via ConfirmDialog
 * ============================================================================
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { X, Loader2, Lock, Unlock, FileText, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { technicalVisitService } from '@services/technicalVisit.service';
import {
  useTechnicalVisit,
  useTechnicalVisitPhotos,
  useTechnicalVisitMutations,
} from '@hooks/useTechnicalVisit';
import { useLeadCommercials } from '@hooks/useLeads';
import {
  FICHE_STATUS_CONFIG,
  computeVisitStatus,
} from './FicheTechniqueConfig';
import {
  SectionContexte,
  SectionBatiment,
  SectionReleveTechnique,
  SectionPhotos,
  SectionSynthese,
} from './FicheTechniqueFormSections';

// ============================================================================
// DEFAULT FORM STATE
// ============================================================================

const DEFAULT_FORM = {
  visit_date: new Date().toISOString().split('T')[0],
  commercial_id: null,
  commercial_name: '',
  project_type: '',
  // Bâtiment
  building_type: null,
  building_surface: '',
  building_year: '',
  building_levels: '',
  building_rooms: '',
  insulation_type: null,
  glazing_type: null,
  dpe_rating: null,
  dpe_number: '',
  // Installation existante
  existing_energy: null,
  existing_equipment_type: '',
  existing_brand_model: '',
  existing_year: '',
  existing_condition: null,
  existing_ecs: null,
  existing_ac: null,
  existing_ac_type: null,
  existing_observations: '',
  // Contraintes
  outdoor_access: null,
  electrical_panel_ok: null,
  electrical_panel_notes: '',
  specific_constraints: '',
  // Synthèse
  key_points: '',
  product_recommendation: '',
  // Next steps
  next_devis: false,
  next_etude_technique: false,
  next_visite_complementaire: false,
  next_dossier_aides: false,
  next_rdv_signature: false,
  next_other: false,
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function FicheTechniqueModal({ lead, isOpen, onClose }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const userId = user?.id;

  // Données
  const { visit, isLoading, refresh } = useTechnicalVisit(lead?.id);
  const { photos, refresh: refreshPhotos } = useTechnicalVisitPhotos(visit?.id);
  const { commercials } = useLeadCommercials(orgId);

  // Résoudre le nom du commercial assigné au lead
  const resolvedCommercialName = useMemo(() => {
    if (!lead?.assigned_user_id || !commercials?.length) return '';
    const found = commercials.find((c) => c.id === lead.assigned_user_id);
    return found?.full_name || '';
  }, [lead?.assigned_user_id, commercials]);
  const {
    createVisit,
    updateVisit,
    autoSave,
    lockVisit,
    unlockVisit,
    uploadPhoto,
    deletePhoto,
    isCreating,
    isSaving,
    isLocking,
    isUnlocking,
    isUploadingPhoto,
    isDeletingPhoto,
  } = useTechnicalVisitMutations();

  // État local
  const [form, setForm] = useState(DEFAULT_FORM);
  const [visitId, setVisitId] = useState(null);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const isCreatingRef = useRef(false);

  const isLocked = visit?.locked === true;
  const disabled = isLocked;

  // Statut calculé
  const status = computeVisitStatus(visit || form);
  const statusConfig = FICHE_STATUS_CONFIG[status] || FICHE_STATUS_CONFIG.not_started;

  // Initialiser le formulaire quand la fiche est chargée
  useEffect(() => {
    if (visit) {
      setVisitId(visit.id);
      setForm((prev) => ({
        ...prev,
        visit_date: visit.visit_date || prev.visit_date,
        commercial_id: visit.commercial_id || prev.commercial_id,
        commercial_name: visit.commercial_name || resolvedCommercialName || prev.commercial_name,
        project_type: visit.project_type || prev.project_type,
        building_type: visit.building_type,
        building_surface: visit.building_surface ?? '',
        building_year: visit.building_year ?? '',
        building_levels: visit.building_levels ?? '',
        building_rooms: visit.building_rooms ?? '',
        insulation_type: visit.insulation_type,
        glazing_type: visit.glazing_type,
        dpe_rating: visit.dpe_rating,
        dpe_number: visit.dpe_number || '',
        existing_energy: visit.existing_energy,
        existing_equipment_type: visit.existing_equipment_type || '',
        existing_brand_model: visit.existing_brand_model || '',
        existing_year: visit.existing_year ?? '',
        existing_condition: visit.existing_condition,
        existing_ecs: visit.existing_ecs,
        existing_ac: visit.existing_ac,
        existing_ac_type: visit.existing_ac_type,
        existing_observations: visit.existing_observations || '',
        outdoor_access: visit.outdoor_access,
        electrical_panel_ok: visit.electrical_panel_ok,
        electrical_panel_notes: visit.electrical_panel_notes || '',
        specific_constraints: visit.specific_constraints || '',
        key_points: visit.key_points || '',
        product_recommendation: visit.product_recommendation || '',
        next_devis: visit.next_devis || false,
        next_etude_technique: visit.next_etude_technique || false,
        next_visite_complementaire: visit.next_visite_complementaire || false,
        next_dossier_aides: visit.next_dossier_aides || false,
        next_rdv_signature: visit.next_rdv_signature || false,
        next_other: visit.next_other || false,
      }));
    } else if (lead && !visit) {
      // Pré-remplir depuis le lead
      setVisitId(null);
      setForm({
        ...DEFAULT_FORM,
        commercial_id: lead.assigned_user_id || null,
        commercial_name: resolvedCommercialName,
        project_type: lead.equipment_type_label || '',
      });
    }
  }, [visit, lead, resolvedCommercialName]);

  // Setter champ local
  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Créer la fiche lazy (premier auto-save)
  const ensureVisitExists = useCallback(async () => {
    if (visitId || isCreatingRef.current) return visitId;

    isCreatingRef.current = true;
    try {
      const newVisit = await createVisit({
        lead_id: lead.id,
        org_id: orgId,
        visit_date: form.visit_date,
        commercial_id: form.commercial_id || userId,
        commercial_name: form.commercial_name || user?.full_name || '',
        project_type: form.project_type,
        created_by: userId,
      });
      setVisitId(newVisit.id);
      return newVisit.id;
    } catch (err) {
      console.error('[FicheTechniqueModal] create error:', err);
      toast.error('Erreur lors de la création de la fiche');
      return null;
    } finally {
      isCreatingRef.current = false;
    }
  }, [visitId, lead?.id, orgId, userId, user?.full_name, form.visit_date, form.commercial_id, form.commercial_name, form.project_type, createVisit]);

  // Auto-save on blur
  const handleAutoSave = useCallback(async (field, value) => {
    const vId = visitId || (await ensureVisitExists());
    if (!vId) return;

    try {
      await autoSave(vId, field, value, lead?.id);
    } catch (err) {
      console.error('[FicheTechniqueModal] autoSave error:', err);
      // Pas de toast pour les auto-saves (trop intrusif)
    }
  }, [visitId, ensureVisitExists, autoSave, lead?.id]);

  // Photos groupées par catégorie
  const photosByCategory = useMemo(() => {
    const grouped = {};
    (photos || []).forEach((photo) => {
      const cat = photo.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(photo);
    });
    return grouped;
  }, [photos]);

  // Upload photos
  const handleUploadPhotos = useCallback(async (files, category) => {
    const vId = visitId || (await ensureVisitExists());
    if (!vId) return;

    try {
      for (const file of files) {
        await uploadPhoto({
          orgId,
          leadId: lead.id,
          file,
          category,
          visitId: vId,
          userId,
        });
      }
      toast.success(`${files.length} photo${files.length > 1 ? 's' : ''} ajoutée${files.length > 1 ? 's' : ''}`);
    } catch (err) {
      console.error('[FicheTechniqueModal] upload error:', err);
      toast.error("Erreur lors de l'upload");
    }
  }, [visitId, ensureVisitExists, uploadPhoto, orgId, lead?.id, userId]);

  // Supprimer photo
  const handleDeletePhoto = useCallback(async (photoId, storagePath) => {
    if (!visitId) return;
    try {
      await deletePhoto(photoId, storagePath, visitId);
      toast.success('Photo supprimée');
    } catch (err) {
      console.error('[FicheTechniqueModal] delete photo error:', err);
      toast.error('Erreur lors de la suppression');
    }
  }, [visitId, deletePhoto]);

  // Unlock
  const handleUnlock = useCallback(async () => {
    if (!visitId) return;
    try {
      await unlockVisit(visitId);
      setShowUnlockConfirm(false);
      refresh();
      toast.success('Fiche déverrouillée');
    } catch (err) {
      console.error('[FicheTechniqueModal] unlock error:', err);
      toast.error('Erreur lors du déverrouillage');
    }
  }, [visitId, unlockVisit, refresh]);

  // Générer PDF
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const handleGeneratePdf = useCallback(async () => {
    if (!visit || !lead) return;

    setIsGeneratingPdf(true);
    try {
      // Lazy import pour ne pas alourdir le bundle
      const { pdf, createElement } = await import('@react-pdf/renderer');
      const { default: React } = await import('react');
      const { FicheTechniquePdf } = await import('./FicheTechniquePdf');

      // Générer le blob — createElement car on est hors JSX
      const doc = React.createElement(FicheTechniquePdf, { visit, lead, photos });
      const blob = await pdf(doc).toBlob();

      // Sauvegarder dans Storage
      const { url, error } = await technicalVisitService.savePdfToStorage(orgId, lead.id, blob);
      if (error) throw error;

      // Mettre à jour la fiche avec le chemin PDF
      if (visitId) {
        await autoSave(visitId, 'pdf_generated_at', new Date().toISOString(), lead.id);
      }

      // Télécharger le fichier
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.download = `Fiche_Technique_${lead.last_name || 'lead'}.pdf`;
        link.click();
      }

      toast.success('PDF généré et téléchargé');
    } catch (err) {
      console.error('[FicheTechniqueModal] PDF generation error:', err);
      toast.error('Erreur lors de la génération du PDF');
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [visit, lead, photos, orgId, visitId, autoSave]);

  // ========== RENDER ==========

  if (!isOpen || !lead) return null;

  const clientName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Sans nom';

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        {/* Modal */}
        <div className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden">

          {/* Header sticky */}
          <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
            <FileText className="h-5 w-5 text-blue-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                Fiche technique terrain
              </h2>
              <p className="text-sm text-gray-500 truncate">{clientName}</p>
            </div>

            {/* Badge statut */}
            <Badge className={`${statusConfig.color} text-xs shrink-0`}>
              {statusConfig.label}
            </Badge>

            {/* Bouton PDF */}
            {visitId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleGeneratePdf}
                disabled={isGeneratingPdf}
                className="h-8 gap-1.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 shrink-0"
              >
                {isGeneratingPdf ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span className="text-xs">PDF</span>
              </Button>
            )}

            {/* Badge verrouillé */}
            {isLocked && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowUnlockConfirm(true)}
                className="h-8 gap-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 shrink-0"
              >
                <Lock className="h-3.5 w-3.5" />
                <span className="text-xs">Verrouillée</span>
              </Button>
            )}

            {/* Indicateur saving */}
            {(isSaving || isCreating) && (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
            )}

            {/* Fermer */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0 text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Body scrollable */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : (
              <>
                <SectionContexte
                  lead={lead}
                  form={form}
                  disabled={disabled}
                />

                <SectionBatiment
                  form={form}
                  setField={setField}
                  onAutoSave={handleAutoSave}
                  disabled={disabled}
                />

                <SectionReleveTechnique
                  form={form}
                  setField={setField}
                  onAutoSave={handleAutoSave}
                  disabled={disabled}
                />

                <SectionPhotos
                  photosByCategory={photosByCategory}
                  onUploadPhotos={handleUploadPhotos}
                  onDeletePhoto={handleDeletePhoto}
                  disabled={disabled}
                />

                <SectionSynthese
                  form={form}
                  setField={setField}
                  onAutoSave={handleAutoSave}
                  disabled={disabled}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Confirm unlock */}
      <ConfirmDialog
        open={showUnlockConfirm}
        onOpenChange={setShowUnlockConfirm}
        title="Déverrouiller la fiche technique"
        description="Cette fiche a été verrouillée car le lead est en statut Gagné. Le déverrouillage est exceptionnel et permettra de modifier les données. Continuer ?"
        confirmLabel="Déverrouiller"
        variant="default"
        onConfirm={handleUnlock}
        loading={isUnlocking}
      />
    </>
  );
}

export default FicheTechniqueModal;
