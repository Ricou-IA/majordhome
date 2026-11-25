/**
 * SAVProjet.jsx — « Devis de remplacement » : la demande SAV devient un projet
 * ============================================================================
 * Le SAV est une porte d'entrée (Eric 2026-11-25) : quand la demande aboutit à un devis de
 * remplacement, on crée le projet (lead) dès que le devis existe, avec les devis Pennylane du
 * client qui ne sont rattachés à rien — même voie que « Créer le lead » de l'écran Devis
 * (CreateLeadFromQuoteModal : contact Pennylane, filet anti-doublon, rattachement). La carte
 * SAV est reliée au lead (`interventions.lead_id`) ; ensuite sa place se lit sur le projet :
 * devis en attente, refusé, ou chantier créé à l'acceptation.
 *
 * Règles : src/lib/savProjet.js. Le composant affiche et enchaîne, il ne calcule rien.
 * ============================================================================
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { HardHat, Loader2, ExternalLink, Unlink } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { usePennylaneEnabled } from '@hooks/useOrgSettings';
import { useEntretienSAVMutations } from '@hooks/useEntretienSAV';
import { useEtatsProjets, useDevisDeRemplacement, useLierProjetSav } from '@hooks/useSavProjet';
import { etatProjet, mentionProjet, statutApresLiaison } from '@/lib/savProjet';
import { CreateLeadFromQuoteModal } from '@apps/artisan/components/devis/CreateLeadFromQuoteModal';

const TON = {
  info: 'bg-st-info-bg text-st-info',
  ok: 'bg-st-ok-bg text-st-ok',
  alerte: 'bg-st-alerte-bg text-st-alerte',
  neutre: 'bg-secondary-100 text-secondary-600',
};

const BOUTON = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-all disabled:opacity-50';

/**
 * @param {Object} props
 * @param {Object} props.item carte SAV (ligne de `majordhome_entretien_sav`)
 * @param {boolean} [props.canEdit] la personne peut modifier la carte (bureau)
 * @param {() => void} [props.onUpdated] rafraîchir le kanban
 */
export function SAVProjet({ item, canEdit = true, onUpdated }) {
  const navigate = useNavigate();
  const { organization } = useAuth();
  const orgId = organization?.id;
  const pennylaneActif = usePennylaneEnabled();
  const { updateFields, updateWorkflowStatus } = useEntretienSAVMutations();
  const { lier, isPending: liaison } = useLierProjetSav();
  const [creation, setCreation] = useState(false);

  // État du projet relié, lu dans le pipeline (la fiche s'ouvre aussi hors du kanban).
  const { etats } = useEtatsProjets(orgId, item.lead_id ? [item.lead_id] : []);
  const projet = etatProjet(item, etats);
  const mention = mentionProjet(projet);
  // Projet en cours ou passé en chantier : plus rien à proposer. Refusé ou lead disparu : on peut recommencer.
  const peutProposer = canEdit && pennylaneActif && !!item.client_id
    && (!projet || projet.etat === 'perdu' || projet.etat === 'absent');
  const { orphelins, projet: projetExistant, connu, isLoading, error } = useDevisDeRemplacement({ item, enabled: peutProposer });

  const relier = async (leadId, message) => {
    if (!leadId) return;
    try {
      await lier(item.id, leadId);
      if (!item.devis_status) await updateFields(item.id, { devis_status: 'envoye' });
      const statut = statutApresLiaison(item);
      if (statut) await updateWorkflowStatus(item.id, statut);
      toast.success(message, {
        action: { label: 'Voir', onClick: () => navigate(`/pipeline?tab=kanban&lead=${leadId}`) },
      });
    } catch (err) {
      toast.error(err?.message || 'La demande n’a pas pu être reliée au projet');
    } finally {
      onUpdated?.();
    }
  };

  const delier = async () => {
    try {
      await lier(item.id, null);
      toast.success('Demande déliée du projet');
    } catch (err) {
      toast.error(err?.message || 'La demande n’a pas pu être déliée');
    } finally {
      onUpdated?.();
    }
  };

  const handleClick = () => {
    if (error) { toast.error('Devis Pennylane illisibles pour le moment : réessayez'); return; }
    if (!connu) return;
    if (orphelins.length > 0) { setCreation(true); return; }
    if (projetExistant && projetExistant.lead_id !== item.lead_id) {
      relier(projetExistant.lead_id, 'Demande reliée au projet en cours');
      return;
    }
    toast.info('Aucun devis Pennylane en attente pour ce client', {
      description: 'Faites le devis dans Pennylane : il apparaît ici dans les cinq minutes.',
    });
  };

  const autreProjet = projetExistant && projetExistant.lead_id !== item.lead_id;
  const libelle = orphelins.length > 0
    ? `Devis de remplacement (${orphelins.length})`
    : (autreProjet ? 'Relier au projet en cours' : 'Devis de remplacement');
  const titre = orphelins.length > 0
    ? 'Créer le projet avec les devis Pennylane de ce client : il se suit dans Leads, le chantier se crée à l’acceptation'
    : (autreProjet
      ? `Les devis de ce client sont déjà sur un projet${projetExistant.lead_name ? ` (${projetExistant.lead_name})` : ''} : y relier la demande`
      : 'Le SAV débouche sur un remplacement : créer le projet à partir du devis Pennylane');

  return (
    <>
      {mention && (
        <span className="inline-flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-1 rounded ${TON[mention.ton]}`}>{mention.texte}</span>
          {projet.etat === 'chantier' ? (
            <button type="button" onClick={() => navigate('/chantiers')} className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline">
              <ExternalLink className="w-3.5 h-3.5" /> Voir les chantiers
            </button>
          ) : (
            <button type="button" onClick={() => navigate(`/pipeline?tab=kanban&lead=${projet.leadId}`)} className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline">
              <ExternalLink className="w-3.5 h-3.5" /> Voir le projet
            </button>
          )}
          {canEdit && projet.etat !== 'chantier' && (
            <button
              type="button"
              onClick={delier}
              disabled={liaison}
              title="Délier la demande du projet : la carte redevient une demande SAV ordinaire, le projet reste dans Leads"
              className="inline-flex items-center gap-1 text-xs text-secondary-500 hover:text-secondary-700 disabled:opacity-50"
            >
              <Unlink className="w-3.5 h-3.5" /> Délier
            </button>
          )}
        </span>
      )}

      {peutProposer && (
        <button
          type="button"
          onClick={handleClick}
          disabled={isLoading || liaison}
          title={titre}
          className={`${BOUTON} text-secondary-700 bg-white border-secondary-300 hover:bg-secondary-50`}
        >
          {isLoading || liaison ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardHat className="w-4 h-4" />}
          {libelle}
        </button>
      )}

      {/* Rendue hors de la fiche (portail) : son corps défile. */}
      {creation && createPortal(
        <CreateLeadFromQuoteModal
          quotes={orphelins}
          clientId={item.client_id}
          onClose={() => setCreation(false)}
          onCreated={(leadId) => {
            setCreation(false);
            relier(leadId, 'Projet créé : il se suit dans Leads');
          }}
        />,
        document.body,
      )}
    </>
  );
}

export default SAVProjet;
