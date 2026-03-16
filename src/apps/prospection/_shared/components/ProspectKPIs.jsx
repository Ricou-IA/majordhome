/**
 * ProspectKPIs.jsx — Cartes KPI pour le module Prospection
 */

import { Users, Star, Phone, TrendingUp, ArrowRight, UserCheck } from 'lucide-react';

const CEDANTS_KPIS = [
  { key: 'total', label: 'Total prospects', icon: Users, color: 'bg-[#2196F3]' },
  { key: 'prioriteA', label: 'Priorité A', icon: Star, color: 'bg-[#F5C542]' },
  { key: 'contacted', label: 'Contact initié', icon: Phone, color: 'bg-emerald-500' },
  { key: 'avgScore', label: 'Score moyen', icon: TrendingUp, color: 'bg-violet-500' },
];

const COMMERCIAL_KPIS = [
  { key: 'total', label: 'Total prospects', icon: Users, color: 'bg-[#2196F3]' },
  { key: 'contacted', label: 'Contactés', icon: Phone, color: 'bg-emerald-500' },
  { key: 'rdvFixes', label: 'RDV fixés', icon: Star, color: 'bg-[#F5C542]' },
  { key: 'converted', label: 'Convertis', icon: UserCheck, color: 'bg-violet-500' },
];

function getKpiValue(stats, key) {
  if (!stats) return 0;
  switch (key) {
    case 'total': return stats.total || 0;
    case 'prioriteA': return stats.prioriteA || 0;
    case 'contacted': return stats.byStatus?.contact_initie || 0;
    case 'avgScore': return stats.avgScore || 0;
    case 'rdvFixes': return stats.byStatus?.rdv_fixe || 0;
    case 'converted': return stats.converted || 0;
    default: return 0;
  }
}

export default function ProspectKPIs({ stats, module, isLoading }) {
  const kpis = module === 'cedants' ? CEDANTS_KPIS : COMMERCIAL_KPIS;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        const value = isLoading ? '—' : getKpiValue(stats, kpi.key);
        return (
          <div
            key={kpi.key}
            className="bg-white rounded-xl border border-secondary-200 p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${kpi.color} flex items-center justify-center`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xl font-bold text-secondary-900">{value}</p>
                <p className="text-xs text-secondary-500">{kpi.label}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
