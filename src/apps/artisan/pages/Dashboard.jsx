/**
 * Dashboard.jsx - Majord'home Artisan
 * ============================================================================
 * Dashboard principal : KPIs pipeline/chantiers, planning du jour, alertes,
 * action rapide "Nouveau lead".
 *
 * @version 2.0.0 - Sprint 6 — Données réelles
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { supabase } from '@lib/supabaseClient';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  AlertTriangle,
  Info,
  Plus,
  ArrowRight,
  Sparkles,
  FileText,
  HardHat,
  ClipboardList,
  MapPin,
} from 'lucide-react';
import { getAppointmentTypeConfig } from '@services/appointments.service';
import { LeadModal } from '@apps/artisan/components/pipeline/LeadModal';

// =============================================================================
// HOOK — Données dashboard (KPIs + planning du jour)
// =============================================================================

function useDashboardHome(orgId, effectiveRole, userId) {
  const today = new Date().toISOString().split('T')[0];

  // KPIs : compteurs leads pipeline + chantiers
  // Scoping : commercial → ses propres leads/chantiers, technicien → uniquement chantiers
  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard-kpis', orgId, effectiveRole, userId],
    queryFn: async () => {
      // Technicien : pas de KPIs pipeline, uniquement chantiers
      const showPipelineKpis = effectiveRole !== 'technicien';

      let leads = [];
      if (showPipelineKpis) {
        let leadsQuery = supabase
          .from('majordhome_leads')
          .select('status_label, status_display_order, chantier_status', { count: 'exact' })
          .eq('org_id', orgId)
          .eq('is_deleted', false)
          .eq('status_is_final', false);

        // Commercial : filtre sur ses propres leads
        if (effectiveRole === 'commercial') {
          leadsQuery = leadsQuery.eq('assigned_user_id', userId);
        }
        // Team leader : filtre sur ses propres leads (dashboard = les siens)
        if (effectiveRole === 'team_leader') {
          leadsQuery = leadsQuery.eq('assigned_user_id', userId);
        }

        const leadsRes = await leadsQuery;
        leads = leadsRes.data || [];
      }

      // Chantiers : commercial = ses chantiers, technicien = planification+réalisé
      let chantiersQuery = supabase
        .from('majordhome_chantiers')
        .select('chantier_status, assigned_user_id', { count: 'exact' })
        .eq('org_id', orgId);

      if (effectiveRole === 'commercial') {
        chantiersQuery = chantiersQuery.eq('assigned_user_id', userId);
      }
      if (effectiveRole === 'team_leader') {
        chantiersQuery = chantiersQuery.eq('assigned_user_id', userId);
      }

      const chantiersRes = await chantiersQuery;
      const chantiers = chantiersRes.data || [];

      return {
        nouveauLead: showPipelineKpis ? leads.filter((l) => l.status_display_order === 1).length : null,
        devisEnvoye: showPipelineKpis ? leads.filter((l) => l.status_display_order === 4).length : null,
        commandeAFaire: chantiers.filter((c) => c.chantier_status === 'commande_a_faire').length,
        aPlanifier: chantiers.filter((c) => c.chantier_status === 'commande_recue').length,
      };
    },
    enabled: !!orgId && !!userId,
    staleTime: 30_000,
  });

  // Planning du jour
  const { data: todayAppointments, isLoading: planningLoading } = useQuery({
    queryKey: ['dashboard-planning', orgId, today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('majordhome_appointments')
        .select('*')
        .eq('org_id', orgId)
        .eq('scheduled_date', today)
        .neq('status', 'cancelled')
        .order('scheduled_start', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });

  return {
    kpis: kpis || { nouveauLead: 0, devisEnvoye: 0, commandeAFaire: 0, aPlanifier: 0 },
    todayAppointments: todayAppointments || [],
    isLoading: kpisLoading || planningLoading,
  };
}

// =============================================================================
// KPI CARD
// =============================================================================

function KpiCard({ label, value, icon: Icon, color, bgLight, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card group hover:shadow-md transition-shadow cursor-pointer text-left w-full"
    >
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-lg ${color} flex items-center justify-center`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-2xl font-bold text-secondary-900">{value}</p>
          <p className="text-sm text-secondary-600">{label}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
      </div>
    </button>
  );
}

// =============================================================================
// PLANNING ROW
// =============================================================================

function PlanningRow({ appointment }) {
  const typeConfig = getAppointmentTypeConfig(appointment.appointment_type);
  const clientName = [appointment.client_name, appointment.client_first_name]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex items-start gap-4 p-3 rounded-lg bg-secondary-50 hover:bg-secondary-100 transition-colors">
      <div className="text-center min-w-[60px]">
        <p className="text-lg font-semibold text-secondary-900">
          {appointment.scheduled_start?.slice(0, 5)}
        </p>
      </div>
      <div className="w-1 self-stretch rounded-full" style={{ backgroundColor: typeConfig.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="px-2 py-0.5 text-xs font-medium rounded text-white"
            style={{ backgroundColor: typeConfig.color }}
          >
            {typeConfig.label}
          </span>
          {appointment.scheduled_end && (
            <span className="text-xs text-gray-400">
              → {appointment.scheduled_end.slice(0, 5)}
            </span>
          )}
        </div>
        <p className="mt-1 font-medium text-secondary-900 truncate">
          {appointment.subject || clientName || 'Sans titre'}
        </p>
        {appointment.location && (
          <p className="text-sm text-secondary-500 flex items-center gap-1 truncate">
            <MapPin className="w-3 h-3 shrink-0" />
            {appointment.location}
          </p>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// PAGE DASHBOARD
// =============================================================================

export default function Dashboard() {
  const { profile, organization, user, effectiveRole } = useAuth();
  const { can } = useCanAccess();
  const navigate = useNavigate();
  const orgId = organization?.id;

  const { kpis, todayAppointments, isLoading } = useDashboardHome(orgId, effectiveRole, user?.id);

  // LeadModal state
  const [showLeadModal, setShowLeadModal] = useState(false);

  // Alertes (placeholder — à enrichir)
  const alerts = useMemo(() => {
    const list = [];
    if (kpis.nouveauLead > 0) {
      list.push({
        id: 'new-leads',
        type: 'info',
        message: `${kpis.nouveauLead} nouveau${kpis.nouveauLead > 1 ? 'x' : ''} lead${kpis.nouveauLead > 1 ? 's' : ''} à qualifier`,
      });
    }
    if (kpis.commandeAFaire > 0) {
      list.push({
        id: 'commandes',
        type: 'warning',
        message: `${kpis.commandeAFaire} commande${kpis.commandeAFaire > 1 ? 's' : ''} à passer`,
      });
    }
    return list;
  }, [kpis]);

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">
          Bonjour, {profile?.full_name?.split(' ')[0] || 'Utilisateur'} 👋
        </h1>
        <p className="text-secondary-600">
          Voici votre journée du{' '}
          {new Date().toLocaleDateString('fr-FR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
      </div>

      {/* KPI Cards — masquer pipeline KPIs pour technicien */}
      <div className={`grid grid-cols-2 ${can('pipeline', 'view') ? 'lg:grid-cols-4' : 'lg:grid-cols-2'} gap-4`}>
        {can('pipeline', 'view') && (
          <>
            <KpiCard
              label="Nouveaux leads"
              value={kpis.nouveauLead ?? 0}
              icon={Sparkles}
              color="bg-gray-500"
              onClick={() => navigate('/pipeline?tab=kanban')}
            />
            <KpiCard
              label="Devis envoyés"
              value={kpis.devisEnvoye ?? 0}
              icon={FileText}
              color="bg-orange-500"
              onClick={() => navigate('/pipeline?tab=kanban')}
            />
          </>
        )}
        {can('chantiers', 'view') && (
          <>
            <KpiCard
              label="Commandes à faire"
              value={kpis.commandeAFaire}
              icon={ClipboardList}
              color="bg-amber-500"
              onClick={() => navigate('/chantiers')}
            />
            <KpiCard
              label="À planifier"
              value={kpis.aPlanifier}
              icon={HardHat}
              color="bg-blue-500"
              onClick={() => navigate('/chantiers')}
            />
          </>
        )}
      </div>

      {/* Contenu principal */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Planning du jour */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-secondary-900 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-500" />
              Planning du jour
              {todayAppointments.length > 0 && (
                <span className="text-sm font-normal text-gray-400">
                  ({todayAppointments.length})
                </span>
              )}
            </h2>
            <button
              type="button"
              onClick={() => navigate('/planning')}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              Voir tout →
            </button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8 text-gray-400">Chargement...</div>
          ) : todayAppointments.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>Aucun RDV aujourd&apos;hui</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todayAppointments.map((apt) => (
                <PlanningRow key={apt.id} appointment={apt} />
              ))}
            </div>
          )}
        </div>

        {/* Colonne droite : Alertes + Actions rapides */}
        <div className="card">
          <h2 className="text-lg font-semibold text-secondary-900 mb-4">Alertes</h2>

          {alerts.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">Aucune alerte</p>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`p-3 rounded-lg flex items-start gap-3 ${
                    alert.type === 'warning'
                      ? 'bg-amber-50 text-amber-800'
                      : 'bg-blue-50 text-blue-800'
                  }`}
                >
                  {alert.type === 'warning' ? (
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  )}
                  <p className="text-sm">{alert.message}</p>
                </div>
              ))}
            </div>
          )}

          {/* Actions rapides */}
          {can('pipeline', 'create') && (
            <div className="mt-6 pt-6 border-t border-secondary-200">
              <h3 className="text-sm font-medium text-secondary-700 mb-3">Actions rapides</h3>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowLeadModal(true)}
                  className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-secondary-50 text-secondary-700 transition-colors"
                >
                  <Plus className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-medium">Nouveau lead</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* LeadModal pour action rapide */}
      {showLeadModal && (
        <LeadModal
          lead={null}
          onClose={() => setShowLeadModal(false)}
          onUpdated={() => setShowLeadModal(false)}
        />
      )}
    </div>
  );
}
