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
import { useQueryClient } from '@tanstack/react-query';
import { useCertificatMutations } from '@hooks/useCertificats';
import { useTeamMembers } from '@hooks/useAppointments';
import { entretienSavKeys } from '@hooks/cacheKeys';
import { savService } from '@services/sav.service';
import { doitCreerSav, descriptionSavDepuisCertificat } from '@/lib/certificatAnomalies';
import { useAuth } from '@contexts/AuthContext';
import { clientsService } from '@services/clients.service';
import { StepIndicator } from './StepIndicator';
import { generatePdfBlob } from './CertificatPDF';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import {
  getSteps,
  getTypeDocument,
  getEmptyFormData,
  sectionsPourProfil,
} from './constants';

/** Données de ramonage initiales (profils à ramonage). */
const RAMONAGE_INITIAL = () => ({
  conduits: [{ label: 'Conduit principal', diametre_mm: null, longueur_ml: null, resultat: 'ramone', observations: '' }],
  methode: 'mecanique',
  methode_autre: '',
  taux_depots: 'faible',
  observations_conduit: '',
});

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
  const { profile, effectiveRole, organization } = useAuth();
  const canSelectTechnician = effectiveRole === 'org_admin' || effectiveRole === 'team_leader';
  const { members: teamMembers = [] } = useTeamMembers(canSelectTechnician ? organization?.id : null);
  const { saveDraft, signCertificat, uploadPdf, updatePdfInfo, getSignedUrl, isSaving, isSigning } = useCertificatMutations();
  const queryClient = useQueryClient();
  const saveTimeoutRef = useRef(null);
  // Référentiel de l'org : la valeur enregistrée (equipement_type) est le CODE de
  // catégorie ; le gabarit (profil) et la TVA par défaut viennent de la catégorie.
  const { index: referentiel, isLoading: referentielLoading } = useEquipmentReferential();

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
      // Le code de catégorie est posé par l'effet ci-dessous, une fois le
      // référentiel chargé (equipment ne porte que category_id).
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

    // Nom du technicien : assignedTechnician (planning) > user connecté
    initial.technicien_nom = assignedTechnician || profile?.full_name || '';

    return initial;
  });

  // ── Catégorie de l'équipement lié → code + TVA + ramonage (nouveau certificat) ──
  useEffect(() => {
    if (existingCertificat || !equipment?.category_id || referentielLoading) return;
    const cat = referentiel.categoriesById.get(equipment.category_id);
    if (!cat) return;
    setFormData((prev) => {
      if (prev.equipement_type) return prev;
      const config = sectionsPourProfil(cat.certificate_profile);
      const tva = referentiel.tvaParCode(cat.code);
      return {
        ...prev,
        equipement_type: cat.code,
        tva_taux: prev.tva_taux || (tva ?? prev.tva_taux),
        donnees_ramonage: prev.donnees_ramonage || (config.showRamonage ? RAMONAGE_INITIAL() : prev.donnees_ramonage),
      };
    });
  }, [equipment, existingCertificat, referentiel, referentielLoading]);

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

  // ── Profil de certificat (gabarit) depuis la catégorie ; code inconnu → générique, affiché ──
  const profil = referentiel.profilParCode(formData.equipement_type);
  const codeInconnu = !!formData.equipement_type && !referentielLoading && !referentiel.codeConnu(formData.equipement_type);

  // ── Steps dynamiques ──
  const steps = getSteps(profil);

  // ── Quand le step 0 choisit une catégorie, recalculer TVA + type_document + ramonage ──
  useEffect(() => {
    if (formData.equipement_type && !existingCertificat) {
      const config = sectionsPourProfil(profil);
      const tva = referentiel.tvaParCode(formData.equipement_type);
      setFormData(prev => ({
        ...prev,
        tva_taux: prev.tva_taux || (tva ?? prev.tva_taux),
        type_document: getTypeDocument(profil),
        donnees_ramonage: prev.donnees_ramonage || (config.showRamonage ? RAMONAGE_INITIAL() : prev.donnees_ramonage),
      }));
    }
  }, [formData.equipement_type, existingCertificat, profil, referentiel]);

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
      type_document: getTypeDocument(profil),
    };

    // Best effort : un refus se signale (toast) mais ne bloque pas le wizard —
    // on retombe sur l'id déjà connu (null tant que rien n'est enregistré).
    let saved = null;
    try {
      saved = await saveDraft(payload);
    } catch (err) {
      console.error('[CertificatWizard] doSave ERROR:', err);
      toast.error('Erreur sauvegarde certificat: ' + (err?.message || JSON.stringify(err)));
    }
    if (saved?.id && !certificatId) {
      setCertificatId(saved.id);
    }
    return saved?.id || certificatId;
  }, [formData, intervention, client, equipment, contract, orgId, userId, saveDraft, certificatId, pdfUrl, profil]);

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

  // ── Signature → clôture en UN geste ──
  // « Valider la signature » enregistre la signature PUIS enchaîne la clôture
  // (entretien réalisé + PDF). Avant, la clôture attendait un 2ᵉ bouton
  // (« Valider et générer le certificat PDF ») que le technicien ne pressait
  // pas après le toast « Signature enregistrée » : 7 certificats signés en prod
  // (25/09 et 01/10) sans clôture ni PDF, cartes restées « À faire » au kanban.
  const handleSign = async (signatureBase64, signataireNom) => {
    const signature = {
      signature_client_base64: signatureBase64,
      signature_client_nom: signataireNom,
      signed_at: new Date().toISOString(),
    };
    setFormData(prev => ({ ...prev, ...signature }));

    let certId = certificatId;
    try {
      certId = (await doSave()) || certificatId;
      if (certId) await signCertificat(certId, signatureBase64, signataireNom);
    } catch (err) {
      console.error('[CertificatWizard] signature non enregistrée:', err);
      toast.error(`Signature non enregistrée : ${err?.message || 'erreur inconnue'}`);
      return;
    }

    await finaliser({ certId, signature });
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

    // Non-bloquant : la sync est best-effort (les valeurs restent dans le certificat).
    // Le service ne throw jamais (`{ data, error }`) : on lit `error` pour que le refus
    // soit au moins tracé — un catch ne le verrait jamais.
    const { error } = await clientsService.updateEquipment(eqId, updates);
    if (error) {
      console.error('[CertificatWizard] syncEquipmentBack refusé (équipement non mis à jour):', error);
    }
  }, [formData, equipment]);

  // ── Clôture : entretien réalisé PUIS PDF ──
  // Appelée par handleSign (enchaînement automatique, `signature` = valeurs qui
  // ne sont pas encore dans le state) et par le bouton « Valider et générer le
  // certificat PDF » (reprise d'un certificat signé sans PDF, ou réessai).
  /**
   * Bilan « Devis à établir » ⇒ une demande SAV (colonne « Demande »), au plus une par certificat
   * (index unique `interventions.source_certificat_id` : un 23505 = déjà ouverte, silencieux).
   * Toute autre erreur se dit en avertissement, sans interrompre la finalisation.
   */
  const ouvrirDemandeSav = async (certId, data) => {
    if (!certId || !doitCreerSav(data)) return;
    const projectId = intervention?.project_id || client?.project_id || null;
    if (!client?.id || !projectId) {
      toast.warning('« Devis à établir » noté, mais la demande SAV n’a pas pu être créée : client ou projet inconnu.');
      return;
    }
    const { error } = await savService.createSAV({
      orgId,
      clientId: client.id,
      contractId: contract?.id || intervention?.contract_id || null,
      projectId,
      savDescription: descriptionSavDepuisCertificat(data, {
        equipementLabel: referentiel.categoriesByCode.get(data.equipement_type)?.label || '',
      }),
      savOrigin: 'entretien',
      createdBy: userId,
      sourceCertificatId: certId,
      equipmentId: equipment?.id || data.equipment_id || null,
    });
    if (error) {
      if (error.code === '23505') return; // reprise ou re-signature : la demande existe déjà
      console.error('[CertificatWizard] createSAV error:', error);
      toast.warning(`Certificat signé, mais la demande SAV n’a pas été créée : ${error.message || 'erreur inconnue'}`, { duration: 12000 });
      return;
    }
    queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(organization?.id) });
    toast.success('Demande SAV créée dans le Kanban Entretien (devis à établir)');
  };

  const finaliser = async ({ certId = certificatId, signature = null } = {}) => {
    setIsGeneratingPdf(true);
    setPdfError(null);
    const data = signature ? { ...formData, ...signature } : formData;

    try {
      // Pas de ligne certificat en base ⇒ rien à clôturer : une signature qui
      // n'existe pas en base ne doit pas passer la carte en « Réalisé » (doSave a
      // déjà affiché la cause du refus).
      let currentCertId = certId;
      if (!currentCertId) currentCertId = await doSave();
      if (!currentCertId) {
        const msg = "Certificat non enregistré en base — l'entretien reste à faire.";
        setPdfError(msg);
        toast.error(msg);
        return;
      }

      // 1. Entretien réalisé — AVANT le PDF : la carte du kanban ne dépend pas
      //    d'un rendu react-pdf réussi côté navigateur (le PDF est régénérable
      //    depuis les données du certificat, pas la signature). Sur une racine,
      //    markRealise pose aussi la visite annuelle à la date saisie — un échec
      //    laisserait la carte « Réalisé » sans date, il doit se voir.
      //    Reprise d'un certificat sur une RACINE déjà close (réalisée / facturée,
      //    18 certificats d'Antoine sans PDF en prod) : ne pas repasser markRealise,
      //    qui redescendrait « Facturé » en « Réalisé » et reposerait une visite.
      //    Un enfant, lui, repasse toujours (un « Néant » posé à la main redevient
      //    « Rempli » ; le parent déjà clos n'est pas retouché).
      const racineDejaClose = !intervention.parent_id
        && ['realise', 'facture'].includes(intervention.workflow_status);
      const { error: realiseError } = racineDejaClose
        ? { error: null }
        : await savService.markRealise(intervention.id, { visitDate: data.date_intervention || null });
      if (realiseError) {
        console.error('[CertificatWizard] markRealise error:', realiseError);
        const msg = `Certificat signé, mais la clôture de l'entretien a échoué : ${realiseError.message || 'erreur inconnue'}`;
        setPdfError(msg);
        toast.error(msg);
        return; // le bouton « Valider et générer » reste affiché pour réessayer
      }

      // 1bis. « Devis à établir » ⇒ demande SAV dans le Kanban Entretien, pour Philippe
      //       (spec 2026-10-10). Jamais bloquant : le certificat et le « Réalisé » sont posés.
      await ouvrirDemandeSav(currentCertId, data);

      // 2. Sync équipement (best effort) puis PDF
      await syncEquipmentBack();

      // Préparer les données pour le PDF (merge formData + infos client)
      const pdfData = {
        ...data,
        // Gabarit et libellé résolus ici, depuis le référentiel : le PDF n'en connaît rien.
        profil,
        equipement_type_label: referentiel.categoriesByCode.get(data.equipement_type)?.label || data.equipement_type,
        reference: contract?.contract_number || existingCertificat?.reference || '',
        client_name: client?.display_name || client?.last_name || '',
        client_address: [client?.address, client?.postal_code, client?.city].filter(Boolean).join(', '),
        client_phone: client?.phone || '',
      };

      // Générer le blob PDF
      const blob = await generatePdfBlob(pdfData, buildCompanyInfo(organization?.settings));

      // 3. Archivage. Un échec ici n'annule pas la bascule « réalisé » (déjà
      //    faite) : le PDF est régénérable depuis les données du certificat.
      //    Interrompre laissait l'entretien « planifié » au kanban alors que le
      //    technicien l'avait fait signer (régression bucket Storage `certificats`
      //    absent après le cutover, 2026-08-11 → 2026-08-27).
      try {
        // uploadPdf résout avec { path, storagePath } et rejette si Storage refuse ;
        // updatePdfInfo rejette si la ligne certificat ne prend pas le chemin.
        const { storagePath } = await uploadPdf({
          orgId: organization?.id,
          clientId: client.id,
          certificatId: currentCertId,
          pdfBlob: blob,
        });
        const urlResult = await getSignedUrl(storagePath);
        const signedUrl = urlResult?.data || '';
        await updatePdfInfo(currentCertId, storagePath, signedUrl);
        setPdfUrl(signedUrl);
      } catch (archiveErr) {
        console.error('[CertificatWizard] archivage PDF impossible:', archiveErr);
        // On reste sur l'écran : StepSignature affiche l'erreur et le lien vers
        // le PDF local, seul exemplaire disponible tant que l'archivage échoue.
        setPdfUrl(URL.createObjectURL(blob));
        setPdfError(`PDF non archivé : ${archiveErr?.message || 'archivage impossible'}`);
        toast.warning(
          "Entretien marqué réalisé, mais le PDF n'a pas pu être archivé — récupérez-le ci-dessous."
        );
        return;
      }

      toast.success('Certificat généré — entretien marqué réalisé');
      // Retour à la page précédente (modale entretien ou RDV du planning)
      navigate(-1);
    } catch (err) {
      // Le PDF n'a pas pu être rendu : l'entretien est déjà « Réalisé », le
      // bouton « Valider et générer » reste affiché pour réessayer.
      console.error('[CertificatWizard] PDF generation error:', err);
      setPdfError(`Entretien marqué réalisé, mais PDF non généré : ${err.message || 'erreur de génération'}`);
      toast.error("Entretien marqué réalisé, mais le PDF n'a pas pu être généré");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleGeneratePdf = () => finaliser();

  // ── Rendu step courant ──
  const currentStepConfig = steps[currentStep];
  const StepComponent = STEP_COMPONENTS[currentStepConfig?.id];
  const isLastStep = currentStepConfig?.id === 'signature';
  const isFirstStep = currentStep === 0;

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
        {codeInconnu && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Catégorie « {formData.equipement_type} » inconnue de votre organisation : gabarit générique appliqué
            (contrôles et nettoyage seulement). Pour un gabarit complet, recréez la catégorie sous ce code dans
            Paramètres → Équipements → Catégories.
          </div>
        )}
        {StepComponent && currentStepConfig.id === 'signature' ? (
          <StepSignature
            formData={formData}
            referentiel={referentiel}
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
            profil={profil}
            referentiel={referentiel}
            client={client}
            equipment={equipment}
            clientEquipments={clientEquipments}
            technicians={teamMembers}
            canSelectTechnician={canSelectTechnician}
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
