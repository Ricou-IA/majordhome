/**
 * GabaritTransactionnel.jsx — une ligne « gabarit d'e-mail transactionnel »
 * ============================================================================
 * Même mécanique que le gabarit de facture d'entretien (EmailsTab) : le gabarit
 * vit dans `majordhome_mail_campaigns` (is_transactional = true). Absent → bouton
 * « Créer le gabarit par défaut » ; présent → lien vers Mailing → Éditeur ;
 * archivé → invite à le restaurer (la contrainte unique `(org_id, key)` refuserait
 * une création). Utilisé par les gabarits de l'auto-RDV.
 * ============================================================================
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { mailCampaignKeys } from '@hooks/cacheKeys';
import { mailCampaignsService } from '@services/mailCampaigns.service';

/**
 * @param {{ orgId: string, gabarit: { key: string, label: string, subject: string, html_body: string, is_transactional: boolean }, placeholders: string[], titre: string }} props
 */
export default function GabaritTransactionnel({ orgId, gabarit, placeholders = [], titre }) {
  const queryClient = useQueryClient();
  const [creation, setCreation] = useState(false);

  const { data: existant, isLoading } = useQuery({
    queryKey: mailCampaignKeys.byKey(orgId, gabarit.key),
    queryFn: async () => {
      const { data, error } = await mailCampaignsService.getByKey(orgId, gabarit.key);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });
  const { data: archive, isLoading: chargementArchive } = useQuery({
    queryKey: mailCampaignKeys.archivedByKey(orgId, gabarit.key),
    queryFn: async () => {
      const { data, error } = await mailCampaignsService.list(orgId, { includeArchived: true });
      if (error) throw error;
      return (data || []).find((c) => c.key === gabarit.key && c.is_archived) || null;
    },
    enabled: !!orgId && !isLoading && !existant,
  });

  const creer = async () => {
    if (!orgId || creation) return;
    setCreation(true);
    try {
      const { error } = await mailCampaignsService.create({ org_id: orgId, ...gabarit });
      if (error) throw error;
      toast.success(`Gabarit « ${titre} » créé`);
      queryClient.invalidateQueries({ queryKey: mailCampaignKeys.all(orgId) });
    } catch (err) {
      toast.error(err.message || 'Création du gabarit échouée');
    } finally {
      setCreation(false);
    }
  };

  return (
    <div className="border border-secondary-200 rounded-md p-3 text-sm flex items-center justify-between gap-4 mt-2">
      <div>
        <p className="text-secondary-900 font-medium">{titre}</p>
        {existant && placeholders.length > 0 && (
          <p className="mt-1 text-xs text-secondary-500">
            Variables : {placeholders.map((v) => <code key={v} className="mr-1">{v}</code>)}
          </p>
        )}
      </div>
      {isLoading || (!existant && chargementArchive) ? (
        <span className="text-xs text-secondary-500">Chargement…</span>
      ) : existant ? (
        <Link to="/mailing" className="text-sm text-primary-600 hover:underline whitespace-nowrap">
          Modifier dans Mailing → Éditeur
        </Link>
      ) : archive ? (
        <Link to="/mailing" className="text-sm text-amber-700 hover:underline whitespace-nowrap">
          Gabarit archivé : restaurez-le dans Mailing → Éditeur
        </Link>
      ) : (
        <button
          type="button"
          onClick={creer}
          disabled={creation}
          className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 whitespace-nowrap"
        >
          {creation ? 'Création…' : 'Créer le gabarit par défaut'}
        </button>
      )}
    </div>
  );
}
