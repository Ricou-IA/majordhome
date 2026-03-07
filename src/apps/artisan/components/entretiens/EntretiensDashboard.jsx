/**
 * EntretiensDashboard.jsx - Tab Dashboard des entretiens
 * ============================================================================
 * Version simplifiée : les stat cards principales sont dans le header Entretiens.jsx.
 * Ce composant affiche :
 *   - 2 info cards (CA Entretien + Taux de réalisation) — non cliquables
 *   - Chart Recharts (répartition par fréquence)
 *
 * @version 3.0.0 - Stat cards retirées vers header, restyle borders
 * @version 2.0.0 - Sprint 5 — Stats cards + chart par type
 * ============================================================================
 */

import { Euro, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatEuro } from '@/lib/utils';

// ============================================================================
// SOUS-COMPOSANT : Info Card (non cliquable)
// ============================================================================

function InfoCard({ label, value, icon: Icon, color = 'text-blue-600', bgColor = 'bg-blue-50', suffix = '' }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${bgColor}`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-gray-500 truncate">{label}</p>
          <p className="text-2xl font-semibold text-gray-900">
            {value}
            {suffix && <span className="text-base font-normal text-gray-500 ml-1">{suffix}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function EntretiensDashboard({ stats, isLoading }) {
  if (isLoading || !stats) {
    return (
      <div className="space-y-6">
        {/* Skeleton info cards */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-20 bg-white rounded-lg border border-gray-200 animate-pulse" />
          ))}
        </div>
        {/* Skeleton chart */}
        <div className="h-80 bg-white rounded-lg border border-gray-200 animate-pulse" />
      </div>
    );
  }

  // Préparer les données du chart par fréquence
  const chartData = (stats.byType || [])
    .filter((t) => t.count >= 2)
    .map((t) => ({
      type: t.type.length > 15 ? t.type.substring(0, 13) + '...' : t.type,
      'Contrats': t.count,
      'Visites effectuées': t.visitsDone,
      'À faire': Math.max(0, t.count - t.visitsDone),
    }));

  return (
    <div className="space-y-6">
      {/* Info cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <InfoCard
          label="CA Entretien"
          value={formatEuro(stats.totalRevenue)}
          icon={Euro}
          color="text-blue-600"
          bgColor="bg-blue-100"
        />
        <InfoCard
          label="Taux de réalisation"
          value={stats.completionRate}
          icon={TrendingUp}
          color="text-emerald-600"
          bgColor="bg-emerald-100"
          suffix="%"
        />
      </div>

      {/* Chart par fréquence de contrat */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Répartition par fréquence</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="type" tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
              />
              <Legend />
              <Bar dataKey="Visites effectuées" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="À faire" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Message si pas de données chart */}
      {chartData.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500">Pas assez de données pour afficher le graphique.</p>
        </div>
      )}
    </div>
  );
}
