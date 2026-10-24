/**
 * EmailAutoLigne.jsx — une ligne « e-mail envoyé automatiquement » de Réglages → Emails
 * ============================================================================
 * Langage d'artisan (retour Eric 2026-10-24 : « gabarit », variables et bouton
 * de création séparé = trop compliqué) : un titre, une phrase, éventuellement
 * un interrupteur (`controle`), et « Modifier le texte ». Le texte vit dans
 * `majordhome_mail_campaigns` (is_transactional) : s'il manque, il est créé
 * avec le texte par défaut (ou restauré s'il était archivé) au premier clic,
 * puis l'éditeur Mailing s'ouvre directement dessus (/mailing?tab=editor&edit=<clé>).
 * ============================================================================
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { mailCampaignKeys } from '@hooks/cacheKeys';
import { assurerTexteEmail } from './assurerTexteEmail';

export default function EmailAutoLigne({ orgId, gabarit, titre, description, controle = null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ouverture, setOuverture] = useState(false);

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

  return (
    <div className="border border-secondary-200 rounded-md p-3 text-sm flex items-center justify-between gap-4 mt-2">
      <div>
        <p className="text-secondary-900 font-medium">{titre}</p>
        {description && <p className="mt-1 text-xs text-secondary-500">{description}</p>}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <button
          type="button"
          onClick={modifier}
          disabled={ouverture}
          className="text-sm text-primary-600 hover:underline whitespace-nowrap disabled:opacity-50"
        >
          {ouverture ? 'Ouverture…' : 'Modifier le texte'}
        </button>
        {controle}
      </div>
    </div>
  );
}
