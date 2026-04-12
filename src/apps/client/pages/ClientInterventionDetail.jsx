/**
 * ClientInterventionDetail.jsx - Portail Client
 * ============================================================================
 * Detail d'une intervention + certificat PDF (read-only).
 * ============================================================================
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useIntervention, useInterventionFileUrls } from '@hooks/useInterventions';
import { useCertificat } from '@hooks/useCertificats';
import { certificatsService } from '@services/certificats.service';
import {
  ArrowLeft, Calendar, User, Wrench, Clock, FileText,
  CheckCircle2, Download, Loader2, Image as ImageIcon,
} from 'lucide-react';
import { formatDateFR } from '@/lib/utils';

const STATUS_LABELS = {
  scheduled: 'Planifiée',
  planifie: 'Planifiée',
  in_progress: 'En cours',
  completed: 'Terminée',
  realise: 'Terminée',
  cancelled: 'Annulée',
  on_hold: 'En attente',
};

const TYPE_LABELS = {
  maintenance: 'Entretien',
  entretien: 'Entretien',
  repair: 'Réparation',
  sav: 'SAV',
  installation: 'Installation',
  diagnostic: 'Diagnostic',
  ramonage: 'Ramonage',
};

export default function ClientInterventionDetail() {
  const { id } = useParams();
  const { intervention, equipment, isLoading } = useIntervention(id);
  const { certificat, isLoading: certLoading } = useCertificat(id);
  const { photoBeforeUrl, photoAfterUrl, signatureUrl } = useInterventionFileUrls(intervention);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
      </div>
    );
  }

  if (!intervention) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Intervention introuvable.</p>
        <Link to="/client/interventions" className="text-primary-600 hover:underline mt-2 inline-block">
          Retour aux interventions
        </Link>
      </div>
    );
  }

  const handleDownloadPdf = async () => {
    if (!certificat?.pdf_path) return;
    setDownloadingPdf(true);
    try {
      const { url, error } = await certificatsService.getSignedUrl(certificat.pdf_path);
      if (error || !url) throw error || new Error('URL non disponible');
      window.open(url, '_blank');
    } catch {
      // silently fail
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/client/interventions"
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {TYPE_LABELS[intervention.intervention_type] || 'Intervention'}
          </h1>
          <p className="text-sm text-gray-500">
            {STATUS_LABELS[intervention.status] || intervention.status}
            {intervention.scheduled_date && ` - ${formatDateFR(intervention.scheduled_date)}`}
          </p>
        </div>
      </div>

      {/* Détails */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Détails</h2>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          {intervention.scheduled_date && (
            <div className="flex items-start gap-2">
              <Calendar className="w-4 h-4 text-gray-400 mt-0.5" />
              <div>
                <span className="text-gray-500">Date</span>
                <p className="font-medium text-gray-900">{formatDateFR(intervention.scheduled_date)}</p>
              </div>
            </div>
          )}

          {intervention.technician_name && (
            <div className="flex items-start gap-2">
              <User className="w-4 h-4 text-gray-400 mt-0.5" />
              <div>
                <span className="text-gray-500">Technicien</span>
                <p className="font-medium text-gray-900">{intervention.technician_name}</p>
              </div>
            </div>
          )}

          {equipment && (
            <div className="flex items-start gap-2">
              <Wrench className="w-4 h-4 text-gray-400 mt-0.5" />
              <div>
                <span className="text-gray-500">Équipement</span>
                <p className="font-medium text-gray-900">
                  {[equipment.brand, equipment.model].filter(Boolean).join(' ') || 'Non renseigné'}
                </p>
              </div>
            </div>
          )}

          {intervention.duration && (
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-gray-400 mt-0.5" />
              <div>
                <span className="text-gray-500">Durée</span>
                <p className="font-medium text-gray-900">{intervention.duration} min</p>
              </div>
            </div>
          )}
        </div>

        {/* Travaux effectués */}
        {intervention.work_performed && (
          <div className="mt-6 pt-4 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Travaux effectués</h3>
            <p className="text-sm text-gray-600 whitespace-pre-line">{intervention.work_performed}</p>
          </div>
        )}

        {/* Pièces remplacées */}
        {intervention.parts_replaced && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Pièces remplacées</h3>
            <p className="text-sm text-gray-600 whitespace-pre-line">{intervention.parts_replaced}</p>
          </div>
        )}

        {/* Commentaire client */}
        {intervention.client_comment && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Message du technicien</h3>
            <p className="text-sm text-gray-600 whitespace-pre-line">{intervention.client_comment}</p>
          </div>
        )}
      </div>

      {/* Photos */}
      {(photoBeforeUrl || photoAfterUrl) && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-gray-400" />
            Photos
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {photoBeforeUrl && (
              <div>
                <p className="text-sm text-gray-500 mb-2">Avant</p>
                <img src={photoBeforeUrl} alt="Avant intervention" className="rounded-lg w-full object-cover max-h-64" />
              </div>
            )}
            {photoAfterUrl && (
              <div>
                <p className="text-sm text-gray-500 mb-2">Après</p>
                <img src={photoAfterUrl} alt="Après intervention" className="rounded-lg w-full object-cover max-h-64" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Certificat */}
      {!certLoading && certificat && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Certificat d'entretien</h2>
                <p className="text-sm text-gray-500">
                  {certificat.signed_at ? `Signé le ${formatDateFR(certificat.signed_at)}` : 'En cours'}
                </p>
              </div>
            </div>
            {certificat.pdf_path && (
              <button
                onClick={handleDownloadPdf}
                disabled={downloadingPdf}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                {downloadingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Télécharger PDF
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
