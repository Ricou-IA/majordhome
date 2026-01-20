import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@lib/supabaseClient';
import { toast } from 'sonner';

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

// Helper pour comparer les objets filters
const areFiltersEqual = (f1, f2) => {
  if (!f1 && !f2) return true; // Les deux sont null/undefined
  if (!f1 || !f2) return false; // Un seul est null/undefined
  
  // Comparer les dates (convertir en timestamp pour comparaison fiable)
  const from1 = f1.period?.from?.getTime?.() ?? null;
  const from2 = f2.period?.from?.getTime?.() ?? null;
  const to1 = f1.period?.to?.getTime?.() ?? null;
  const to2 = f2.period?.to?.getTime?.() ?? null;
  const datesEqual = from1 === from2 && to1 === to2;
  
  // Comparer les arrays (comparaison profonde)
  const sourceIds1 = f1.sourceIds || [];
  const sourceIds2 = f2.sourceIds || [];
  const sourceIdsEqual = 
    sourceIds1.length === sourceIds2.length &&
    sourceIds1.every((id, i) => id === sourceIds2[i]);
  
  // Comparer commercialId
  const commercialIdEqual = f1.commercialId === f2.commercialId;
  
  return datesEqual && sourceIdsEqual && commercialIdEqual;
};

// Helper pour comparer les profils
const areProfilesEqual = (p1, p2) => {
  if (!p1 && !p2) return true; // Les deux sont null/undefined
  if (!p1 || !p2) return false; // Un seul est null/undefined
  // Comparer les valeurs primitives
  const id1 = p1.id || p1.user_id;
  const id2 = p2.id || p2.user_id;
  return id1 === id2 && p1.role === p2.role;
};

