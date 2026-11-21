/**
 * EmailAutoLigne.jsx — une ligne « e-mail envoyé automatiquement » de Réglages → Emails
 * ============================================================================
 * Langage d'artisan (retour Eric 2026-10-24 : « gabarit », variables et bouton
 * de création séparé = trop compliqué) : un titre, une phrase, éventuellement
 * un interrupteur (`controle`), « M'envoyer un essai » et « Modifier le texte ».
 *
 * Le texte part avec son défaut (registre `emailsAutomatiques.js`) tant que
 * l'entreprise ne l'a pas modifié. « Modifier le texte » crée sa ligne dans
 * `majordhome_mail_campaigns` (is_transactional) avec le texte par défaut (ou la
 * restaure si elle était archivée), puis ouvre l'éditeur Mailing dessus
 * (/mailing?tab=editor&edit=<clé>). « M'envoyer un essai » envoie l'e-mail tel
 * qu'il partira, à l'adresse du compte connecté (edge `email-essai`).
 * ============================================================================
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { mailCampaignKeys } from '@hooks/cacheKeys';
import { mailCampaignsService } from '@services/mailCampaigns.service';
import { messageErreurEssai } from '@/lib/emailsAutomatiques';
import { assurerTexteEmail } from './assurerTexteEmail';

const LIEN = 'text-sm text-primary-600 hover:underline whitespace-nowrap disabled:opacity-50';

export default function EmailAutoLigne({ orgId, gabarit, titre, description, controle = null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ouverture, setOuverture] = useState(false);
  const [essai, setEssai] = useState(false);

  const modifier = async () => {
    if (!orgId || ouverture) return;
    setOuverture(true);
    try {
      await assurerTexteEmail(orgId, gabarit);
      queryClient.invalidateQueries({ queryKey: mailCampaignKeys.all(orgId) });
      navigate(`/mailing?tab=editor&edit=${encodeURIComponent(gabarit.key)}`);
    } catch (err) {
      toast.error(err.message || 'Impossible d’ouvrir le texte');
      setOuverture(false);
    }
  };

  const envoyerEssai = async () => {
    if (!orgId || essai) return;
    setEssai(true);
    const { data, error } = await mailCampaignsService.envoyerEssai(orgId, gabarit.key);
    setEssai(false);
    if (error) {
      toast.error(messageErreurEssai(error.code, error.detail));
      return;
    }
    const texte = data?.source === 'entreprise' ? 'votre texte' : 'le texte par défaut';
    toast.success(`Essai envoyé à ${data?.envoye_a} avec ${texte} et des valeurs d’exemple, sans pièce jointe.`);
  };

  return (
    <div className="border border-secondary-200 rounded-md p-3 text-sm flex items-center justify-between gap-4 mt-2">
      <div>
        <p className="text-secondary-900 font-medium">{titre}</p>
        {description && <p className="mt-1 text-xs text-secondary-500">{description}</p>}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <button type="button" onClick={envoyerEssai} disabled={essai} className={LIEN}>
          {essai ? 'Envoi…' : 'M’envoyer un essai'}
        </button>
        <button type="button" onClick={modifier} disabled={ouverture} className={LIEN}>
          {ouverture ? 'Ouverture…' : 'Modifier le texte'}
        </button>
        {controle}
      </div>
    </div>
  );
}
