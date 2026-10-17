import { Search, X } from 'lucide-react';
import { formatDuree, formatDateCourte, HORS_PERIMETRE_KEY } from '../lib/chantierGaillacModel';

const GROUPS = [
  { value: 'planning', label: 'Planning' },
  { value: 'site', label: 'Site' },
  { value: 'theme', label: 'Thème' },
];

function Segmented({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white">
      {options.map((o, i) => (
        <button
          key={o.value || 'all'}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-[44px] px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5C542] ${
            i ? 'border-l border-slate-300' : ''
          } ${value === o.value ? 'bg-[#1565C0] text-white' : 'text-slate-700 hover:bg-slate-50'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Barre de filtres : regroupement, technicien, code, masquer validées, recherche. */
export default function GaillacFilters({ filters, onChange, techniciens, options }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const techOptions = [{ value: '', label: 'Tous' }, ...techniciens.map((t) => ({ value: t.id, label: t.first_name || t.display_name }))];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented label="Regrouper par" options={GROUPS} value={filters.group} onChange={(group) => set({ group })} />
      <Segmented
        label="Technicien"
        options={techOptions}
        value={filters.techId}
        onChange={(techId) => set({ techId, planningCode: '' })}
      />
      <label className="flex min-w-0 max-w-full items-center gap-2 text-sm text-slate-700">
        <span className="shrink-0">Journée / code</span>
        <select
          value={filters.planningCode}
          onChange={(e) => set({ planningCode: e.target.value })}
          className="min-h-[44px] min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="">Toutes</option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.date ? `${formatDateCourte(o.date)} · ` : ''}{o.label}
              {o.code === HORS_PERIMETRE_KEY ? '' : ` (${formatDuree(o.totalMin)})`}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={filters.hideDone}
          onChange={(e) => set({ hideDone: e.target.checked })}
          className="h-5 w-5 accent-[#1565C0]"
        />
        Masquer les tâches validées
      </label>
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="search"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Site, tâche, n°…"
          aria-label="Rechercher"
          className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-sm"
        />
        {filters.q && (
          <button
            type="button"
            onClick={() => set({ q: '' })}
            aria-label="Effacer la recherche"
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
