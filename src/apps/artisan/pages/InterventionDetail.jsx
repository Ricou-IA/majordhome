/**
 * InterventionDetail.jsx - Majord'home Artisan
 * ============================================================================
 * Page terrain tablette : fiche intervention complète.
 * 4 onglets : Résumé, Rapport, Photos, Signature & Envoi.
 *
 * UX tablette : touch targets 44px, font 16px, auto-save brouillon.
 * Onglets 2-4 verrouillés tant que status ≠ in_progress.
 *
 * @version 1.0.0 - Sprint 3 Outil Terrain Tablette
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  ClipboardList,
  FileText,
  Camera,
  PenTool,
  Loader2,
  AlertCircle,
  Save,
  Send,
  Lock,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  useIntervention,
  useInterventionFileUrls,
  useInterventionMutations,
  useInterventionDraft,
} from '@hooks/useInterventions';
import { FILE_TYPES } from '@services/interventions.service';
import { PermissionGate } from '@/components/PermissionGate';
import { CreateSAVModal } from '../components/entretiens/CreateSAVModal';
import { InterventionHeader } from '../components/interventions/InterventionHeader';
import { PhotoCapture } from '../components/interventions/PhotoCapture';
import { SignaturePad } from '../components/interventions/SignaturePad';
import { PartsReplacedList } from '../components/interventions/PartsReplacedList';
import { PdfViewer } from '../components/interventions/PdfViewer';

// ============================================================================
// PAGE PRINCIPALE
// ============================================================================

export default function InterventionDetail() {
  const { id } = useParams();

  // Hooks données
  const { intervention, client, equipment, isLoading, error, refresh } = useIntervention(id);
  const fileUrls = useInterventionFileUrls(intervention);
  const mutations = useInterventionMutations(id);
  const draft = useInterventionDraft(id);

  // État formulaire local
  const [formData, setFormData] = useState({
    work_performed: '',
    report_notes: '',
    duration_minutes: '',
    is_billable: true,
    parts_replaced: [],
  });

  // État signature
  const [signedByName, setSignedByName] = useState('');

  // État PDF
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfError, setPdfError] = useState(null);

  // État modal SAV
  const [createSAVOpen, setCreateSAVOpen] = useState(false);

  // Onglet actif
  const [activeTab, setActiveTab] = useState('summary');

  // ============================================================================
  // INITIALISATION FORMULAIRE
  // ============================================================================

  // Charger les données existantes ou le brouillon
  useEffect(() => {
    if (!intervention) return;

    // Essayer de charger le brouillon d'abord
    const savedDraft = draft.loadDraft();
    if (savedDraft && intervention.status === 'in_progress') {
      setFormData(savedDraft);
      toast.info('Brouillon restauré', { description: 'Vos données précédentes ont été récupérées.' });
      return;
    }

    // Sinon charger depuis la DB
    setFormData({
      work_performed: intervention.work_performed || '',
      report_notes: intervention.report_notes || '',
      duration_minutes: intervention.duration_minutes || '',
      is_billable: intervention.is_billable !== false,
      parts_replaced: intervention.parts_replaced || [],
    });

    setSignedByName(intervention.signed_by_name || '');
  }, [intervention?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save brouillon quand status = in_progress
  useEffect(() => {
    if (intervention?.status === 'in_progress') {
      draft.startAutoSave(() => formData);
    }
    return () => draft.stopAutoSave();
  }, [intervention?.status, formData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================================
  // HANDLERS
  // ============================================================================

  // Mettre à jour un champ du formulaire
  const updateField = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  // Démarrer l'intervention (scheduled → in_progress)
  const handleStart = async () => {
    try {
      const result = await mutations.updateStatus('in_progress');
      if (result?.error) throw result.error;
      toast.success('Intervention démarrée');
      refresh();
    } catch (err) {
      console.error('[InterventionDetail] handleStart error:', err);
      toast.error("Erreur au démarrage de l'intervention");
    }
  };

  // Terminer l'intervention (in_progress → completed)
  const handleComplete = async () => {
    try {
      // Sauvegarder le rapport d'abord
      await handleSaveReport();
      const result = await mutations.updateStatus('completed');
      if (result?.error) throw result.error;
      draft.clearDraft();
      toast.success('Intervention terminée');
      refresh();
    } catch (err) {
      console.error('[InterventionDetail] handleComplete error:', err);
      toast.error("Erreur à la finalisation de l'intervention");
    }
  };

  // Sauvegarder le rapport
  const handleSaveReport = async () => {
    try {
      const result = await mutations.updateIntervention({
        work_performed: formData.work_performed,
        report_notes: formData.report_notes,
        duration_minutes: formData.duration_minutes ? parseInt(formData.duration_minutes) : null,
        is_billable: formData.is_billable,
        parts_replaced: formData.parts_replaced,
      });
      if (result?.error) throw result.error;
      draft.saveDraft(formData);
      toast.success('Rapport sauvegardé');
    } catch (err) {
      console.error('[InterventionDetail] handleSaveReport error:', err);
      toast.error('Erreur de sauvegarde du rapport');
    }
  };

  // Upload photo
  const handlePhotoUpload = async (file, fileType, dbField) => {
    if (!intervention?.project_id) return;
    try {
      const result = await mutations.uploadFile(intervention.project_id, file, fileType);
      if (result?.error) throw result.error;

      // Mettre à jour le chemin en DB
      if (fileType === FILE_TYPES.PHOTO_EXTRA) {
        // Photos supplémentaires : ajouter au tableau
        const currentExtra = intervention.photos_extra || [];
        await mutations.updateIntervention({
          photos_extra: [...currentExtra, result.path],
        });
      } else {
        await mutations.updateIntervention({ [dbField]: result.path });
      }

      toast.success('Photo uploadée');
      fileUrls.refreshUrls();
      refresh();
    } catch (err) {
      console.error('[InterventionDetail] handlePhotoUpload error:', err);
      toast.error("Erreur d'upload de la photo");
    }
  };

  // Supprimer photo
  const handlePhotoDelete = async (path, dbField) => {
    try {
      await mutations.deleteFile(path);

      if (dbField === 'photos_extra') {
        const currentExtra = intervention.photos_extra || [];
        await mutations.updateIntervention({
          photos_extra: currentExtra.filter(p => p !== path),
        });
      } else {
        await mutations.updateIntervention({ [dbField]: null });
      }

      toast.success('Photo supprimée');
      fileUrls.refreshUrls();
      refresh();
    } catch (err) {
      console.error('[InterventionDetail] handlePhotoDelete error:', err);
      toast.error('Erreur de suppression de la photo');
    }
  };

  // Confirmer signature
  const handleSignatureConfirm = async (blob, name) => {
    if (!intervention?.project_id) return;
    try {
      const file = new File([blob], 'signature.png', { type: 'image/png' });
      const result = await mutations.uploadFile(intervention.project_id, file, FILE_TYPES.SIGNATURE);
      if (result?.error) throw result.error;

      await mutations.updateIntervention({
        signature_url: result.path,
        signed_at: new Date().toISOString(),
        signed_by_name: name,
      });

      toast.success('Signature enregistrée');
      fileUrls.refreshUrls();
      refresh();
    } catch (err) {
      console.error('[InterventionDetail] handleSignatureConfirm error:', err);
      toast.error("Erreur d'enregistrement de la signature");
    }
  };

  // Générer le PV via N8N
  const handleGeneratePdf = async () => {
    try {
      // Sauvegarder le rapport d'abord
      await handleSaveReport();

      setPdfError(null);
      const result = await mutations.triggerPdf();

      if (!result?.success) {
        throw result?.error || new Error('Erreur de génération');
      }

      // Le PDF sera disponible après que N8N l'ait uploadé
      toast.success('Génération du PV lancée', {
        description: 'Le PDF sera disponible dans quelques secondes...',
      });

      // Rafraîchir après un délai pour récupérer le path PDF
      setTimeout(async () => {
        refresh();
        fileUrls.refreshUrls();
      }, 5000);
    } catch (err) {
      console.error('[InterventionDetail] handleGeneratePdf error:', err);
      setPdfError("Erreur de génération du PV. Vérifiez la connexion N8N.");
      toast.error('Erreur de génération du PV');
    }
  };

  // Envoyer le rapport signé au client via N8N
  const handleSendReport = async () => {
    try {
      const result = await mutations.triggerSignedReport();
      if (!result?.success) {
        throw result?.error || new Error("Erreur d'envoi");
      }
      toast.success('Rapport envoyé au client', {
        description: `Email envoyé à ${client?.email || 'l\'adresse du client'}`,
      });
    } catch (err) {
      console.error('[InterventionDetail] handleSendReport error:', err);
      toast.error("Erreur d'envoi du rapport");
    }
  };

  // ============================================================================
  // ÉTATS DÉRIVÉS
  // ============================================================================

  const isInProgress = intervention?.status === 'in_progress';
  const isCompleted = intervention?.status === 'completed';
  const canEdit = isInProgress;
  const tabsLocked = !isInProgress && !isCompleted;

  // Vérifier la complétion pour le bouton "Envoyer"
  const hasReport = !!(formData.work_performed);
  const hasPhotos = !!(intervention?.photo_before_url || intervention?.photo_after_url);
  const hasSignature = !!intervention?.signature_url;
  const canSend = hasReport && hasSignature;

  // ============================================================================
  // RENDU - ÉTATS LOADING / ERREUR
  // ============================================================================

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !intervention) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link
            to="/planning"
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-bold">Intervention</h1>
        </div>

        <div className="bg-white rounded-lg border p-8 text-center">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
          <p className="mt-4 text-lg font-medium text-gray-700">
            Intervention introuvable
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {error?.message || "Cette intervention n'existe pas ou vous n'y avez pas accès."}
          </p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDU PRINCIPAL
  // ============================================================================

  return (
    <div className="space-y-4 pb-8">
      {/* En-tête navigation */}
      <div className="flex items-center gap-3">
        <Link
          to="/planning"
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900 truncate">
            {client?.display_name || 'Intervention'}
          </h1>
          <p className="text-sm text-gray-500">
            Intervention #{id?.slice(0, 8)}
          </p>
        </div>
      </div>

      {/* Onglets */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-4 h-12">
          <TabsTrigger value="summary" className="text-sm min-h-[44px] gap-1">
            <ClipboardList className="h-4 w-4" />
            <span className="hidden sm:inline">Résumé</span>
          </TabsTrigger>
          <TabsTrigger
            value="report"
            className="text-sm min-h-[44px] gap-1"
            disabled={tabsLocked}
          >
            {tabsLocked ? <Lock className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            <span className="hidden sm:inline">Rapport</span>
          </TabsTrigger>
          <TabsTrigger
            value="photos"
            className="text-sm min-h-[44px] gap-1"
            disabled={tabsLocked}
          >
            {tabsLocked ? <Lock className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
            <span className="hidden sm:inline">Photos</span>
          </TabsTrigger>
          <TabsTrigger
            value="signature"
            className="text-sm min-h-[44px] gap-1"
            disabled={tabsLocked}
          >
            {tabsLocked ? <Lock className="h-4 w-4" /> : <PenTool className="h-4 w-4" />}
            <span className="hidden sm:inline">Signature</span>
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* ONGLET 1 : RÉSUMÉ */}
        {/* ================================================================ */}
        <TabsContent value="summary" className="mt-4 space-y-4">
          <InterventionHeader
            intervention={intervention}
            client={client}
            equipment={equipment}
            onStart={handleStart}
            onComplete={handleComplete}
            isChangingStatus={mutations.isChangingStatus}
          />

          {/* Info lock si pas en cours */}
          {tabsLocked && (
            <div className="bg-blue-50 rounded-lg p-4 flex items-start gap-3">
              <Lock className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-800">
                  Intervention non démarrée
                </p>
                <p className="text-sm text-blue-600 mt-1">
                  Cliquez sur "Commencer l'intervention" pour débloquer le rapport,
                  les photos et la signature.
                </p>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ================================================================ */}
        {/* ONGLET 2 : RAPPORT */}
        {/* ================================================================ */}
        <TabsContent value="report" className="mt-4 space-y-5">
          {/* Travaux effectués */}
          <div className="space-y-2">
            <Label htmlFor="work_performed" className="text-base font-medium">
              Travaux effectués *
            </Label>
            <Textarea
              id="work_performed"
              value={formData.work_performed}
              onChange={(e) => updateField('work_performed', e.target.value)}
              placeholder="Décrivez les travaux réalisés..."
              rows={5}
              disabled={!canEdit}
              className="text-base min-h-[120px]"
            />
          </div>

          {/* Notes / observations */}
          <div className="space-y-2">
            <Label htmlFor="report_notes" className="text-base font-medium">
              Notes / Observations
            </Label>
            <Textarea
              id="report_notes"
              value={formData.report_notes}
              onChange={(e) => updateField('report_notes', e.target.value)}
              placeholder="Observations, recommandations, points d'attention..."
              rows={3}
              disabled={!canEdit}
              className="text-base"
            />
          </div>

          {/* Durée + Facturable */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="duration_minutes" className="text-base font-medium">
                Durée (minutes)
              </Label>
              <Input
                id="duration_minutes"
                type="number"
                min="0"
                step="15"
                value={formData.duration_minutes}
                onChange={(e) => updateField('duration_minutes', e.target.value)}
                placeholder="60"
                disabled={!canEdit}
                className="min-h-[44px] text-base"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-base font-medium">Facturable</Label>
              <div className="flex items-center gap-2 min-h-[44px]">
                <Checkbox
                  id="is_billable"
                  checked={formData.is_billable}
                  onCheckedChange={(checked) => updateField('is_billable', !!checked)}
                  disabled={!canEdit}
                  className="h-5 w-5"
                />
                <Label htmlFor="is_billable" className="text-base cursor-pointer">
                  {formData.is_billable ? 'Oui' : 'Non'}
                </Label>
              </div>
            </div>
          </div>

          {/* Pièces remplacées */}
          <PartsReplacedList
            parts={formData.parts_replaced}
            onChange={(parts) => updateField('parts_replaced', parts)}
            disabled={!canEdit}
          />

          {/* Bouton sauvegarder */}
          {canEdit && (
            <Button
              onClick={handleSaveReport}
              disabled={mutations.isUpdating}
              className="w-full min-h-[48px] text-base gap-2"
            >
              {mutations.isUpdating ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Save className="h-5 w-5" />
              )}
              {mutations.isUpdating ? 'Sauvegarde...' : 'Sauvegarder le rapport'}
            </Button>
          )}

          {/* Indicateur auto-save */}
          {draft.lastSaved && canEdit && (
            <p className="text-xs text-gray-400 text-center">
              Brouillon auto-sauvegardé à{' '}
              {draft.lastSaved.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}

          {/* CTA Créer un SAV — visible seulement pour admin/team_leader */}
          <PermissionGate resource="sav" action="create">
            <div className="border-t border-gray-200 pt-4 mt-2">
              <div className="bg-orange-50 rounded-lg border border-orange-200 p-4 space-y-2">
                <h4 className="text-sm font-semibold text-orange-900 flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-orange-600" />
                  Signaler un problème
                </h4>
                <p className="text-xs text-orange-700">
                  Si un problème nécessite une intervention SAV, créez une demande directement depuis cette fiche.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateSAVOpen(true)}
                  className="w-full min-h-[44px] text-sm gap-2 border-orange-300 text-orange-700 hover:bg-orange-100"
                >
                  <Wrench className="h-4 w-4" />
                  Créer un SAV
                </Button>
              </div>
            </div>
          </PermissionGate>
        </TabsContent>

        {/* ================================================================ */}
        {/* ONGLET 3 : PHOTOS */}
        {/* ================================================================ */}
        <TabsContent value="photos" className="mt-4 space-y-6">
          {/* Photo avant */}
          <PhotoCapture
            label="📸 Photo avant intervention"
            currentUrl={fileUrls.photoBeforeUrl}
            currentPath={intervention.photo_before_url}
            onUpload={(file) => handlePhotoUpload(file, FILE_TYPES.PHOTO_BEFORE, 'photo_before_url')}
            onDelete={(path) => handlePhotoDelete(path, 'photo_before_url')}
            disabled={!canEdit}
            isUploading={mutations.isUploading}
          />

          {/* Photo après */}
          <PhotoCapture
            label="📸 Photo après intervention"
            currentUrl={fileUrls.photoAfterUrl}
            currentPath={intervention.photo_after_url}
            onUpload={(file) => handlePhotoUpload(file, FILE_TYPES.PHOTO_AFTER, 'photo_after_url')}
            onDelete={(path) => handlePhotoDelete(path, 'photo_after_url')}
            disabled={!canEdit}
            isUploading={mutations.isUploading}
          />

          {/* Photos supplémentaires */}
          <div className="space-y-3">
            <Label className="text-base font-medium">📸 Photos supplémentaires</Label>
            <div className="grid grid-cols-2 gap-3">
              {(fileUrls.photosExtraUrls || []).map((url, index) => {
                const path = intervention.photos_extra?.[index];
                return (
                  <PhotoCapture
                    key={path || index}
                    label={`Photo ${index + 1}`}
                    currentUrl={url}
                    currentPath={path}
                    onDelete={(p) => handlePhotoDelete(p, 'photos_extra')}
                    disabled={!canEdit}
                    isUploading={mutations.isUploading}
                  />
                );
              })}
            </div>

            {/* Bouton ajouter photo supplémentaire */}
            {canEdit && (
              <PhotoCapture
                label="Ajouter une photo"
                currentUrl={null}
                currentPath={null}
                onUpload={(file) => handlePhotoUpload(file, FILE_TYPES.PHOTO_EXTRA, 'photos_extra')}
                disabled={!canEdit}
                isUploading={mutations.isUploading}
              />
            )}
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* ONGLET 4 : SIGNATURE & ENVOI */}
        {/* ================================================================ */}
        <TabsContent value="signature" className="mt-4 space-y-6">
          {/* Étape 1 : Générer le PV */}
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <h3 className="font-semibold text-base">1. Générer le PV d'intervention</h3>
            <p className="text-sm text-gray-600">
              Le rapport sera compilé en PDF pour relecture avant signature.
            </p>
            <Button
              onClick={handleGeneratePdf}
              disabled={!hasReport || mutations.isGeneratingPdf || !canEdit}
              className="w-full min-h-[48px] text-base gap-2"
              variant="outline"
            >
              {mutations.isGeneratingPdf ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
              {mutations.isGeneratingPdf ? 'Génération en cours...' : 'Générer le PV'}
            </Button>
            {!hasReport && (
              <p className="text-xs text-amber-600">
                Complétez d'abord le rapport (onglet Rapport) avant de générer le PV.
              </p>
            )}
          </div>

          {/* Viewer PDF */}
          <PdfViewer
            pdfUrl={pdfUrl}
            isLoading={mutations.isGeneratingPdf}
            error={pdfError}
          />

          {/* Étape 2 : Signature client */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold text-base mb-3">2. Signature du client</h3>
            <SignaturePad
              signedByName={signedByName}
              onSignedByNameChange={setSignedByName}
              onConfirm={handleSignatureConfirm}
              existingSignatureUrl={fileUrls.signatureUrl}
              disabled={!canEdit}
              isSaving={mutations.isUploading}
            />
          </div>

          {/* Étape 3 : Envoyer au client */}
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <h3 className="font-semibold text-base">3. Envoyer au client</h3>
            <p className="text-sm text-gray-600">
              Le PV signé sera envoyé par email à{' '}
              <strong>{client?.email || '(email non renseigné)'}</strong>.
            </p>
            <Button
              onClick={handleSendReport}
              disabled={!canSend || mutations.isSendingReport}
              className="w-full min-h-[48px] text-base gap-2"
            >
              {mutations.isSendingReport ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
              {mutations.isSendingReport ? 'Envoi en cours...' : 'Envoyer le rapport au client'}
            </Button>
            {!canSend && (
              <p className="text-xs text-amber-600">
                {!hasReport && 'Rapport manquant. '}
                {!hasSignature && 'Signature manquante. '}
                Complétez ces éléments pour pouvoir envoyer.
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Modal création SAV depuis l'intervention */}
      <CreateSAVModal
        isOpen={createSAVOpen}
        onClose={() => setCreateSAVOpen(false)}
        onCreated={() => {
          setCreateSAVOpen(false);
          toast.success('Demande SAV créée depuis l\'intervention');
        }}
        prefillClient={client ? {
          id: client.id,
          display_name: client.display_name,
          first_name: client.first_name,
          last_name: client.last_name,
          address: client.address,
          postal_code: client.postal_code,
          city: client.city,
          phone: client.phone,
          email: client.email,
        } : null}
        prefillContractId={intervention?.contract_id || null}
        savOrigin="entretien"
      />
    </div>
  );
}
