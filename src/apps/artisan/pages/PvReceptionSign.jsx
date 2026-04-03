/**
 * PvReceptionSign.jsx - Majord'home Artisan
 * ============================================================================
 * Page plein écran dédiée à la signature du PV de Réception sur tablette.
 * Flow : le technicien remplit les infos, le client + technicien signent
 *        → le PDF est généré avec les 2 signatures, uploadé, et le chantier
 *        peut passer en "Réceptionné".
 *
 * Route : /artisan/chantiers/:leadId/pv-reception
 * ============================================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';

import { useAuth } from '@/contexts/AuthContext';
import { chantierKeys } from '@hooks/cacheKeys';
import { chantiersService } from '@services/chantiers.service';
import { storageService } from '@services/storage.service';
import { formatEuro, formatDateFR } from '@/lib/utils';
import { generatePvReceptionPdfBlob } from '../components/chantiers/PvReceptionPDF';
import { CertificatSignaturePad } from '../components/certificat/CertificatSignaturePad';
import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// HOOK : Charger le chantier (via vue majordhome_chantiers)
// ============================================================================

function useChantier(leadId) {
  const [chantier, setChantier] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!leadId) { setIsLoading(false); return; }
    async function load() {
      const { data } = await supabase
        .from('majordhome_chantiers')
        .select('*')
        .eq('id', leadId)
        .single();
      setChantier(data || null);
      setIsLoading(false);
    }
    load();
  }, [leadId]);

  return { chantier, isLoading };
}

// ============================================================================
// PAGE
// ============================================================================

export default function PvReceptionSign() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // -- Données --
  const { chantier, isLoading } = useChantier(leadId);

  // -- State : formulaire --
  const [receptionType, setReceptionType] = useState('sans_reserves');
  const [reservesNature, setReservesNature] = useState('');
  const [reservesTravaux, setReservesTravaux] = useState('');
  const [infoRecues, setInfoRecues] = useState(true);
  const [noticesRecues, setNoticesRecues] = useState(true);
  const [entretienRecues, setEntretienRecues] = useState(true);

  // -- State : signatures --
  const [sigClientBase64, setSigClientBase64] = useState(null);
  const [sigClientNom, setSigClientNom] = useState('');
  const [sigTechBase64, setSigTechBase64] = useState(null);
  const [sigTechNom, setSigTechNom] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Pré-remplir noms
  useEffect(() => {
    if (chantier && !sigClientNom) {
      const name = [chantier.last_name, chantier.first_name].filter(Boolean).join(' ');
      if (name) setSigClientNom(name);
    }
  }, [chantier, sigClientNom]);

  useEffect(() => {
    if (user && !sigTechNom) {
      const name = user.user_metadata?.full_name || user.email || '';
      if (name) setSigTechNom(name);
    }
  }, [user, sigTechNom]);

  // -- Infos chantier --
  const clientName = useMemo(() => {
    if (!chantier) return '';
    return [chantier.last_name, chantier.first_name].filter(Boolean).join(' ') || 'Client';
  }, [chantier]);

  const amount = useMemo(() => {
    if (!chantier) return 0;
    return Number(chantier.order_amount_ht) || Number(chantier.estimated_revenue) || 0;
  }, [chantier]);

  // -- Validation --
  const canSubmit = sigClientBase64 && sigClientNom?.trim() && sigTechBase64 && sigTechNom?.trim();

  // -- Générer + uploader le PDF --
  const handleGenerate = useCallback(async () => {
    if (!chantier || !canSubmit || isSaving) return;

    setIsSaving(true);
    try {
      const now = new Date();
      const pvDate = formatDateFR(now.toISOString());
      const pvNumber = `PV-${chantier.id?.slice(0, 8)?.toUpperCase()}`;

      const pdfData = {
        pvNumber,
        pvDate,
        clientName,
        clientAddress: chantier.address || '-',
        clientPostalCode: chantier.postal_code || '',
        clientCity: chantier.city || '',
        clientPhone: chantier.phone || '',
        clientEmail: chantier.email || '',
        equipmentLabel: chantier.equipment_type_label || 'Équipement',
        equipmentRef: null,
        orderAmountHT: amount > 0 ? formatEuro(amount) : null,
        technicianName: sigTechNom.trim(),
        receptionType,
        reservesNature: receptionType === 'avec_reserves' ? reservesNature : null,
        reservesTravaux: receptionType === 'avec_reserves' ? reservesTravaux : null,
        infoRecues,
        noticesRecues,
        entretienRecues,
        signatureClientBase64: sigClientBase64,
        signatureClientNom: sigClientNom.trim(),
        signatureTechBase64: sigTechBase64,
        signatureTechNom: sigTechNom.trim(),
        lieu: chantier.city || '',
      };

      // Générer le PDF
      const blob = await generatePvReceptionPdfBlob(pdfData);

      // Upload
      const safeName = clientName.replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').replace(/\s+/g, '_');
      const storagePath = `pv-reception/${chantier.id}/PV_Reception_-_${safeName}.pdf`;

      const { error: uploadError } = await storageService.uploadFile(
        'interventions',
        storagePath,
        blob,
        { upsert: true, contentType: 'application/pdf' },
      );
      if (uploadError) throw uploadError;

      // Enregistrer le chemin en DB
      const { error: dbError } = await chantiersService.updatePvReceptionPath(chantier.id, storagePath);
      if (dbError) throw dbError;

      // Invalider le cache
      queryClient.invalidateQueries({ queryKey: chantierKeys.all });

      toast.success('PV de réception signé et généré');
      navigate('/chantiers');
    } catch (err) {
      console.error('[PvReceptionSign] Error:', err);
      toast.error('Erreur lors de la génération du PV');
    } finally {
      setIsSaving(false);
    }
  }, [chantier, canSubmit, isSaving, clientName, amount, receptionType, reservesNature, reservesTravaux, infoRecues, noticesRecues, entretienRecues, sigClientBase64, sigClientNom, sigTechBase64, sigTechNom, queryClient, navigate]);

  // -- Loading --
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin mx-auto" />
          <p className="mt-3 text-sm text-secondary-500">Chargement du chantier...</p>
        </div>
      </div>
    );
  }

  if (!chantier) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-6 bg-red-50 border border-red-200 rounded-lg text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
        <p className="text-sm text-red-700">Chantier introuvable.</p>
        <Link to="/chantiers" className="text-sm text-orange-600 hover:underline">
          Retour aux chantiers
        </Link>
      </div>
    );
  }

  // Déjà signé
  if (chantier.pv_reception_path) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-6 bg-green-50 border border-green-200 rounded-lg text-center space-y-3">
        <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto" />
        <p className="text-sm text-green-700">Le PV de réception a déjà été signé.</p>
        <Link to="/chantiers" className="text-sm text-orange-600 hover:underline">
          Retour aux chantiers
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/chantiers" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">PV de Réception des Travaux</h1>
          <p className="text-sm text-gray-500">{clientName}</p>
        </div>
      </div>

      {/* Résumé chantier */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-[#F97316] text-white px-6 py-4">
          <h2 className="text-lg font-bold">Procès-verbal de Réception</h2>
          <p className="text-sm text-orange-100">Mayer Énergie — Réception des travaux</p>
        </div>

        <div className="p-6 space-y-6">
          {/* Informations client */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Client</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div><span className="text-gray-500">Nom : </span><span className="font-medium">{clientName}</span></div>
              <div><span className="text-gray-500">Téléphone : </span><span className="font-medium">{chantier.phone || '-'}</span></div>
              <div><span className="text-gray-500">Adresse : </span><span className="font-medium">{chantier.address || '-'}</span></div>
              <div><span className="text-gray-500">Ville : </span><span className="font-medium">{chantier.postal_code} {chantier.city}</span></div>
            </div>
          </div>

          {/* Objet des travaux */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Objet des travaux</h3>
            <div className="text-sm space-y-1">
              <p>Installation et mise en service : <span className="font-medium">{chantier.equipment_type_label || 'Équipement'}</span></p>
              {amount > 0 && <p>Montant HT : <span className="font-medium">{formatEuro(amount)}</span></p>}
            </div>
          </div>

          {/* Type de réception */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Déclaration de réception</h3>
            <div className="space-y-3">
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-gray-50"
                     style={receptionType === 'sans_reserves' ? { borderColor: '#16a34a', backgroundColor: '#f0fdf4' } : {}}>
                <input
                  type="radio"
                  name="receptionType"
                  value="sans_reserves"
                  checked={receptionType === 'sans_reserves'}
                  onChange={() => setReceptionType('sans_reserves')}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium">Accepter la réception sans réserves</p>
                  <p className="text-xs text-gray-500">Les travaux sont conformes et terminés</p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-gray-50"
                     style={receptionType === 'avec_reserves' ? { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' } : {}}>
                <input
                  type="radio"
                  name="receptionType"
                  value="avec_reserves"
                  checked={receptionType === 'avec_reserves'}
                  onChange={() => setReceptionType('avec_reserves')}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium">Accepter la réception avec réserves</p>
                  <p className="text-xs text-gray-500">Des points restent à corriger</p>
                </div>
              </label>

              {receptionType === 'avec_reserves' && (
                <div className="ml-7 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nature des réserves</label>
                    <textarea
                      value={reservesNature}
                      onChange={(e) => setReservesNature(e.target.value)}
                      placeholder="Décrivez les réserves..."
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Travaux à exécuter</label>
                    <textarea
                      value={reservesTravaux}
                      onChange={(e) => setReservesTravaux(e.target.value)}
                      placeholder="Décrivez les travaux restants..."
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Confirmations */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Le client reconnaît avoir reçu</h3>
            <div className="space-y-2">
              {[
                { label: 'Les informations nécessaires pour le fonctionnement des matériels installés', value: infoRecues, set: setInfoRecues },
                { label: 'Les notices d\'utilisation en français des matériels installés', value: noticesRecues, set: setNoticesRecues },
                { label: 'Les informations relatives à l\'entretien et la maintenance des matériels installés', value: entretienRecues, set: setEntretienRecues },
              ].map((item, idx) => (
                <label key={idx} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.value}
                    onChange={(e) => item.set(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="text-sm text-gray-700">{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Signature technicien */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Signature du technicien</h3>
            <CertificatSignaturePad
              onSign={setSigTechBase64}
              onClear={() => setSigTechBase64(null)}
              signataireNom={sigTechNom}
              onSignataireNomChange={setSigTechNom}
              existingSignature={sigTechBase64}
              isSaving={isSaving}
              disclaimerText="En signant, le technicien atteste que les travaux ont été réalisés conformément aux règles de l'art."
            />
          </div>

          {/* Signature client */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Signature du client</h3>
            <CertificatSignaturePad
              onSign={setSigClientBase64}
              onClear={() => setSigClientBase64(null)}
              signataireNom={sigClientNom}
              onSignataireNomChange={setSigClientNom}
              existingSignature={sigClientBase64}
              isSaving={isSaving}
              disclaimerText="En signant, le client reconnaît avoir réceptionné les travaux dans les conditions décrites ci-dessus."
            />
          </div>
        </div>
      </div>

      {/* Bouton final */}
      <div className="sticky bottom-4 bg-white/90 backdrop-blur-sm border rounded-xl p-4 shadow-lg">
        <Button
          onClick={handleGenerate}
          disabled={!canSubmit || isSaving}
          className="w-full min-h-[52px] text-base bg-[#F97316] hover:bg-[#EA580C] text-white disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Génération du PV...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5 mr-2" />
              Générer le PV de Réception signé
            </>
          )}
        </Button>
        {!canSubmit && (
          <p className="text-center text-xs text-gray-500 mt-2">
            Les deux signatures sont requises pour générer le PV
          </p>
        )}
      </div>
    </div>
  );
}
