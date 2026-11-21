/**
 * EnvoiProposition — envoyer au client la proposition de contrat d'entretien, sans fenêtre.
 * ============================================================================
 * Deux pièces, un seul geste (`useContractProposal`, la même définition de l'envoi que la fiche
 * client) :
 *   - `EnvoiPropositionDOffice` : sans affichage, montée par la fenêtre de création quand on a
 *     cliqué « Envoyer la proposition » — la proposition vient d'être créée, elle part dès que
 *     son chiffrage est chargé et stable, et la fenêtre attend la fin (`onFini`) pour se fermer ;
 *   - `BoutonEnvoiProposition` : la proposition existe et n'est pas partie (créée sans envoi,
 *     envoi en échec) — un clic l'envoie.
 *
 * Rien n'est avalé : client sans e-mail, lecture en échec ou envoi refusé se disent.
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

/** Lecture de la proposition d'un client et envoi, avec ses messages. `envoyer()` rend vrai si elle est partie. */
function useEnvoiProposition({ clientId, orgId, vientDEtreCreee = false }) {
  const { client, error: erreurClient } = useClient(clientId);
  const { contract, error: erreurContrat } = useClientContract(clientId);
  const { pret, envoyerProposition } = useContractProposal({ contract, client, clientId, orgId });

  const [etat, setEtat] = useState('repos'); // repos | envoi | fait
  const enCours = useRef(false);

  const envoyer = useCallback(async () => {
    if (enCours.current) return false;
    enCours.current = true;
    setEtat('envoi');
    try {
      const { envoyeA, marque } = await envoyerProposition();
      if (marque) toast.success(`Proposition de contrat envoyée à ${envoyeA}`);
      else toast.warning(`Proposition envoyée à ${envoyeA}, mais le contrat n’a pas pu être marqué « proposition envoyée »`);
      setEtat('fait');
      return true;
    } catch (err) {
      logger.error('[EnvoiProposition] envoi refusé:', err);
      const cause = err?.message || 'erreur inconnue';
      toast.error(vientDEtreCreee
        ? `La proposition est créée, mais n’est pas partie : ${cause}`
        : `La proposition n’est pas partie : ${cause}`);
      setEtat('repos');
      return false;
    } finally {
      enCours.current = false;
    }
  }, [envoyerProposition, vientDEtreCreee]);

  return {
    client,
    pret,
    etat,
    envoyer,
    erreurLecture: Boolean(erreurClient || erreurContrat),
    sansEmail: Boolean(client) && !client.email,
    pasEncorePartie: Boolean(contract)
      && contract.status === 'pending'
      && (!contract.workflow_status || contract.workflow_status === 'nouveau'),
  };
}

/**
 * Envoi d'office de la proposition qui vient d'être créée. N'affiche rien ; appelle `onFini` une
 * seule fois, que la proposition soit partie ou non (le message dit lequel).
 *
 * @param {Object} props
 * @param {string} props.clientId
 * @param {string} props.orgId
 * @param {() => void} props.onFini
 */
export function EnvoiPropositionDOffice({ clientId, orgId, onFini }) {
  const { pret, envoyer, erreurLecture, sansEmail, pasEncorePartie } = useEnvoiProposition({ clientId, orgId, vientDEtreCreee: true });

  // Lus par référence : leur identité change d'un rendu à l'autre et ne doit pas relancer l'attente.
  const envoyerRef = useRef(envoyer);
  envoyerRef.current = envoyer;
  const onFiniRef = useRef(onFini);
  onFiniRef.current = onFini;

  const tente = useRef(false);
  const fini = useRef(false);
  const terminer = useCallback(() => {
    if (fini.current) return;
    fini.current = true;
    onFiniRef.current?.();
  }, []);

  useEffect(() => {
    if (tente.current) return undefined;
    if (erreurLecture) {
      tente.current = true;
      toast.error('La proposition est créée, mais n’a pas pu être envoyée : sa lecture a échoué.');
      terminer();
      return undefined;
    }
    if (!pret) return undefined;
    if (!pasEncorePartie) {
      tente.current = true;
      terminer();
      return undefined;
    }
    if (sansEmail) {
      tente.current = true;
      toast.warning('Proposition créée, mais pas envoyée : ce client n’a pas d’adresse e-mail.');
      terminer();
      return undefined;
    }
    const minuteur = setTimeout(() => {
      tente.current = true;
      envoyerRef.current().finally(terminer);
    }, DELAI_STABLE_MS);
    return () => clearTimeout(minuteur);
  }, [pret, pasEncorePartie, sansEmail, erreurLecture, terminer]);

  // Chiffrage jamais prêt (proposition introuvable, lecture qui ne répond pas) : on le dit.
  useEffect(() => {
    const minuteur = setTimeout(() => {
      if (tente.current) return;
      tente.current = true;
      toast.warning('La proposition est créée, mais n’est pas encore partie : envoyez-la depuis la fiche.');
      terminer();
    }, DELAI_RENONCEMENT_MS);
    return () => clearTimeout(minuteur);
  }, [terminer]);

  return null;
}

/**
 * Bouton « Envoyer la proposition » : un clic envoie, sans fenêtre.
 *
 * @param {Object} props
 * @param {string} props.clientId
 * @param {string} props.orgId
 * @param {() => void} [props.onEnvoye] appelé une fois la proposition partie
 * @param {string} [props.className]
 */
export function BoutonEnvoiProposition({ clientId, orgId, onEnvoye, className }) {
  const { client, pret, etat, envoyer, erreurLecture, sansEmail } = useEnvoiProposition({ clientId, orgId });

  if (etat === 'fait') return null;

  const enAttente = etat === 'envoi' || (!pret && !erreurLecture);
  const titre = erreurLecture ? 'La proposition n’a pas pu être lue : rechargez la page'
    : sansEmail ? 'Ce client n’a pas d’adresse e-mail : renseignez-la sur sa fiche'
      : !pret ? 'Préparation de la proposition…'
        : `Envoie la proposition par e-mail à ${client.email}`;

  return (
    <button
      type="button"
      onClick={async () => { if (await envoyer()) onEnvoye?.(); }}
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
