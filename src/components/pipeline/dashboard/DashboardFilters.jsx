/**
 * DashboardFilters.jsx — barre de filtres du Dashboard du pipeline : période (un mois
 * ou une plage de mois) et sources. Une seule ligne, pas de panneau.
 */

import { useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Tag, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover';
import { Checkbox } from '@components/ui/checkbox';
import { Label } from '@components/ui/label';
import { cn } from '@lib/utils';
import { libellePeriode } from './format';

const MONTH_LABELS = ['Janv.', 'Févr.', 'Mars', 'Avril', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

const toMonthKey = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}`;

const boutonFiltre = (actif) => cn(
  'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
  actif
    ? 'border-primary-200 bg-primary-50 text-primary-800'
    : 'border-secondary-200 bg-white text-secondary-700 hover:bg-secondary-50',
);

// ============================================================================
// SÉLECTEUR DE MOIS (clic = un mois, glisser = une plage)
// ============================================================================

const MonthPicker = ({ selectedMonths, onChange }) => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const isDragging = dragStart !== null;

  const estFutur = (index) =>
    year > now.getFullYear() || (year === now.getFullYear() && index > now.getMonth());

  // Plage entre deux index de mois (dans les deux sens), mois futurs exclus
  const getRange = (startIdx, endIdx) => {
    const months = [];
    for (let i = Math.min(startIdx, endIdx); i <= Math.max(startIdx, endIdx); i++) {
      if (!estFutur(i)) months.push(toMonthKey(year, i));
    }
    return months;
  };

  const dragPreview = isDragging && dragEnd !== null ? getRange(dragStart, dragEnd) : [];

  const handleMouseUp = () => {
    if (!isDragging) return;
    const range = getRange(dragStart, dragEnd ?? dragStart);
    if (range.length > 0) onChange(range.sort());
    setDragStart(null);
    setDragEnd(null);
  };

  return (
    <div className="w-[264px] select-none" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setYear((y) => y - 1)}
          aria-label="Année précédente"
          className="rounded p-1.5 text-secondary-600 hover:bg-secondary-100"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold tabular-nums text-secondary-900">{year}</span>
        <button
          type="button"
          onClick={() => setYear((y) => y + 1)}
          disabled={year >= now.getFullYear()}
          aria-label="Année suivante"
          className="rounded p-1.5 text-secondary-600 hover:bg-secondary-100 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {MONTH_LABELS.map((label, index) => {
          const monthKey = toMonthKey(year, index);
          const futur = estFutur(index);
          const dansApercu = dragPreview.includes(monthKey);
          const choisi = selectedMonths.includes(monthKey);
          return (
            <button
              key={monthKey}
              type="button"
              disabled={futur}
              onMouseDown={() => { if (!futur) { setDragStart(index); setDragEnd(index); } }}
              onMouseEnter={() => { if (isDragging) setDragEnd(index); }}
              className={cn(
                'rounded px-1 py-2 text-xs font-medium transition-colors',
                futur && 'cursor-not-allowed text-secondary-300',
                !futur && !choisi && !dansApercu && 'text-secondary-700 hover:bg-secondary-100',
                dansApercu && 'bg-primary-400 text-white',
                choisi && !dansApercu && 'bg-primary-600 text-white',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-center text-[11px] text-secondary-400">Clic : un mois · Glisser : une plage</p>
    </div>
  );
};

// ============================================================================
// BARRE DE FILTRES
// ============================================================================

/**
 * @param {Object} props
 * @param {{ months: string[], sourceIds: string[] }} props.filters
 * @param {Array<{ id: string, name: string }>} props.sources
 */
export const DashboardFilters = ({ filters, sources = [], onUpdateMonths, onUpdateSourceIds, onReset }) => {
  const nbSources = filters.sourceIds.length;

  const toggleSource = (sourceId) => {
    onUpdateSourceIds(
      filters.sourceIds.includes(sourceId)
        ? filters.sourceIds.filter((id) => id !== sourceId)
        : [...filters.sourceIds, sourceId],
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={boutonFiltre(false)}>
            <CalendarDays className="h-4 w-4 text-secondary-500" />
            {libellePeriode(filters.months)}
            <ChevronDown className="h-4 w-4 text-secondary-400" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <MonthPicker selectedMonths={filters.months} onChange={onUpdateMonths} />
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={boutonFiltre(nbSources > 0)}>
            <Tag className="h-4 w-4" />
            {nbSources === 0 ? 'Toutes les sources' : `${nbSources} source${nbSources > 1 ? 's' : ''}`}
            <ChevronDown className="h-4 w-4 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {sources.map((source) => (
              <div key={source.id} className="flex items-center gap-2">
                <Checkbox
                  id={`source-${source.id}`}
                  checked={filters.sourceIds.includes(source.id)}
                  onCheckedChange={() => toggleSource(source.id)}
                />
                <Label htmlFor={`source-${source.id}`} className="flex-1 cursor-pointer text-sm font-normal">
                  {source.name}
                </Label>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {nbSources > 0 && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm text-secondary-600 hover:bg-secondary-100"
        >
          <X className="h-4 w-4" />
          Réinitialiser
        </button>
      )}
    </div>
  );
};
