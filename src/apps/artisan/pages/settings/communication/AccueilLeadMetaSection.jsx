/**
 * AccueilLeadMetaSection.jsx — e-mail d'accueil des leads Meta Ads
 * ============================================================================
 * Interrupteur `settings.lead_welcome_email` + gabarit `accueil_lead_meta`.
 * L'envoi est fait par l'edge lead-welcome-email (pg_cron, 5 min). Activer pose
 * `enabled_since` à maintenant : les leads déjà présents ne reçoivent rien.
 * Sans gabarit créé, rien ne part (l'interrupteur est alors désactivé).
 * ============================================================================
 */

import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { mailCampaignKeys } from '@hooks/cacheKeys';
import { mailCampaignsService } from '@services/mailCampaigns.service';
import { formatDateTimeFR } from '@/lib/utils';
import {
  DEFAULT_LEAD_WELCOME_EMAIL, LEAD_WELCOME_PLACEHOLDERS, leadWelcomeSettings, toggleLeadWelcome,
} from '@/lib/leadWelcomeEmail';
import GabaritTransactionnel from './GabaritTransactionnel';

export default function AccueilLeadMetaSection({ orgId }) {
  const { settings, save, isSaving } = useOrgSettings();
  const reglage = leadWelcomeSettings(settings);

  // Même clé de cache que GabaritTransactionnel : une seule requête, mise à jour à la création.
  const { data: gabarit, isLoading } = useQuery({
    queryKey: mailCampaignKeys.byKey(orgId, DEFAULT_LEAD_WELCOME_EMAIL.key),
    queryFn: async () => {
      const { data, error } = await mailCampaignsService.getByKey(orgId, DEFAULT_LEAD_WELCOME_EMAIL.key);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  const basculer = async () => {
    const actif = !reglage.enabled;
    try {
      await save({ lead_welcome_email: toggleLeadWelcome(actif) });
      toast.success(actif ? 'E-mail d’accueil des leads Meta activé' : 'E-mail d’accueil des leads Meta désactivé');
    } catch (err) {
      toast.error(err.message || 'Enregistrement échoué');
    }
  };

  const verrouille = !reglage.enabled && !gabarit;

  return (
    <div className="mt-6">
      <div className="border border-secondary-200 rounded-md p-3 text-sm flex items-center justify-between gap-4">
        <div>
          <p className="text-secondary-900 font-medium">Envoyer un e-mail d&apos;accueil aux leads Meta</p>
          <p className="mt-1 text-xs text-secondary-500">
            {reglage.enabled
              ? `Actif depuis le ${formatDateTimeFR(reglage.enabled_since)} : chaque nouveau lead Meta avec un e-mail reçoit la confirmation, une seule fois, dans les 5 minutes.`
              : verrouille && !isLoading
                ? 'Créez d’abord le gabarit ci-dessous.'
                : 'Les leads déjà présents ne recevront rien : seuls les leads arrivés après l’activation sont concernés.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={reglage.enabled}
          onClick={basculer}
          disabled={isSaving || verrouille}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${reglage.enabled ? 'bg-primary-600' : 'bg-secondary-300'}`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${reglage.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
      <GabaritTransactionnel
        orgId={orgId} gabarit={DEFAULT_LEAD_WELCOME_EMAIL} placeholders={LEAD_WELCOME_PLACEHOLDERS}
        titre="Accueil lead Meta : confirmation de la demande"
      />
    </div>
  );
}
