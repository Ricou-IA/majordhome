import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { formatEuro } from '@lib/utils';

const EVENT_STYLES = {
  launch: { color: '#10b981', label: '▲', title: 'Lancement' },
  pause: { color: '#f59e0b', label: '‖', title: 'Pause' },
  resume: { color: '#3b82f6', label: '▶', title: 'Reprise' },
};

function formatTick(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

function TooltipContent({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  return (
    <div className="bg-white border border-secondary-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-medium text-secondary-900 mb-1">{label}</div>
      <div className="flex items-center justify-between gap-4 text-blue-700">
        <span>Dépense</span>
        <span className="tabular-nums">{formatEuro(row?.spend ?? 0)}</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-secondary-900">
        <span>Leads Meta</span>
        <span className="tabular-nums">{row?.leads_meta ?? 0}</span>
      </div>
    </div>
  );
}

function EventLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-secondary-500">
      {Object.entries(EVENT_STYLES).map(([key, cfg]) => (
        <span key={key} className="inline-flex items-center gap-1">
          <span
            className="inline-block w-0.5 h-3"
            style={{ backgroundColor: cfg.color }}
          />
          {cfg.title}
        </span>
      ))}
    </div>
  );
}

export function MetaAdsDailyChart({ dailySeries, events = [] }) {
  if (!dailySeries || dailySeries.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-secondary-200 p-8 text-center text-secondary-500">
        Aucune donnée pour cette période.
      </div>
    );
  }

  const validDates = new Set(dailySeries.map((d) => d.date));
  const visibleEvents = (events || []).filter((e) => validDates.has(e.date));

  return (
    <div className="bg-white rounded-lg border border-secondary-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-secondary-900">
          Évolution quotidienne
        </div>
        {visibleEvents.length > 0 && (
          <div className="text-xs text-secondary-500">
            {visibleEvents.length} événement{visibleEvents.length > 1 ? 's' : ''} campagne
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={dailySeries}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            tickFormatter={formatTick}
            className="text-xs"
            minTickGap={20}
          />
          <YAxis yAxisId="left" className="text-xs" tickFormatter={(v) => `${v}€`} />
          <YAxis
            yAxisId="right"
            orientation="right"
            className="text-xs"
            allowDecimals={false}
            domain={[0, 4]}
            ticks={[0, 1, 2, 3, 4]}
          />
          <Tooltip content={<TooltipContent />} />
          <Legend />
          {visibleEvents.map((ev, idx) => {
            const style = EVENT_STYLES[ev.type] || EVENT_STYLES.launch;
            return (
              <ReferenceLine
                key={`${ev.type}-${ev.campaign_id}-${ev.date}-${idx}`}
                yAxisId="left"
                x={ev.date}
                stroke={style.color}
                strokeDasharray="2 2"
                strokeWidth={1.5}
                ifOverflow="extendDomain"
                label={{
                  value: style.label,
                  position: 'top',
                  fill: style.color,
                  fontSize: 11,
                }}
              >
                <title>{`${style.title} · ${ev.campaign_name} (${ev.ad_account_name})`}</title>
              </ReferenceLine>
            );
          })}
          <Bar
            yAxisId="left"
            dataKey="spend"
            fill="#3b82f6"
            name="Dépense (€)"
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="left"
            type="stepAfter"
            dataKey="budget_display"
            stroke="#1e40af"
            name="Budget plafond (€)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            activeDot={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="leads_meta"
            stroke="#000000"
            name="Leads Meta"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {visibleEvents.length > 0 && <EventLegend />}
    </div>
  );
}
