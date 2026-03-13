import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { formatEuro } from '@lib/utils';

const COMMERCIAL_COLORS = [
  { bg: 'bg-indigo-50', text: 'text-indigo-700', accent: 'bg-indigo-500', ring: 'ring-indigo-200' },
  { bg: 'bg-teal-50', text: 'text-teal-700', accent: 'bg-teal-500', ring: 'ring-teal-200' },
  { bg: 'bg-rose-50', text: 'text-rose-700', accent: 'bg-rose-500', ring: 'ring-rose-200' },
  { bg: 'bg-amber-50', text: 'text-amber-700', accent: 'bg-amber-500', ring: 'ring-amber-200' },
];

function getInitials(fullName) {
  if (!fullName) return '?';
  return fullName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function MiniKpi({ label, value }) {
  return (
    <div className="text-center">
      <p className="text-xs text-secondary-500">{label}</p>
      <p className="text-sm font-bold text-secondary-900">{value}</p>
    </div>
  );
}

export const CommercialKpis = ({ commercialMetrics }) => {
  if (!commercialMetrics || commercialMetrics.length === 0) return null;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-secondary-900">
          Performance par commercial
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {commercialMetrics.map((cm, index) => {
          const colors = COMMERCIAL_COLORS[index % COMMERCIAL_COLORS.length];
          const convRdv = cm.leads > 0 ? ((cm.appointments / cm.leads) * 100).toFixed(0) : 0;
          const convVente = cm.leads > 0 ? ((cm.sales / cm.leads) * 100).toFixed(0) : 0;
          return (
            <div
              key={cm.userId}
              className={`flex items-center gap-4 p-3 rounded-lg ${colors.bg} ring-1 ${colors.ring}`}
            >
              {/* Avatar initiales */}
              <div
                className={`w-9 h-9 rounded-full ${colors.accent} flex items-center justify-center flex-shrink-0`}
              >
                <span className="text-xs font-bold text-white">{getInitials(cm.fullName)}</span>
              </div>

              {/* Nom */}
              <div className="min-w-[110px] sm:min-w-[140px]">
                <p className={`text-sm font-semibold ${colors.text} truncate`}>{cm.fullName}</p>
              </div>

              {/* 4 KPIs inline */}
              <div className="flex-1 grid grid-cols-4 gap-2 sm:gap-4">
                <MiniKpi label="Leads" value={cm.leads} />
                <MiniKpi label="RDV" value={`${cm.appointments} (${convRdv}%)`} />
                <MiniKpi label="Ventes" value={`${cm.sales} (${convVente}%)`} />
                <MiniKpi label="CA HT" value={formatEuro(cm.revenue)} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
