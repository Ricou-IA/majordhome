import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@lib/supabaseClient';
import { toast } from 'sonner';

// ============================================================================
// HELPERS
// ============================================================================

/** Retourne le 1er jour d'un mois 'YYYY-MM' → 'YYYY-MM-01' */
const monthToStartDate = (m) => `${m}-01`;

/** Retourne le dernier jour d'un mois 'YYYY-MM' → 'YYYY-MM-28/30/31' */
const monthToEndDate = (m) => {
  const [y, mo] = m.split('-').map(Number);
  const lastDay = new Date(y, mo, 0).getDate();
  return `${m}-${String(lastDay).padStart(2, '0')}`;
};

/** Vérifie si une date 'YYYY-MM-DD' appartient à un des mois sélectionnés */
const isInSelectedMonths = (dateStr, months) => {
  if (!dateStr) return false;
  const prefix = dateStr.slice(0, 7); // 'YYYY-MM'
  return months.includes(prefix);
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
  ticketMoyen: 0,
  conversionRdv: 0,
  conversionVente: 0,
  sourceMetrics: [],
  monthlyTrends: [],
  commercialMetrics: [],
};

// ============================================================================
// HOOK
// ============================================================================

export const useDashboardData = (filters, profile) => {
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const fetchIdRef = useRef(0);

  const refetch = useCallback(() => {
    fetchIdRef.current += 1;
  }, []);

  useEffect(() => {
    if (!profile || !profile.orgId) {
      setLoading(false);
      return;
    }

    if (!filters?.months || filters.months.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const currentFetchId = ++fetchIdRef.current;

    const fetchData = async () => {
      setLoading(true);

      try {
        const orgId = profile.orgId;
        const selectedMonths = filters.months;
        const last6Months = getLast6Months();
        const firstMonthStart = `${last6Months[0]}-01`;

        // Bornes min/max pour la requête SQL (fetch large, filtre exact côté client)
        const sortedMonths = [...selectedMonths].sort();
        const minDate = monthToStartDate(sortedMonths[0]);
        const maxDate = monthToEndDate(sortedMonths[sortedMonths.length - 1]);

        // Requêtes en parallèle
        const [leadsResult, allLeadsResult, sourcesResult, membersResult] = await Promise.all([
          // 1. Leads pour les mois sélectionnés (bornes larges)
          supabase
            .from('majordhome_leads')
            .select('*')
            .eq('org_id', orgId)
            .eq('is_deleted', false)
            .gte('created_date', minDate)
            .lte('created_date', maxDate),

          // 2. Leads des 6 derniers mois (tendances)
          supabase
            .from('majordhome_leads')
            .select('*')
            .eq('org_id', orgId)
            .eq('is_deleted', false)
            .gte('created_date', firstMonthStart),

          // 3. Sources actives
          supabase.from('majordhome_sources').select('id, name').eq('is_active', true),

          // 4. Commerciaux (pour noms dans la section par commercial)
          supabase
            .from('majordhome_commercials')
            .select('id, full_name')
            .eq('org_id', orgId)
            .eq('is_active', true),
        ]);

        if (cancelled || fetchIdRef.current !== currentFetchId) return;
        if (leadsResult.error) throw leadsResult.error;

        // Map des noms commerciaux (assigned_user_id → majordhome.commercials.id)
        const commercialsMap = {};
        if (membersResult.data) {
          for (const c of membersResult.data) {
            commercialsMap[c.id] = c.full_name;
          }
        }

        if (cancelled || fetchIdRef.current !== currentFetchId) return;

        // Filtrer les leads par mois exact (la requête SQL utilise des bornes larges)
        let leads = (leadsResult.data || []).filter((l) =>
          isInSelectedMonths(l.created_date, selectedMonths),
        );
        let allLeads = allLeadsResult.data || [];

        // Commercial voit uniquement ses leads
        if (profile.role === 'Commercial') {
          leads = leads.filter((l) => l.assigned_user_id === profile.id);
          allLeads = allLeads.filter((l) => l.assigned_user_id === profile.id);
        }

        // Filtre source
        if (filters.sourceIds.length > 0) {
          leads = leads.filter((l) => filters.sourceIds.includes(l.source_id));
        }

        const sources = sourcesResult.data || [];

        // === Stats globales ===
        const totalLeads = leads.length;
        const appointments = leads.filter((l) => l.status_display_order >= 3).length;
        const sales = leads.filter((l) => l.status_is_won === true).length;
        const revenue = leads
          .filter((l) => l.status_is_won === true)
          .reduce((sum, l) => sum + (Number(l.order_amount_ht) || 0), 0);
        const ticketMoyen = sales > 0 ? revenue / sales : 0;
        const conversionRdv = totalLeads > 0 ? (appointments / totalLeads) * 100 : 0;
        const conversionVente = totalLeads > 0 ? (sales / totalLeads) * 100 : 0;

        // === Métriques par commercial ===
        const leadsForBreakdown = profile.role === 'Commercial'
          ? leads
          : (leadsResult.data || [])
              .filter((l) => isInSelectedMonths(l.created_date, selectedMonths))
              .filter((l) =>
                filters.sourceIds.length > 0 ? filters.sourceIds.includes(l.source_id) : true,
              );

        const byUser = {};
        for (const lead of leadsForBreakdown) {
          const uid = lead.assigned_user_id;
          if (!uid) continue;
          if (!byUser[uid]) byUser[uid] = [];
          byUser[uid].push(lead);
        }

        const commercialMetrics = Object.entries(byUser)
          .map(([userId, userLeads]) => {
            const uLeads = userLeads.length;
            const uAppointments = userLeads.filter((l) => l.status_display_order >= 3).length;
            const uSales = userLeads.filter((l) => l.status_is_won === true).length;
            const uRevenue = userLeads
              .filter((l) => l.status_is_won === true)
              .reduce((sum, l) => sum + (Number(l.order_amount_ht) || 0), 0);
            return {
              userId,
              fullName: commercialsMap[userId] || 'Non assigné',
              leads: uLeads,
              appointments: uAppointments,
              sales: uSales,
              revenue: uRevenue,
            };
          })
          .sort((a, b) => b.leads - a.leads);

        // === Métriques par source ===
        const sourceMetrics = [];

        for (const source of sources) {
          const sourceLeads = leads.filter((l) => l.source_id === source.id);
          const sourceAppointments = sourceLeads.filter((l) => l.status_display_order >= 3).length;
          const sourceSales = sourceLeads.filter((l) => l.status_is_won === true).length;
          const sourceRevenue = sourceLeads
            .filter((l) => l.status_is_won === true)
            .reduce((sum, l) => sum + (Number(l.order_amount_ht) || 0), 0);

          if (sourceLeads.length > 0) {
            sourceMetrics.push({
              sourceId: source.id,
              sourceName: source.name,
              leads: sourceLeads.length,
              appointments: sourceAppointments,
              sales: sourceSales,
              revenue: sourceRevenue,
            });
          }
        }

        sourceMetrics.sort((a, b) => b.revenue - a.revenue);

        // === Tendances mensuelles ===
        const monthlyTrends = last6Months.map((monthStr) => {
          const [year, month] = monthStr.split('-').map(Number);
          const firstDay = new Date(year, month - 1, 1);
          const lastDay = new Date(year, month, 0);

          const monthLeads = allLeads.filter((l) => {
            const date = new Date(l.created_date);
            return date >= firstDay && date <= lastDay;
          });

          return {
            month: firstDay.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
            leads: monthLeads.length,
            appointments: monthLeads.filter((l) => l.status_display_order >= 3).length,
            sales: monthLeads.filter((l) => l.status_is_won === true).length,
            revenue: monthLeads
              .filter((l) => l.status_is_won === true)
              .reduce((sum, l) => sum + (Number(l.order_amount_ht) || 0), 0),
          };
        });

        setData({
          totalLeads,
          appointments,
          sales,
          revenue,
          ticketMoyen,
          conversionRdv,
          conversionVente,
          sourceMetrics,
          monthlyTrends,
          commercialMetrics,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profile?.id,
    profile?.orgId,
    profile?.role,
    filters?.months?.join(','),
    filters?.sourceIds?.join(','),
  ]);

  return { data, loading, refetch };
};
