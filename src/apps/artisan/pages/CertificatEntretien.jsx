/**
 * CertificatEntretien.jsx - Majord'home Artisan
 * ============================================================================
 * Page route : /certificat/:interventionId
 *
 * Charge l'intervention + client + équipement + contrat + certificat existant,
 * puis monte le CertificatWizard.
 *
 * Cas :
 * - Certificat signé → affiche PDF + lien téléchargement
 * - Certificat brouillon → reprend le wizard
 * - Aucun certificat → wizard vierge pré-rempli
 *
 * @version 1.0.0 - Module Certificat d'Entretien & Ramonage
 * ============================================================================
 */

import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle, FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useIntervention } from '@hooks/useInterventions';
import { useCertificat } from '@hooks/useCertificats';
import { certificatsService } from '@services/certificats.service';
import { CertificatWizard } from '../components/certificat/CertificatWizard';
import { supabase } from '@/lib/supabaseClient';
import { useState, useEffect } from 'react';

// ============================================================================
// HOOK : Charger les équipements du client (pour StepEquipementType)
// ============================================================================

function useClientEquipments(clientId) {
  const [equipments, setEquipments] = useState([]);

  useEffect(() => {
    if (!clientId) return;

    async function load() {
      const { data } = await supabase
        .from('majordhome_equipments')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      setEquipments(data || []);
    }

    load();
  }, [clientId]);

  return equipments;
}

// ============================================================================
// HOOK : Chercher le technicien assigné via le RDV planning
// ============================================================================

function useAssignedTechnician(clientId, scheduledDate) {
  const [technicianName, setTechnicianName] = useState('');

  useEffect(() => {
    if (!clientId) return;

    async function lookup() {
      // Chercher le RDV maintenance le plus récent pour ce client
      const { data: appointments } = await supabase
        .from('majordhome_appointments')
        .select('id')
        .eq('client_id', clientId)
        .eq('appointment_type', 'maintenance')
        .order('scheduled_date', { ascending: false })
        .limit(1);

      if (!appointments?.[0]) return;

      // Récupérer les techniciens assignés à ce RDV
      const { data: techs } = await supabase
        .from('majordhome_appointment_technicians')
        .select('technician_id')
        .eq('appointment_id', appointments[0].id);

      if (!techs?.length) return;

      // Résoudre le nom via team_members
      const { data: members } = await supabase
        .from('majordhome_team_members')
        .select('display_name')
        .in('id', techs.map(t => t.technician_id));

      if (members?.length) {
        setTechnicianName(members.map(m => m.display_name).filter(Boolean).join(', '));
      }
    }

    lookup();
  }, [clientId, scheduledDate]);

  return technicianName;
}

// ============================================================================
// PAGE
// ============================================================================

export default function CertificatEntretien() {
  const { interventionId } = useParams();
  const { organization, user } = useAuth();
  const orgId = organization?.id;

  // Charger intervention + client + equipment
  const { intervention, client, equipment, isLoading: loadingIntervention, error: errorIntervention } = useIntervention(interventionId);

  // Charger certificat existant
  const { certificat, isLoading: loadingCertificat } = useCertificat(interventionId);

  // Charger équipements du client (pour le sélecteur)
  const clientEquipments = useClientEquipments(client?.id);

  // Chercher le technicien assigné via le RDV planning
  const assignedTechnician = useAssignedTechnician(client?.id, intervention?.scheduled_date);

  // Charger contrat si lié
  const [contract, setContract] = useState(null);
  useEffect(() => {
    if (!intervention?.contract_id) return;
    async function loadContract() {
      const { data } = await supabase
        .from('majordhome_contracts')
        .select('*')
        .eq('id', intervention.contract_id)
        .single();
      setContract(data);
    }
    loadContract();
  }, [intervention?.contract_id]);

  // Regénérer une URL signée fraîche quand le certificat a un pdf_storage_path
  const [freshPdfUrl, setFreshPdfUrl] = useState(null);
  const hasPdf = !!(certificat?.pdf_storage_path || certificat?.pdf_url);
  const isSigned = certificat?.statut === 'signe' || certificat?.signed_at;

  useEffect(() => {
    if (!certificat?.pdf_storage_path) return;
    certificatsService.getSignedUrl(certificat.pdf_storage_path).then(result => {
      if (result?.data) setFreshPdfUrl(result.data);
      else setFreshPdfUrl(certificat.pdf_url || null); // fallback
    });
  }, [certificat?.pdf_storage_path, certificat?.pdf_url]);

  const isLoading = loadingIntervention || loadingCertificat;

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin mx-auto" />
          <p className="mt-3 text-sm text-secondary-500">Chargement du certificat...</p>
        </div>
      </div>
    );
  }

  // ── Erreur ──
  if (errorIntervention || !intervention) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-6 bg-red-50 border border-red-200 rounded-lg text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
        <p className="text-sm text-red-700">
          {errorIntervention?.message || 'Intervention introuvable.'}
        </p>
        <Link to="/entretiens" className="text-sm text-blue-600 hover:underline">
          Retour aux entretiens
        </Link>
      </div>
    );
  }

  // ── Certificat signé avec PDF → Afficher le résultat ──
  if (isSigned && hasPdf && freshPdfUrl) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link to="/entretiens" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Certificat d'entretien</h1>
            <p className="text-sm text-gray-500">{certificat.reference}</p>
          </div>
        </div>

        {/* PDF */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center space-y-4">
          <FileText className="w-16 h-16 text-green-600 mx-auto" />
          <p className="text-lg font-semibold text-green-800">Certificat signé et généré</p>
          <p className="text-sm text-green-700">
            Signé par {certificat.signature_client_nom} le{' '}
            {certificat.signed_at ? new Date(certificat.signed_at).toLocaleDateString('fr-FR') : '—'}
          </p>
          <a
            href={freshPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors min-h-[48px] text-base"
          >
            <Download className="w-5 h-5" />
            Télécharger le PDF
          </a>
        </div>

        <div className="text-center">
          <Link to="/entretiens" className="text-sm text-blue-600 hover:underline">
            Retour aux entretiens
          </Link>
        </div>
      </div>
    );
  }

  // ── Wizard (brouillon, nouveau, ou réalisé sans certificat signé) ──
  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/entretiens" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Certificat d'entretien</h1>
          <p className="text-sm text-gray-500">
            {client?.display_name || client?.last_name || 'Client'}
            {equipment ? ` — ${equipment.brand || ''} ${equipment.model || ''}`.trim() : ''}
          </p>
        </div>
      </div>

      {/* Wizard */}
      <CertificatWizard
        intervention={intervention}
        client={client}
        equipment={equipment}
        contract={contract}
        clientEquipments={clientEquipments}
        existingCertificat={certificat}
        orgId={orgId}
        userId={user?.id}
        assignedTechnician={assignedTechnician}
      />
    </div>
  );
}
