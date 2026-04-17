import { Euro, Eye, Users, TrendingUp, Target, Trophy, CalendarCheck, FileText } from 'lucide-react';
import { formatEuro } from '@lib/utils';

const KpiCard = ({ icon: Icon, label, value, subtitle, color = 'blue', hint }) => {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    violet: 'bg-violet-100 text-violet-700',
    rose: 'bg-rose-100 text-rose-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    gray: 'bg-gray-100 text-gray-700',
  };

  return (
    <div className="bg-white rounded-lg border border-secondary-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-secondary-500 uppercase tracking-wide">{label}</div>
          <div className="mt-1 text-2xl font-semibold text-secondary-900">{value}</div>
          {subtitle && (
            <div className="mt-0.5 text-xs text-secondary-500 truncate" title={subtitle}>
              {subtitle}
            </div>
          )}
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClasses[color] || colorClasses.blue}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      {hint && (
        <div className="mt-2 text-[11px] text-secondary-400 italic">{hint}</div>
      )}
    </div>
  );
};

const fmtInt = (n) => {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR').format(n);
};

const fmtPct = (n) => {
  if (n == null) return '—';
  return `${(n * 100).toFixed(2)}%`;
};

const fmtCpl = (cents) => {
  if (cents == null) return '—';
  return formatEuro(cents / 100);
};

export function MetaAdsKpiCards({ kpis }) {
  const {
    spend_eur = 0,
    impressions = 0,
    reach = 0,
    ctr = 0,
    leads_meta = 0,
    leads_total = 0,
    leads_planified = 0,
    leads_quoted = 0,
    leads_won = 0,
    cpl_meta_cents,
    cpl_planified_cents,
    cpl_quoted_cents,
    cpl_won_cents,
    conversion_rate_won = 0,
  } = kpis || {};

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard
        icon={Euro}
        label="Dépense"
        value={formatEuro(spend_eur)}
        subtitle={`${fmtInt(impressions)} impressions`}
        color="blue"
      />
      <KpiCard
        icon={Eye}
        label="Portée"
        value={fmtInt(reach)}
        subtitle={`CTR ${fmtPct(ctr)}`}
        color="violet"
      />
      <KpiCard
        icon={Users}
        label="Leads Meta"
        value={fmtInt(leads_meta)}
        subtitle={`dont ${fmtInt(leads_total)} en pipeline`}
        color="indigo"
        hint="Source : Meta Insights (actions → lead)"
      />
      <KpiCard
        icon={Trophy}
        label="Leads gagnés"
        value={fmtInt(leads_won)}
        subtitle={`taux conv. ${fmtPct(conversion_rate_won)}`}
        color="emerald"
      />

      <KpiCard
        icon={Target}
        label="CPL Meta"
        value={fmtCpl(cpl_meta_cents)}
        subtitle="Dépense / leads Meta"
        color="amber"
      />
      <KpiCard
        icon={CalendarCheck}
        label="CPL Planifié"
        value={fmtCpl(cpl_planified_cents)}
        subtitle={`${fmtInt(leads_planified)} RDV planifiés`}
        color="indigo"
      />
      <KpiCard
        icon={FileText}
        label="CPL Devis"
        value={fmtCpl(cpl_quoted_cents)}
        subtitle={`${fmtInt(leads_quoted)} devis envoyés`}
        color="rose"
      />
      <KpiCard
        icon={TrendingUp}
        label="CPL Gagné"
        value={fmtCpl(cpl_won_cents)}
        subtitle="Coût par vente signée"
        color="emerald"
      />
    </div>
  );
}
