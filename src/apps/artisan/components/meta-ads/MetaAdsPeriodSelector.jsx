import { Calendar } from 'lucide-react';

const PRESETS = [
  { key: '7d', label: '7 jours', days: 7 },
  { key: '30d', label: '30 jours', days: 30 },
  { key: '90d', label: '90 jours', days: 90 },
];

export function computeRange(presetKey, customStart, customEnd) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);

  if (presetKey === 'custom') {
    return {
      startDate: customStart,
      endDate: customEnd,
    };
  }

  const preset = PRESETS.find((p) => p.key === presetKey) || PRESETS[1];
  const start = new Date(today);
  start.setDate(start.getDate() - (preset.days - 1));

  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export function MetaAdsPeriodSelector({ presetKey, onPresetChange, startDate, endDate, onCustomChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center rounded-lg border border-secondary-200 bg-white shadow-sm">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onPresetChange(p.key)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors first:rounded-l-lg last:rounded-r-lg ${
              presetKey === p.key
                ? 'bg-primary-600 text-white'
                : 'text-secondary-700 hover:bg-secondary-50'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPresetChange('custom')}
          className={`px-3 py-1.5 text-sm font-medium transition-colors rounded-r-lg flex items-center gap-1.5 ${
            presetKey === 'custom'
              ? 'bg-primary-600 text-white'
              : 'text-secondary-700 hover:bg-secondary-50'
          }`}
        >
          <Calendar className="w-4 h-4" />
          Personnalisé
        </button>
      </div>

      {presetKey === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => onCustomChange({ startDate: e.target.value, endDate })}
            className="rounded-md border border-secondary-200 bg-white px-2 py-1.5 text-sm"
          />
          <span className="text-secondary-400">—</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => onCustomChange({ startDate, endDate: e.target.value })}
            className="rounded-md border border-secondary-200 bg-white px-2 py-1.5 text-sm"
          />
        </div>
      )}
    </div>
  );
}
