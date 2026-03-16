/**
 * StepSignature.jsx - Étape finale du wizard certificat
 * ============================================================================
 * Résumé compact + signature client + génération PDF.
 * Déclenche : signature → PDF → upload → transition réalisé.
 * ============================================================================
 */

import { useState } from 'react';
import { Loader2, FileText, Download, CheckCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '@apps/artisan/components/FormFields';
import { CertificatSignaturePad } from '../CertificatSignaturePad';
import { EQUIPMENT_CATEGORY_LABELS } from '../constants';

export function StepSignature({
  formData,
  client,
  certificatId,
  onSign,
  onGeneratePdf,
  isSigning,
  isGeneratingPdf,
  pdfUrl,
  pdfError,
}) {
  const [signatureBase64, setSignatureBase64] = useState(formData.signature_client_base64 || null);
  const [signataireNom, setSignataireNom] = useState(formData.signature_client_nom || client?.display_name || '');
  const [showPad, setShowPad] = useState(!formData.signature_client_base64);

  const hasPdf = !!pdfUrl;
  const hasSignature = !!signatureBase64;

  const handleSign = async (dataUrl) => {
    setSignatureBase64(dataUrl);
    setShowPad(false);
    if (onSign) {
      await onSign(dataUrl, signataireNom);
    }
  };

  const handleRedo = () => {
    setSignatureBase64(null);
    setShowPad(true);
  };

  const bilanLabel = formData.bilan_conformite === 'conforme' ? 'Conforme' :
    formData.bilan_conformite === 'anomalie' ? 'Anomalie(s)' :
    formData.bilan_conformite === 'arret_urgence' ? "Arrêt d'urgence" : '—';

  const bilanClass = formData.bilan_conformite === 'conforme' ? 'text-green-600' :
    formData.bilan_conformite === 'anomalie' ? 'text-orange-600' :
    formData.bilan_conformite === 'arret_urgence' ? 'text-red-600' : 'text-gray-500';

  return (
    <div className="space-y-6">
      {/* Résumé compact */}
      <SectionTitle>Résumé de l'intervention</SectionTitle>
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Client</span>
          <span className="font-medium text-gray-800">{client?.display_name || '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Équipement</span>
          <span className="font-medium text-gray-800">
            {EQUIPMENT_CATEGORY_LABELS[formData.equipement_type] || '—'}
            {formData.equipement_marque && ` — ${formData.equipement_marque}`}
            {formData.equipement_modele && ` ${formData.equipement_modele}`}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Date</span>
          <span className="font-medium text-gray-800">{formData.date_intervention || '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Technicien</span>
          <span className="font-medium text-gray-800">{formData.technicien_nom || '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Bilan</span>
          <span className={`font-semibold ${bilanClass}`}>{bilanLabel}</span>
        </div>
        {(formData.pieces_remplacees || []).length > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-500">Pièces remplacées</span>
            <span className="font-medium text-gray-800">{formData.pieces_remplacees.length}</span>
          </div>
        )}
      </div>

      {/* Zone signature — afficher le pad ou la signature capturée */}
      {!hasPdf && showPad && (
        <CertificatSignaturePad
          onSign={handleSign}
          onClear={() => setSignatureBase64(null)}
          signataireNom={signataireNom}
          onSignataireNomChange={setSignataireNom}
          isSaving={isSigning}
          existingSignature={null}
          disabled={false}
        />
      )}

      {/* Signature capturée — aperçu + refaire */}
      {!hasPdf && hasSignature && !showPad && (
        <div className="space-y-3">
          <SectionTitle>Signature client</SectionTitle>
          <div className="border border-gray-200 rounded-lg p-4 bg-white">
            <img src={signatureBase64} alt="Signature" className="max-h-[150px] mx-auto" />
            <p className="text-center text-sm text-gray-500 mt-2">Signé par {signataireNom}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleRedo}
            className="min-h-[44px]"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Refaire la signature
          </Button>
        </div>
      )}

      {/* Bouton génération PDF — visible dès que la signature est capturée */}
      {hasSignature && !hasPdf && !isGeneratingPdf && !showPad && (
        <Button
          type="button"
          onClick={() => onGeneratePdf?.()}
          className="w-full min-h-[52px] text-base bg-[#1B4F72] hover:bg-[#154360] text-white"
        >
          <FileText className="w-5 h-5 mr-2" />
          Valider et générer le certificat PDF
        </Button>
      )}

      {/* Loader génération */}
      {isGeneratingPdf && (
        <div className="flex items-center justify-center gap-3 p-6 bg-blue-50 rounded-lg">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="text-sm font-medium text-blue-800">Génération du PDF en cours...</span>
        </div>
      )}

      {/* Erreur PDF */}
      {pdfError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          Erreur lors de la génération : {pdfError}
        </div>
      )}

      {/* PDF généré */}
      {hasPdf && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center space-y-4">
          <CheckCircle className="w-12 h-12 text-green-600 mx-auto" />
          <p className="text-lg font-semibold text-green-800">Certificat généré avec succès</p>
          <p className="text-sm text-green-700">
            Le document a été signé et sauvegardé. L'entretien est marqué comme réalisé.
          </p>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors min-h-[48px]"
          >
            <Download className="w-4 h-4" />
            Télécharger le PDF
          </a>
        </div>
      )}
    </div>
  );
}
