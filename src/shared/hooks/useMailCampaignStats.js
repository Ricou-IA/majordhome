import { useQuery } from '@tanstack/react-query';
import { mailCampaignStatsService } from '@services/mailCampaignStats.service';
import { mailCampaignStatsKeys } from './cacheKeys';

export { mailCampaignStatsKeys };

/**
 * Lit la vue `majordhome_mail_campaign_stats` (1 ligne par campagne).
 * Refetch toutes les 60s pour suivre les events Resend qui arrivent en direct.
 */
export function useMailCampaignStats(orgId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: mailCampaignStatsKeys.list(orgId),
    queryFn: async () => {
      const { data, error } = await mailCampaignStatsService.list(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return { stats: data || [], isLoading, error, refetch };
}
