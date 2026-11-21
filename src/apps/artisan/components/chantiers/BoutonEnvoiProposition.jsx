/**
 * BoutonEnvoiProposition — envoie au client la proposition de contrat d'entretien, sans fenêtre.
 * ============================================================================
 * Fiche d'un chantier réceptionné. Deux usages, un seul geste (`useContractProposal`, la même
 * définition de l'envoi que la fiche client) :
 *   - `auto` : la proposition vient d'être créée depuis le chantier, elle part d'elle-même dès
 *     que son chiffrage est chargé (Eric 2026-11-21 : « à la création du contrat il faut
 *     l'envoyer simplement ») ;
 *   - sinon : la proposition existe et n'est pas partie (envoi automatique en échec, proposition
 *     créée ailleurs) — un clic l'envoie.
 *
 * Rien n'est avalé : client sans e-mail, lecture en échec ou envoi refusé se disent, et le bouton
 * reste pour réessayer. Un envoi d'office ne part qu'une fois, et jamais pour une proposition déjà
 * envoyée.
 * ============================================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useClient } from '@hooks/useClients';
import { useClientContract } from '@hooks/useContracts';
import { useContractProposal } from '@hooks/useContractProposal';
import { logger } from '@lib/logger';

// Le chiffrage se stabilise en deux temps (la zone tarifaire se détecte après le premier rendu) :
// l'envoi d'office attend que « prêt » tienne ce délai, pour ne pas partir sur un PDF sans lignes.
const DELAI_STABLE_MS = 500;
// Au-delà, l'envoi d'office renonce et le dit : la proposition reste à envoyer par le bouton.
const DELAI_RENONCEMENT_MS = 30_000;

/**
 * @param {Object} props
 * @param {string} props.clientId
 * @param {string} props.orgId
 * @param {boolean} [props.auto]      la proposition vient d'être créée : l'envoyer d'office
 * @param {() => void} [props.onEnvoye] appelé une fois la proposition partie
 * @param {string} [props.className]
 */
export function BoutonEnvoiProposition({ clientId, orgId, auto = false, onEnvoye, className }) {
  const { client, error: erreurClient } = useClient(clientId);
  const { contract, error: erreurContrat } = useClientContract(clientId);
  const { pret, envoyerProposition } = useContractProposal({ contract, client, clientId, orgId });

  const [etat, setEtat] = useState('repos'); // repos | envoi | fait
  const enCours = useRef(false);
  const dOfficeTente = useRef(false);
  // L'appelant passe une fonction recréée à chaque rendu : lue par référence, elle ne relance rien.
  const apresEnvoi = useRef(onEnvoye);
  apresEnvoi.current = onEnvoye;

  const sansEmail = Boolean(client) && !client.email;
  const pasEncorePartie = Boolean(contract)
    && contract.status === 'pending'
    && (!contract.workflow_status || contract.workflow_status === 'nouveau');

  const envoyer = useCallback(async () => {
    if (enCours.current) return;
    enCours.current = true;
    setEtat('envoi');
    try {
      const { envoyeA, marque } = await envoyerProposition();
      if (marque) toast.success(`Proposition de contrat envoyée à ${envoyeA}`);
      else toast.warning(`Proposition envoyée à ${envoyeA}, mais le contrat n’a pas pu être marqué « proposition envoyée »`);
      setEtat('fait');
      apresEnvoi.current?.();
    } catch (err) {
      logger.error('[BoutonEnvoiProposition] envoi refusé:', err);
      toast.error(`La proposition n’est pas partie : ${err?.message || 'erreur inconnue'}`);
      setEtat('repos');
    } finally {
      enCours.current = false;
    }
  }, [envoyerProposition]);

  // Envoi d'office, une seule fois.
  useEffect(() => {
    if (!auto || dOfficeTente.current) return undefined;
    if (erreurClient || erreurContrat) {
      dOfficeTente.current = true;
      toast.error('La proposition est créée mais n’a pas pu être envoyée : sa lecture a échoué. Utilisez « Envoyer la proposition ».');
      return undefined;
    }
    if (!pret) return undefined;
    if (!pasEncorePartie) {
      dOfficeTente.current = true;
      return undefined;
    }
    if (sansEmail) {
      dOfficeTente.current = true;
      toast.warning('Proposition créée, mais pas envoyée : ce client n’a pas d’adresse e-mail.');
      return undefined;
    }
    const minuteur = setTimeout(() => {
      dOfficeTente.current = true;
      envoyer();
    }, DELAI_STABLE_MS);
    return () => clearTimeout(minuteur);
  }, [auto, pret, pasEncorePartie, sansEmail, erreurClient, erreurContrat, envoyer]);

  // Chiffrage jamais prêt (proposition introuvable, lecture qui ne répond pas) : on le dit.
  useEffect(() => {
    if (!auto) return undefined;
    const minuteur = setTimeout(() => {
      if (dOfficeTente.current) return;
      dOfficeTente.current = true;
      toast.warning('La proposition est créée mais n’est pas encore partie : utilisez « Envoyer la proposition ».');
    }, DELAI_RENONCEMENT_MS);
    return () => clearTimeout(minuteur);
  }, [auto]);

  if (etat === 'fait') return null;

  const enAttente = etat === 'envoi' || (!pret && !erreurClient && !erreurContrat);
  const titre = erreurClient || erreurContrat ? 'La proposition n’a pas pu être lue : rechargez la page'
    : sansEmail ? 'Ce client n’a pas d’adresse e-mail : renseignez-la sur sa fiche'
      : !pret ? 'Préparation de la proposition…'
        : `Envoie la proposition par e-mail à ${client.email}`;

  return (
    <button
      type="button"
      onClick={envoyer}
      disabled={etat === 'envoi' || !pret || sansEmail}
      title={titre}
      className={className}
    >
      {enAttente ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
      {etat === 'envoi' ? 'Envoi en cours…' : 'Envoyer la proposition'}
    </button>
  );
}

export default BoutonEnvoiProposition;
