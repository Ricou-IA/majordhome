/**
 * CertificatWizard.jsx - Certificat d'Entretien & Ramonage
 * ============================================================================
 * Orchestrateur multi-étapes. Gère :
 * - State formData global
 * - Steps conditionnels selon type d'équipement
 * - Auto-save brouillon à chaque changement d'étape
 * - Navigation Précédent/Suivant + StepIndicator
 * - Signature + génération PDF + transition réalisé
 *
 * @version 1.0.0 - Module Certificat d'Entretien & Ramonage
 * ============================================================================
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCertificatMutations } from '@hooks/useCertificats';
import { savService } from '@services/sav.service';
import { useAuth } from '@contexts/AuthContext';
import { clientsService } from '@services/clients.service';
import { StepIndicator } from './StepIndicator';
import { generatePdfBlob } from './CertificatPDF';
import {
  getSteps,
  getTypeDocument,
  getEmptyFormData,
  SECTIONS_PAR_EQUIPEMENT,
} from './constants';

// Steps
import { StepEquipementType } from './steps/StepEquipementType';
import { StepInfosGenerales } from './steps/StepInfosGenerales';
import { StepControles } from './steps/StepControles';
import { StepNettoyage } from './steps/StepNettoyage';
import { StepRamonage } from './steps/StepRamonage';
import { StepFGaz } from './steps/StepFGaz';
import { StepMesures } from './steps/StepMesures';
import { StepPieces } from './steps/StepPieces';
import { StepBilan } from './steps/StepBilan';
import { StepSignature } from './steps/StepSignature';

// ============================================================================
// MAP STEP ID → COMPOSANT
// ============================================================================

const STEP_COMPONENTS = {
  equipement: StepEquipementType,
  infos: StepInfosGenerales,
  controles: StepControles,
  nettoyage: StepNettoyage,
  ramonage: StepRamonage,
  fgaz: StepFGaz,
  mesures: StepMesures,
  pieces: StepPieces,
  bilan: StepBilan,
  signature: StepSignature,
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function CertificatWizard({
  intervention,
  client,
  equipment,
  contract,
  clientEquipments,
  existingCertificat,
  orgId,
  userId,
  assignedTechnician = '',
}) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { saveDraft, signCertificat, uploadPdf, updatePdfInfo, getSignedUrl, isSaving, isSigning } = useCertificatMutations();
  const saveTimeoutRef = useRef(null);

  // ── State formData ──
  const [formData, setFormData] = useState(() => {
    if (existingCertificat) {
      // Reprendre le brouillon existant
      return {
        ...getEmptyFormData(),
        ...existingCertificat,
      };
    }

    // Initialiser depuis les données de l'intervention
    const initial = getEmptyFormData();
    initial.date_intervention = intervention.scheduled_date
      ? new Date(intervention.scheduled_date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    if (equipment) {
      initial.equipement_type = equipment.category || '';
      initial.equipement_marque = equipment.brand || '';
      initial.equipement_modele = equipment.model || '';
      initial.equipement_numero_serie = equipment.serial_number || '';
      initial.equipement_puissance_kw = equipment.metadata?.puissance_kw || null;
      initial.equipement_fluide = equipment.metadata?.fluide || '';
      initial.equipement_charge_kg = equipment.metadata?.charge_kg || null;
      if (equipment.install_date) {
        initial.equipement_annee = new Date(equipment.install_date).getFullYear();
      }
    }

    // TVA par défaut
    const config = SECTIONS_PAR_EQUIPEMENT[initial.equipement_type];
    if (config) {
      initial.tva_taux = config.tvaDefaut;
      // Initialiser donnees_ramonage si nécessaire
      if (config.showRamonage) {
        initial.donnees_ramonage = {
          conduits: [{ label: 'Conduit principal', diametre_mm: null, longueur_ml: null, resultat: 'ramone', observations: '' }],
          methode: 'mecanique',
          methode_autre: '',
          taux_depots: 'faible',
          observations_conduit: '',
        };
      }
    }

    // Nom du technicien : assignedTechnician (planning) > user connecté
    initial.technicien_nom = assignedTechnician || profile?.full_name || '';

    return initial;
  });

  const [currentStep, setCurrentStep] = useState(0);
  const [certificatId, setCertificatId] = useState(existingCertificat?.id || null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(existingCertificat?.pdf_url || null);
  const [pdfError, setPdfError] = useState(null);

  // ── Auto-remplir technicien depuis le planning ──
  useEffect(() => {
    if (assignedTechnician && !formData.technicien_nom) {
      setFormData(prev => ({ ...prev, technicien_nom: assignedTechnician }));
    }
  }, [assignedTechnician]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Steps dynamiques ──
  const steps = getSteps(formData.equipement_type);

  // ── Quand le step 0 choisit un type, recalculer TVA + type_document ──
  useEffect(() => {
    if (formData.equipement_type) {
      const config = SECTIONS_PAR_EQUIPEMENT[formData.equipement_type];
      if (config && !existingCertificat) {
        setFormData(prev => ({
          ...prev,
          tva_taux: prev.tva_taux || config.tvaDefaut,
          type_document: getTypeDocument(prev.equipement_type),
        }));
      }
    }
  }, [formData.equipement_type, existingCertificat]);

  // ── onChange générique ──
  const handleChange = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Auto-save brouillon ──
  const doSave = useCallback(async () => {
    if (!formData.equipement_type || !formData.date_intervention) return certificatId;
    if (pdfUrl) return certificatId; // Déjà signé + PDF → ne pas écraser
    if (formData.signature_client_base64) return certificatId; // Signé → ne pas écraser le statut

    const payload = {
      ...formData,
      intervention_id: intervention.id,
      client_id: client.id,
      equipment_id: equipment?.id || formData.equipment_id || null,
      contract_id: contract?.id || intervention.contract_id || null,
      org_id: orgId,
      created_by: userId,
      type_document: getTypeDocument(formData.equipement_type),
    };

    const result = await saveDraft(payload);
    if (result?.error) {
      console.error('[CertificatWizard] doSave ERROR:', result.error);
      toast.error('Erreur sauvegarde certificat: ' + (result.error?.message || JSON.stringify(result.error)));
    }
    if (result?.data?.id && !certificatId) {
      setCertificatId(result.data.id);
    }
    return result?.data?.id || certificatId;
  }, [formData, intervention, client, equipment, contract, orgId, userId, saveDraft, certificatId, pdfUrl]);

  // Auto-save quand on change d'étape (debounce 500ms)
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      doSave().catch(err => console.error('[CertificatWizard] auto-save error:', err));
    }, 500);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigation ──
  const goNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const goPrev = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const goToStep = (index) => {
    if (index < currentStep) {
      setCurrentStep(index);
    }
  };

  // ── Signature ──
  const handleSign = async (signatureBase64, signataireNom) => {
    // Toujours sauvegarder la signature dans le formData local (indépendamment du DB)
    setFormData(prev => ({
      ...prev,
      signature_client_base64: signatureBase64,
      signature_client_nom: signataireNom,
      signed_at: new Date().toISOString(),
    }));

    // Tenter de sauvegarder en DB (best-effort)
    try {
      const savedId = await doSave();
      const certId = savedId || certificatId;
      if (certId) {
        await signCertificat(certId, signatureBase64, signataireNom);
      }
    } catch {
      // Non-bloquant : la signature est capturée côté client
    }

    toast.success('Signature enregistrée');
  };

  // ── Sync équipement → DB (mise à jour des champs complétés par le technicien) ──
  const syncEquipmentBack = useCallback(async () => {
    const eqId = equipment?.id || formData.equipment_id;
    if (!eqId) return; // Pas d'équipement lié → rien à sync

    const updates = {};

    // Comparer formData vs original equipment — ne sync que les champs nouveaux/modifiés
    if (formData.equipement_marque && formData.equipement_marque !== (equipment?.brand || '')) {
      updates.brand = formData.equipement_marque;
    }
    if (formData.equipement_modele && formData.equipement_modele !== (equipment?.model || '')) {
      updates.model = formData.equipement_modele;
    }
    if (formData.equipement_numero_serie && formData.equipement_numero_serie !== (equipment?.serial_number || '')) {
      updates.serialNumber = formData.equipement_numero_serie;
    }
    if (formData.equipement_annee && formData.equipement_annee !== (equipment?.installation_year || null)) {
      updates.installationYear = formData.equipement_annee;
    }

    if (Object.keys(updates).length === 0) return; // Rien à mettre à jour

    try {
      await clientsService.updateEquipment(eqId, updates);
    } catch (err) {
      // Non-bloquant : la sync est best-effort
      console.error('[CertificatWizard] syncEquipmentBack error:', err);
    }
  }, [formData, equipment]);

  // ── Génération PDF ──
  const handleGeneratePdf = async () => {
    setIsGeneratingPdf(true);
    setPdfError(null);

    try {
      // Sync équipement avant de finaliser
      await syncEquipmentBack();

      // S'assurer que le brouillon est sauvegardé (obtenir certificatId)
      let currentCertId = certificatId;
      if (!currentCertId) {
        currentCertId = await doSave();
      }

      // Préparer les données pour le PDF (merge formData + infos client)
      const pdfData = {
        ...formData,
        reference: contract?.contract_number || existingCertificat?.reference || '',
        client_name: client?.display_name || client?.last_name || '',
        client_address: [client?.address, client?.postal_code, client?.city].filter(Boolean).join(', '),
        client_phone: client?.phone || '',
      };

      // Générer le blob PDF
      const blob = await generatePdfBlob(pdfData);

      // Upload + DB uniquement si on a un certificatId
      if (currentCertId) {
        const uploadResult = await uploadPdf(client.id, currentCertId, blob);
        if (uploadResult?.error) {
          throw new Error(uploadResult.error.message || 'Erreur upload PDF');
        }

        const urlResult = await getSignedUrl(uploadResult.data.storagePath);
        const signedUrl = urlResult?.data || '';
        await updatePdfInfo(currentCertId, uploadResult.data.storagePath, signedUrl);
        setPdfUrl(signedUrl);
      } else {
        // Pas de certificatId (table pas encore créée) — générer le PDF en local
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
      }

      // Transition → réalisé (workflow + status)
      await savService.markRealise(intervention.id);

      toast.success('Certificat généré — entretien marqué réalisé');

      // Retour à la page précédente (modale entretien)
      navigate(-1);
    } catch (err) {
      console.error('[CertificatWizard] PDF generation error:', err);
      setPdfError(err.message || 'Erreur de génération');
      toast.error('Erreur lors de la génération du PDF');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // ── Rendu step courant ──
  const currentStepConfig = steps[currentStep];
  const StepComponent = STEP_COMPONENTS[currentStepConfig?.id];
  const isLastStep = currentStepConfig?.id === 'signature';
  const isFirstStep = currentStep === 0;

  // Si step 0 (équipement) et l'équipement est déjà connu → skip auto
  const shouldAutoSkipEquipement = currentStep === 0 && equipment?.category && formData.equipement_type;

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <StepIndicator
        steps={steps}
        currentIndex={currentStep}
        onStepClick={goToStep}
      />

      {/* Contenu step */}
      <div className="min-h-[400px]">
        {StepComponent && currentStepConfig.id === 'signature' ? (
          <StepSignature
            formData={formData}
            client={client}
            certificatId={certificatId}
            onSign={handleSign}
            onGeneratePdf={handleGeneratePdf}
            isSigning={isSigning}
            isGeneratingPdf={isGeneratingPdf}
            pdfUrl={pdfUrl}
            pdfError={pdfError}
          />
        ) : StepComponent ? (
          <StepComponent
            formData={formData}
            onChange={handleChange}
            client={client}
            equipment={equipment}
            clientEquipments={clientEquipments}
          />
        ) : null}
      </div>

      {/* Navigation */}
      {!pdfUrl && (
        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
          {/* Précédent */}
          <div>
            {!isFirstStep && (
              <Button
                type="button"
                variant="outline"
                onClick={goPrev}
                className="min-h-[48px] text-base"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Précédent
              </Button>
            )}
            {isFirstStep && (
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/entretiens')}
                className="min-h-[48px] text-base"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Retour
              </Button>
            )}
          </div>

          {/* Indicateur sauvegarde */}
          <div className="text-xs text-gray-400 flex items-center gap-1">
            {isSaving && <><Loader2 className="w-3 h-3 animate-spin" /> Sauvegarde...</>}
            {!isSaving && certificatId && <><Save className="w-3 h-3" /> Brouillon sauvegardé</>}
          </div>

          {/* Suivant */}
          {!isLastStep && (
            <Button
              type="button"
              onClick={goNext}
              disabled={!formData.equipement_type && currentStep === 0}
              className="min-h-[48px] text-base bg-[#1B4F72] hover:bg-[#154360] text-white"
            >
              Suivant
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
          {isLastStep && <div />}
        </div>
      )}

      {/* Bouton retour après PDF */}
      {pdfUrl && (
        <div className="flex justify-center pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/entretiens')}
            className="min-h-[48px] text-base"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour aux entretiens
          </Button>
        </div>
      )}
    </div>
  );
}