export const useDashboardData = (filters, profile) => {
  const [data, setData] = useState({
    totalLeads: 0,
    appointments: 0,
    sales: 0,
    revenue: 0,
    expenses: 0,
    roi: 0,
    sourceMetrics: [],
    monthlyTrends: [],
  });
  const [loading, setLoading] = useState(true);
  
  // Refs pour stocker les valeurs précédentes et éviter les rechargements inutiles
  const prevFiltersRef = useRef(null);
  const prevProfileRef = useRef(null);
  const isLoadingRef = useRef(false);
  const currentFiltersRef = useRef(filters);
  const currentProfileRef = useRef(profile);
  const timeoutRef = useRef(null);

  // Mettre à jour les refs quand les valeurs changent
  currentFiltersRef.current = filters;
  currentProfileRef.current = profile;

  const fetchDashboardData = useCallback(async () => {
    const currentProfile = currentProfileRef.current;
    const currentFilters = currentFiltersRef.current;
    
    if (!currentProfile) {
      setLoading(false);
      return;
    }

    // Éviter les appels multiples simultanés
    if (isLoadingRef.current) {
      console.log('[useDashboardData] Chargement déjà en cours, ignoré');
      return;
    }

    try {
      isLoadingRef.current = true;
      setLoading(true);

      const last6Months = getLast6Months();
      const firstMonthStart = `${last6Months[0]}-01`;

      // Execute all queries in parallel
      const [leadsResult, allLeadsResult, sourcesResult, costsResult, allCostsResult] = await Promise.all([
        // 1. Leads for current filter period
        supabase
          .from('leads')
          .select(`*, statuses!inner(label), sources(name, id)`)
          .eq('is_deleted', false)
          .gte('created_date', currentFilters.period.from.toISOString().split('T')[0])
          .lte('created_date', currentFilters.period.to.toISOString().split('T')[0])
          .then((res) => {
            let data = res.data || [];
            if (currentProfile.role === 'Commercial') {
              data = data.filter((l) => l.assigned_user_id === currentProfile.id);
            } else if (currentFilters.commercialId) {
              data = data.filter((l) => l.assigned_user_id === currentFilters.commercialId);
            }
            if (currentFilters.sourceIds.length > 0) {
              data = data.filter((l) => currentFilters.sourceIds.includes(l.source_id));
            }
            return { data, error: res.error };
          }),

        // 2. All leads for last 6 months (for trends)
        supabase
          .from('leads')
          .select(`*, statuses!inner(label)`)
          .eq('is_deleted', false)
          .gte('created_date', firstMonthStart)
          .then((res) => {
            let data = res.data || [];
            if (currentProfile.role === 'Commercial') {
              data = data.filter((l) => l.assigned_user_id === currentProfile.id);
            }
            return { data, error: res.error };
          }),

        // 3. Sources
        supabase.from('sources').select('id, name').eq('is_active', true),

        // 4. Costs for current filter period
        supabase
          .from('monthly_source_costs')
          .select('cost_amount, source_id, month')
          .in('month', getMonthsInPeriod(currentFilters.period.from, currentFilters.period.to)),

        // 5. All costs for last 6 months
        supabase
          .from('monthly_source_costs')
          .select('cost_amount, source_id, month')
          .in('month', last6Months),
      ]);

      if (leadsResult.error) throw leadsResult.error;

      const leads = leadsResult.data || [];
      const allLeads = allLeadsResult.data || [];
      const sources = sourcesResult.data || [];
      const costs = costsResult.data || [];
      const allCosts = allCostsResult.data || [];

      // Filter costs by source if needed
      const filteredCosts =
        currentFilters.sourceIds.length > 0 ? costs.filter((c) => currentFilters.sourceIds.includes(c.source_id)) : costs;

      // Calculate global stats with funnel logic
      const totalLeads = leads.length;
      const appointments = leads.filter(
        (l) => l.statuses?.label === 'Rendez-vous' || l.statuses?.label === 'Vendu'
      ).length;
      const sales = leads.filter((l) => l.statuses?.label === 'Vendu').length;
      const revenue = leads
        .filter((l) => l.statuses?.label === 'Vendu')
        .reduce((sum, l) => sum + (Number(l.order_amount_ht) || 0), 0);
      const expenses = filteredCosts.reduce((sum, c) => sum + Number(c.cost_amount), 0);
      const roi = expenses > 0 ? ((revenue - expenses) / expenses) * 100 : 0;

      // Calculate metrics by source
      const sourceMetrics = [];

      for (const source of sources) {
        const sourceLeads = leads.filter((l) => l.source_id === source.id);
        const sourceAppointments = sourceLeads.filter(
          (l) => l.statuses?.label === 'Rendez-vous' || l.statuses?.label === 'Vendu'
        ).length;
        const sourceSales = sourceLeads.filter((l) => l.statuses?.label === 'Vendu').length;
        const sourceRevenue = sourceLeads
          .filter((l) => l.statuses?.label === 'Vendu')
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

      // Calculate monthly trends
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
          appointments: monthLeads.filter(
            (l) => l.statuses?.label === 'Rendez-vous' || l.statuses?.label === 'Vendu'
          ).length,
          sales: monthLeads.filter((l) => l.statuses?.label === 'Vendu').length,
          revenue: monthLeads
            .filter((l) => l.statuses?.label === 'Vendu')
            .reduce((sum, l) => sum + (Number(l.order_amount_ht) || 0), 0),
          expenses: monthCosts.reduce((sum, c) => sum + Number(c.cost_amount), 0),
        };
      });

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
      console.error('Error fetching dashboard data:', error);
      toast.error('Erreur lors du chargement des données');
    } finally {
      isLoadingRef.current = false;
      setLoading(false);
    }
  }, []); // Pas de dépendances - on utilise les valeurs directement depuis les paramètres

  useEffect(() => {
    // Nettoyer le timeout précédent si présent
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (!profile) {
      // Si pas de profil, initialiser avec des données vides et arrêter le chargement
      setData({
        totalLeads: 0,
        appointments: 0,
        sales: 0,
        revenue: 0,
        expenses: 0,
        roi: 0,
        sourceMetrics: [],
        monthlyTrends: [],
      });
      setLoading(false);
      prevFiltersRef.current = null;
      prevProfileRef.current = null;
      return;
    }
    
    // Comparer les valeurs précédentes pour éviter les rechargements inutiles
    const filtersChanged = !areFiltersEqual(prevFiltersRef.current, filters);
    const profileChanged = !areProfilesEqual(prevProfileRef.current, profile);
    const isInitialLoad = prevFiltersRef.current === null;
    
    // Ne recharger que si les valeurs ont vraiment changé
    if (isInitialLoad || filtersChanged || profileChanged) {
      // Ignorer si déjà en cours de chargement
      if (isLoadingRef.current) {
        console.log('[useDashboardData] Chargement déjà en cours, ignoré');
        return;
      }

      console.log('[useDashboardData] Changement détecté:', { 
        isInitialLoad, 
        filtersChanged, 
        profileChanged,
        profileId: profile?.id || profile?.user_id,
        profileRole: profile?.role 
      });
      
      // Mettre à jour les refs AVANT l'appel pour éviter les doubles déclenchements
      prevFiltersRef.current = filters;
      prevProfileRef.current = profile;
      
      // Debounce léger pour éviter les appels trop rapides (100ms)
      timeoutRef.current = setTimeout(() => {
        fetchDashboardData();
        timeoutRef.current = null;
      }, 100);
    } else {
      console.log('[useDashboardData] Aucun changement détecté, pas de rechargement');
    }

    // Cleanup
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, filters]); // Ne pas inclure fetchDashboardData pour éviter les boucles

  return { data, loading, refetch: fetchDashboardData };
};
