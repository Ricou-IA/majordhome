/**
 * AccueilLeadMetaSection.jsx — e-mail d'accueil des leads Meta Ads
 * ============================================================================
 * UNE ligne, un interrupteur (retour Eric 2026-10-24 : « gabarit », variables
 * et bouton de création séparé = trop compliqué pour un artisan).
 * Allumer = s'assurer que le texte existe (gabarit `accueil_lead_meta` créé
 * avec le texte par défaut, ou restauré s'il était archivé) PUIS poser
 * `settings.lead_welcome_email` (enabled_since = maintenant : les leads déjà
 * présents ne reçoivent rien). L'envoi est fait par l'edge lead-welcome-email
 * (pg_cron, 5 min). Le texte se modifie dans Mailing → Éditeur.
 * ============================================================================
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { mailCampaignKeys } from '@hooks/cacheKeys';
import { mailCampaignsService } from '@services/mailCampaigns.service';
import { formatDateFR } from '@/lib/utils';
import { DEFAULT_LEAD_WELCOME_EMAIL, leadWelcomeSettings, toggleLeadWelcome } from '@/lib/leadWelcomeEmail';

/** Le texte de l'e-mail existe (créé ou restauré) ; throw sinon. */
async function assurerTexte(orgId) {
  const { data: actif, error } = await mailCampaignsService.getByKey(orgId, DEFAULT_LEAD_WELCOME_EMAIL.key);
  if (error) throw error;
  if (actif) return;
  const { data: tous, error: lErr } = await mailCampaignsService.list(orgId, { includeArchived: true });
  if (lErr) throw lErr;
  const archive = (tous || []).find((c) => c.key === DEFAULT_LEAD_WELCOME_EMAIL.key);
  if (archive) {
    const { error: uErr } = await mailCampaignsService.unarchive(archive.id);
    if (uErr) throw uErr;
    return;
  }
  const { error: cErr } = await mailCampaignsService.create({ org_id: orgId, ...DEFAULT_LEAD_WELCOME_EMAIL });
  if (cErr) throw cErr;
}

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
        await assurerTexte(orgId);
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
    <div className="border border-secondary-200 rounded-md p-3 text-sm flex items-center justify-between gap-4 mt-2">
      <div>
        <p className="text-secondary-900 font-medium">Confirmer leur demande aux prospects Facebook et Instagram</p>
        <p className="mt-1 text-xs text-secondary-500">
          {reglage.enabled ? (
            <>
              Activé depuis le {formatDateFR(reglage.enabled_since)} : chaque nouvelle demande reçoit un e-mail de confirmation dans les minutes qui suivent.{' '}
              <Link to="/mailing" className="text-primary-600 hover:underline">Modifier le texte</Link>
            </>
          ) : (
            'Un e-mail part automatiquement après chaque nouvelle demande reçue par une publicité. Les demandes déjà reçues ne sont pas concernées.'
          )}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={reglage.enabled}
        aria-label="Confirmer leur demande aux prospects Facebook et Instagram"
        onClick={basculer}
        disabled={isSaving || enCours}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${reglage.enabled ? 'bg-primary-600' : 'bg-secondary-300'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${reglage.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
