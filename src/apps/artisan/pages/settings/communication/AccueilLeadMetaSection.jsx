/**
 * AccueilLeadMetaSection.jsx — e-mail d'accueil des leads Meta Ads
 * ============================================================================
 * Une ligne `EmailAutoLigne` + un interrupteur. Allumer = s'assurer que le
 * texte existe (gabarit `accueil_lead_meta`) PUIS poser
 * `settings.lead_welcome_email` (enabled_since = maintenant : les leads déjà
 * présents ne reçoivent rien). L'envoi est fait par l'edge lead-welcome-email
 * (pg_cron, 5 min).
 * ============================================================================
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { mailCampaignKeys } from '@hooks/cacheKeys';
import { formatDateFR } from '@/lib/utils';
import { DEFAULT_LEAD_WELCOME_EMAIL, leadWelcomeSettings, toggleLeadWelcome } from '@/lib/leadWelcomeEmail';
import EmailAutoLigne from './EmailAutoLigne';
import { assurerTexteEmail } from './assurerTexteEmail';

const TITRE = 'Confirmer leur demande aux prospects Facebook et Instagram';

export default function AccueilLeadMetaSection({ orgId }) {
  const { settings, save, isSaving } = useOrgSettings();
  const queryClient = useQueryClient();
  const [enCours, setEnCours] = useState(false);
  const reglage = leadWelcomeSettings(settings);

  const basculer = async () => {
    if (!orgId || enCours) return;
    const actif = !reglage.enabled;
    setEnCours(true);
    try {
      if (actif) {
        await assurerTexteEmail(orgId, DEFAULT_LEAD_WELCOME_EMAIL);
        queryClient.invalidateQueries({ queryKey: mailCampaignKeys.all(orgId) });
      }
      await save({ lead_welcome_email: toggleLeadWelcome(actif) });
      toast.success(actif ? 'Confirmation activée pour les prospects Facebook et Instagram' : 'Confirmation désactivée');
    } catch (err) {
      toast.error(err.message || 'Enregistrement échoué');
    } finally {
      setEnCours(false);
    }
  };

  return (
    <EmailAutoLigne
      orgId={orgId}
      gabarit={DEFAULT_LEAD_WELCOME_EMAIL}
      titre={TITRE}
      description={reglage.enabled
        ? `Activé depuis le ${formatDateFR(reglage.enabled_since)} : chaque nouvelle demande reçoit un e-mail de confirmation dans les minutes qui suivent.`
        : 'Un e-mail part automatiquement après chaque nouvelle demande reçue par une publicité. Les demandes déjà reçues ne sont pas concernées.'}
      controle={(
        <button
          type="button"
          role="switch"
          aria-checked={reglage.enabled}
          aria-label={TITRE}
          onClick={basculer}
          disabled={isSaving || enCours}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${reglage.enabled ? 'bg-primary-600' : 'bg-secondary-300'}`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${reglage.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      )}
    />
  );
}
