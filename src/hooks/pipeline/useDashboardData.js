import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@lib/supabaseClient';
import { toast } from 'sonner';

// ============================================================================
// HELPERS
// ============================================================================

const getMonthsInPeriod = (from, to) => {
  const months = [];
  const current = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);

  while (current <= end) {
    months.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`);
    current.setMonth(current.getMonth() + 1);
  }

  return months;
};

const getLast6Months = () => {
  const months = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }

  return months;
};

const EMPTY_DATA = {
  totalLeads: 0,
  appointments: 0,
  sales: 0,
  revenue: 0,
  expenses: 0,
  roi: 0,
  sourceMetrics: [],
  monthlyTrends: [],
};

// ============================================================================
// HOOK
// ============================================================================

export const useDashboardData = (filters, profile) => {
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const fetchIdRef = useRef(0);

  // Refetch stable callback (utilisé pour le bouton "Actualiser" éventuel)
  const refetch = useCallback(() => {
    // Incrémente le fetchId pour forcer un re-fetch via le useEffect
    fetchIdRef.current += 1;
    // Pas de setState ici — on force le useEffect à se relancer via la ref
    // en pratique, les consumers appellent refetch rarement
  }, []);

  useEffect(() => {
    // Guard : pas de profil ou pas d'orgId → on attend
    if (!profile || !profile.orgId) {
      setLoading(false);
      return;
    }

    // Guard : pas de filtres valides
    if (!filters?.period?.from || !filters?.period?.to) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const currentFetchId = ++fetchIdRef.current;

    const fetchData = async () => {
      setLoading(true);

      try {
        const orgId = profile.orgId;
        const last6Months = getLast6Months();
        const firstMonthStart = `${last6Months[0]}-01`;

        // Toutes les requêtes en parallèle (vues publiques enrichies)
        const [leadsResult, allLeadsResult, sourcesResult, costsResult, allCostsResult] = await Promise.all([
          // 1. Leads pour la période filtrée
          supabase
            .from('majordhome_leads')
            .select('*')
            .eq('org_id', orgId)
            .eq('is_deleted', false)
            .gte('created_date', filters.period.from.toISOString().split('T')[0])
            .lte('created_date', filters.period.to.toISOString().split('T')[0]),

          // 2. Leads des 6 derniers mois (tendances)
          supabase
            .from('majordhome_leads')
            .select('*')
            .eq('org_id', orgId)
            .eq('is_deleted', false)
            .gte('created_date', firstMonthStart),

          // 3. Sources actives
          supabase.from('majordhome_sources').select('id, name').eq('is_active', true),

          // 4. Coûts de la période filtrée
          supabase
            .from('majordhome_monthly_source_costs')
            .select('cost_amount, source_id, month')
            .in('month', getMonthsInPeriod(filters.period.from, filters.period.to)),

          // 5. Coûts des 6 derniers mois
          supabase
            .from('majordhome_monthly_source_costs')
            .select('cost_amount, source_id, month')
            .in('month', last6Months),
        ]);

        // Si le fetch a été annulé (nouveau fetch lancé), on ne met pas à jour le state
        if (cancelled || fetchIdRef.current !== currentFetchId) return;

        if (leadsResult.error) throw leadsResult.error;

        // Filtrer les leads côté client (rôle + filtres source/commercial)
        let leads = leadsResult.data || [];
        let allLeads = allLeadsResult.data || [];

        if (profile.role === 'Commercial') {
          leads = leads.filter((l) => l.assigned_user_id === profile.id);
          allLeads = allLeads.filter((l) => l.assigned_user_id === profile.id);
        } else if (filters.commercialId) {
          leads = leads.filter((l) => l.assigned_user_id === filters.commercialId);
        }

        if (filters.sourceIds.length > 0) {
          leads = leads.filter((l) => filters.sourceIds.includes(l.source_id));
        }

        const sources = sourcesResult.data || [];
        const costs = costsResult.data || [];
        const allCosts = allCostsResult.data || [];

        // Coûts filtrés par source si nécessaire
        const filteredCosts =
          filters.sourceIds.length > 0 ? costs.filter((c) => filters.sourceIds.includes(c.source_id)) : costs;

        // === Stats globales ===
        const totalLeads = leads.length;
        const appointments = leads.filter((l) => l.status_display_order >= 3).length;
        const sales = leads.filter((l) => l.status_is_won === true).length;
        const revenue = leads
          .filter((l) => l.status_is_won === true)
          .reduce((sum, l) => sum + (Number(l.order_amount_ht) || 0), 0);
        const expenses = filteredCosts.reduce((sum, c) => sum + Number(c.cost_amount), 0);
        const roi = expenses > 0 ? ((revenue - expenses) / expenses) * 100 : 0;

        // === Métriques par source ===
        const sourceMetrics = [];

        for (const source of sources) {
          const sourceLeads = leads.filter((l) => l.source_id === source.id);
          const sourceAppointments = sourceLeads.filter((l) => l.status_display_order >= 3).length;
          const sourceSales = sourceLeads.filter((l) => l.status_is_won === true).length;
          const sourceRevenue = sourceLeads
            .filter((l) => l.status_is_won === true)
            .reduce((sum, l) => sum + (Number(l.order_amount_ht) || 0), 0);

          const sourceCosts = costs.filter((c) => c.source_id === source.id);
          const sourceExpenses = sourceCosts.reduce((sum, c) => sum + Number(c.cost_amount), 0);

          const cpl = sourceLeads.length > 0 ? sourceExpenses / sourceLeads.length : 0;
          const cpAppointment = sourceAppointments > 0 ? sourceExpenses / sourceAppointments : 0;
          const cpSale = sourceSales > 0 ? sourceExpenses / sourceSales : 0;
          const sourceRoi = sourceExpenses > 0 ? ((sourceRevenue - sourceExpenses) / sourceExpenses) * 100 : 0;

          if (sourceLeads.length > 0 || sourceExpenses > 0) {
            sourceMetrics.push({
              sourceId: source.id,
              sourceName: source.name,
              leads: sourceLeads.length,
              appointments: sourceAppointments,
              sales: sourceSales,
              revenue: sourceRevenue,
              expenses: sourceExpenses,
              cpl,
              cpAppointment,
              cpSale,
              roi: sourceRoi,
            });
          }
        }

        sourceMetrics.sort((a, b) => b.roi - a.roi);

        // === Tendances mensuelles ===
        const monthlyTrends = last6Months.map((monthStr) => {
          const [year, month] = monthStr.split('-').map(Number);
          const firstDay = new Date(year, month - 1, 1);
          const lastDay = new Date(year, month, 0);

          const monthLeads = allLeads.filter((l) => {
            const date = new Date(l.created_date);
            return date >= firstDay && date <= lastDay;
          });

          const monthCosts = allCosts.filter((c) => c.month === monthStr);

          return {
            month: firstDay.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
            leads: monthLeads.length,
            appointments: monthLeads.filter((l) => l.status_display_order >= 3).length,
            sales: monthLeads.filter((l) => l.status_is_won === true).length,
            revenue: monthLeads
              .filter((l) => l.status_is_won === true)
              .reduce((sum, l) => sum + (Number(l.order_amount_ht) || 0), 0),
            expenses: monthCosts.reduce((sum, c) => sum + Number(c.cost_amount), 0),
          };
        });

        // Mise à jour state
        setData({
          totalLeads,
          appointments,
          sales,
          revenue,
          expenses,
          roi,
          sourceMetrics,
          monthlyTrends,
        });
      } catch (error) {
        if (cancelled || fetchIdRef.current !== currentFetchId) return;
        console.error('[useDashboardData] Erreur fetch:', error);
        toast.error('Erreur lors du chargement des données');
      } finally {
        if (!cancelled && fetchIdRef.current === currentFetchId) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
    // Dépendances stables : on sérialise les filtres pour éviter les re-renders inutiles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profile?.id,
    profile?.orgId,
    profile?.role,
    filters?.period?.from?.getTime?.(),
    filters?.period?.to?.getTime?.(),
    filters?.sourceIds?.join(','),
    filters?.commercialId,
  ]);

  return { data, loading, refetch };
};
