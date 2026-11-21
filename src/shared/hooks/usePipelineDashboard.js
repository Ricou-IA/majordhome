/**
 * usePipelineDashboard.js — données + chiffres du Dashboard du pipeline.
 * Lecture : `pipelineDashboard.service` (paginée). Calcul : `src/lib/pipelineDashboard.js`.
 * Un commercial ne voit que ses leads ; tant que son identité de commercial n'est pas
 * résolue, rien n'est affiché (jamais les chiffres de toute l'entreprise par défaut).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { pipelineDashboardService } from '@services/pipelineDashboard.service';
import { unwrapResult } from '@lib/serviceHelpers';
import { buildPipelineDashboard, debutDesDonnees, devisDepuisLeads } from '@lib/pipelineDashboard';
import { useLeadCommercials, useLeadSources } from './useLeads';
import { usePennylaneEnabled } from './useOrgSettings';
import { pipelineDashboardKeys } from './cacheKeys';

/** Aucun lead ne porte cet identifiant : un commercial sans fiche de commercial ne voit rien. */
const AUCUN_COMMERCIAL = '__aucun__';

/** Date du jour en heure LOCALE (`toISOString` recule d'un jour entre minuit et 1 h ou 2 h). */
function aujourdhuiLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * @param {{ mois: string[], sourceIds: string[], enabled?: boolean }} filtres
 *   `enabled` faux ⇒ aucune lecture, `dashboard` reste null (page d'accueil d'un rôle sans pipeline).
 * @returns {{ dashboard: Object|null, commercials: Object[], isLoading: boolean, error: Error|null, refetch: Function, estCommercial: boolean }}
 */
export function usePipelineDashboard({ mois, sourceIds, enabled = true }) {
  const { organization, user, effectiveRole } = useAuth();
  const orgId = organization?.id;
  const depuis = debutDesDonnees(mois);

  const { commercials, isLoading: commercialsLoading } = useLeadCommercials(orgId);
  const { sources } = useLeadSources();
  const pennylaneActive = usePennylaneEnabled();

  const query = useQuery({
    queryKey: pipelineDashboardKeys.data(orgId, depuis),
    queryFn: () => unwrapResult(pipelineDashboardService.getData(orgId, depuis)),
    enabled: !!orgId && enabled,
    staleTime: 60_000,
  });

  const estCommercial = effectiveRole === 'commercial';
  const monCommercialId = estCommercial
    ? commercials.find((c) => c.profile_id === user?.id)?.id || null
    : null;
  const identiteEnAttente = estCommercial && !monCommercialId && commercialsLoading;

  const moisCle = mois.join(',');
  const sourcesCle = sourceIds.join(',');
  const dashboard = useMemo(() => {
    if (!query.data || identiteEnAttente) return null;
    const { leads, cards, rdvs, devis } = query.data;
    return buildPipelineDashboard({
      leads,
      cards,
      rdvs,
      // Org sans Pennylane : pas de devis rattachés, la date d'envoi est sur le lead.
      devis: pennylaneActive ? devis : devisDepuisLeads(leads),
      commercials,
      sources,
      mois: moisCle.split(','),
      sourceIds: sourcesCle ? sourcesCle.split(',') : [],
      aujourdhui: aujourdhuiLocal(),
      seulCommercialId: estCommercial ? monCommercialId || AUCUN_COMMERCIAL : null,
    });
  }, [query.data, identiteEnAttente, pennylaneActive, commercials, sources, moisCle, sourcesCle, estCommercial, monCommercialId]);

  return {
    dashboard,
    commercials,
    isLoading: enabled && (query.isLoading || identiteEnAttente),
    error: query.error || null,
    refetch: query.refetch,
    estCommercial,
  };
}
