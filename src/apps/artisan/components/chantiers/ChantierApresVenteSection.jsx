/**
 * ChantierApresVenteSection.jsx - Majord'home Artisan
 * ============================================================================
 * Section « Après-vente » de la fiche d'un chantier réceptionné : demande d'avis
 * par SMS, contrat d'entretien, facturation. Les états viennent du module pur
 * `src/lib/chantierApresVente.js` (mêmes repères que la carte du board).
 * ============================================================================
 */

import { useState } from 'react';
import { HeartHandshake, MessageSquare, ScrollText, Receipt, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { chantierKeys } from '@hooks/cacheKeys';
import { supabase } from '@/lib/supabaseClient';
import { useChantiersApresVente, useDemanderAvisPose } from '@hooks/useChantiers';
import { contractsService } from '@services/contracts.service';
import {
  reperesApresVente, blocageAvis, messageAvisEnvoye, messageAvisRefuse,
} from '@/lib/chantierApresVente';
import { CreateContractModal } from '../entretiens/CreateContractModal';

function Ligne({ Icone, titre, etat, fait, children }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Icone className="w-4 h-4 text-gray-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">{titre}</p>
        <p className="text-xs text-gray-500 flex items-center gap-1">
          {fait && <Check className="w-3 h-3 text-emerald-600 shrink-0" />}
          {etat}
        </p>
      </div>
      {children}
    </div>
  );
}

const BOUTON = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-300 '
  + 'text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0';

export function ChantierApresVenteSection({ chantier, onUpdated, peutAgir = true }) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const listes = useChantiersApresVente(orgId);
  const { demanderAvis, envoiEnCoursPour } = useDemanderAvisPose();

  const [showContractModal, setShowContractModal] = useState(false);
  const [clientForContract, setClientForContract] = useState(null);
  const [loadingContract, setLoadingContract] = useState(false);

  const reperes = Object.fromEntries(reperesApresVente(chantier, listes).map((r) => [r.cle, r]));
  const avisBloque = blocageAvis(chantier, listes.avis);
  const envoiEnCours = envoiEnCoursPour === chantier.id;

  const handleDemanderAvis = async () => {
    try {
      toast.success(messageAvisEnvoye(await demanderAvis(chantier)));
    } catch (err) {
      const { texte, info } = messageAvisRefuse(err);
      if (info) toast.info(texte); else toast.error(texte);
    }
  };

  const handleProposeContract = async () => {
    if (!chantier.client_id) {
      toast.error('Aucun client lié à ce chantier');
      return;
    }
    setLoadingContract(true);
    try {
      // Un client ne porte qu'un contrat (contrainte unique sur client_id) : on relit avant d'ouvrir.
      const { data: existing, error: existingError } = await contractsService.getContractByClientId(chantier.client_id);
      if (existingError) throw existingError;
      if (existing) {
        toast.error('Ce client possède déjà un contrat');
        return;
      }
      const { data: client, error: clientErr } = await supabase
        .from('majordhome_clients')
        .select('id, display_name, first_name, last_name, address, postal_code, city, has_active_contract, project_id')
        .eq('id', chantier.client_id)
        .single();
      if (clientErr || !client) {
        toast.error('Impossible de charger les données client');
        return;
      }
      setClientForContract(client);
      setShowContractModal(true);
    } catch {
      toast.error('Erreur lors de la vérification');
    } finally {
      setLoadingContract(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
        <HeartHandshake className="w-4 h-4" />
        Après-vente
      </h3>

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        <Ligne Icone={MessageSquare} titre="Avis client" etat={reperes.avis.titre} fait={reperes.avis.etat === 'fait'}>
          {peutAgir && reperes.avis.etat !== 'fait' && (
            <button
              type="button"
              onClick={handleDemanderAvis}
              disabled={Boolean(avisBloque) || envoiEnCours}
              title={avisBloque || 'Envoie le SMS de demande d\'avis au client'}
              className={BOUTON}
            >
              {envoiEnCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
              Demander un avis par SMS
            </button>
          )}
        </Ligne>

        <Ligne Icone={ScrollText} titre="Contrat d'entretien" etat={reperes.contrat.titre} fait={reperes.contrat.etat === 'fait'}>
          {peutAgir && reperes.contrat.etat === 'a_faire' && (
            <button type="button" onClick={handleProposeContract} disabled={loadingContract} className={BOUTON}>
              {loadingContract ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScrollText className="w-3.5 h-3.5" />}
              Proposer un contrat
            </button>
          )}
        </Ligne>

        <Ligne Icone={Receipt} titre="Facturation" etat={reperes.facture.titre} fait={reperes.facture.etat === 'fait'} />
      </div>

      {showContractModal && (
        <CreateContractModal
          isOpen={showContractModal}
          onClose={() => setShowContractModal(false)}
          onSuccess={() => {
            setShowContractModal(false);
            queryClient.invalidateQueries({ queryKey: chantierKeys.apresVente(orgId) });
            onUpdated?.();
          }}
          preSelectedClient={clientForContract}
          preSelectedEquipmentTypeId={chantier.equipment_type_id || null}
          contractDefaults={{ status: 'pending', workflowStatus: 'nouveau', source: 'chantier' }}
        />
      )}
    </div>
  );
}

export default ChantierApresVenteSection;
