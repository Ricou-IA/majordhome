import { useEffect, useState } from 'react';
import { supabase } from '@lib/supabaseClient';
import { Button } from '@components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover';
import { ChevronLeft, ChevronRight, X, Filter } from 'lucide-react';
import { cn } from '@lib/utils';
import { Checkbox } from '@components/ui/checkbox';
import { Label } from '@components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@components/ui/collapsible';

// ============================================================================
// CONSTANTES
// ============================================================================

const MONTH_LABELS = [
  'Janv.', 'Févr.', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.',
];

const MONTH_LABELS_LONG = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const toMonthKey = (year, month) =>
  `${year}-${String(month + 1).padStart(2, '0')}`;

const formatMonthsLabel = (months) => {
  if (!months || months.length === 0) return 'Sélectionner';
  if (months.length === 1) {
    const [y, m] = months[0].split('-').map(Number);
    return `${MONTH_LABELS_LONG[m - 1]} ${y}`;
  }
  // Trier et afficher un résumé
  const sorted = [...months].sort();
  const first = sorted[0].split('-').map(Number);
  const last = sorted[sorted.length - 1].split('-').map(Number);
  return `${MONTH_LABELS[first[1] - 1]} → ${MONTH_LABELS[last[1] - 1]} ${last[0]} (${months.length})`;
};

// ============================================================================
// MONTH PICKER COMPOSANT
// ============================================================================

const MonthPicker = ({ selectedMonths, onChange }) => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const isDragging = dragStart !== null;

  // Calcule la plage entre deux index de mois (gère les deux sens)
  const getRange = (startIdx, endIdx) => {
    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);
    const months = [];
    for (let i = min; i <= max; i++) {
      const isFuture =
        year > now.getFullYear() ||
        (year === now.getFullYear() && i > now.getMonth());
      if (!isFuture) months.push(toMonthKey(year, i));
    }
    return months;
  };

  // Preview : mois dans la plage en cours de drag
  const dragPreview = isDragging && dragEnd !== null
    ? getRange(dragStart, dragEnd)
    : [];

  const handleMouseDown = (index, isFuture) => {
    if (isFuture) return;
    setDragStart(index);
    setDragEnd(index);
  };

  const handleMouseEnter = (index) => {
    if (!isDragging) return;
    setDragEnd(index);
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    const end = dragEnd ?? dragStart;
    const range = getRange(dragStart, end);
    if (range.length > 0) onChange(range.sort());
    setDragStart(null);
    setDragEnd(null);
  };

  // Clic simple (mouseDown + mouseUp sur le même mois sans drag)
  const handleClick = (index, isFuture) => {
    if (isFuture) return;
    // Si on a dragué sur plusieurs mois, handleMouseUp a déjà géré
    // Ce handler ne se déclenche que pour un clic simple (pas de drag)
  };

  return (
    <div
      className="w-[280px] select-none"
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        if (isDragging) handleMouseUp();
      }}
    >
      {/* Year navigation */}
      <div className="flex items-center justify-between mb-3 px-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setYear((y) => y - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-semibold text-secondary-900">{year}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setYear((y) => y + 1)}
          disabled={year >= now.getFullYear()}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-4 gap-1.5">
        {MONTH_LABELS.map((label, index) => {
          const monthKey = toMonthKey(year, index);
          const isSelected = selectedMonths.includes(monthKey);
          const isInDragPreview = dragPreview.includes(monthKey);
          const isFuture =
            year > now.getFullYear() ||
            (year === now.getFullYear() && index > now.getMonth());

          return (
            <button
              key={monthKey}
              disabled={isFuture}
              onMouseDown={() => handleMouseDown(index, isFuture)}
              onMouseEnter={() => handleMouseEnter(index)}
              className={cn(
                'px-2 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer',
                isFuture && 'text-secondary-300 cursor-not-allowed',
                !isFuture && !isSelected && !isInDragPreview && 'text-secondary-600 hover:bg-secondary-100',
                isInDragPreview && 'bg-blue-400 text-white shadow-sm',
                isSelected && !isInDragPreview && 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-secondary-400 mt-2 px-1 text-center">
        Clic = mois unique · Maintenir + glisser = période
      </p>
    </div>
  );
};

// ============================================================================
// DASHBOARD FILTERS
// ============================================================================

export const DashboardFilters = ({
  filters,
  onUpdateMonths,
  onUpdateSourceIds,
  onReset,
}) => {
  const [sources, setSources] = useState([]);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const fetchSources = async () => {
      const { data } = await supabase
        .from('majordhome_sources')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      setSources(data || []);
    };
    fetchSources();
  }, []);

  const toggleSource = (sourceId) => {
    const newSourceIds = filters.sourceIds.includes(sourceId)
      ? filters.sourceIds.filter((id) => id !== sourceId)
      : [...filters.sourceIds, sourceId];
    onUpdateSourceIds(newSourceIds);
  };

  const hasActiveFilters = filters.sourceIds.length > 0;

  return (
    <div className="bg-white rounded-xl border border-secondary-200 shadow-sm">
      {/* Mobile: Collapsible filters */}
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="md:hidden">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between p-4 h-auto">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              <span className="font-medium">Filtres</span>
              {hasActiveFilters && (
                <span className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full">
                  Actifs
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{isOpen ? 'Masquer' : 'Afficher'}</span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="p-4 pt-0 space-y-4">
          {/* Période (mois) */}
          <div>
            <Label className="text-sm font-medium mb-2 block">Période</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal text-sm">
                  {formatMonthsLabel(filters.months)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3" align="start">
                <MonthPicker selectedMonths={filters.months} onChange={onUpdateMonths} />
              </PopoverContent>
            </Popover>
          </div>

          {/* Sources */}
          <div>
            <Label className="text-sm font-medium mb-2 block">Sources</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                  {filters.sourceIds.length === 0
                    ? 'Toutes les sources'
                    : `${filters.sourceIds.length} source(s) sélectionnée(s)`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-4" align="start">
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {sources.map((source) => (
                    <div key={source.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`mobile-${source.id}`}
                        checked={filters.sourceIds.includes(source.id)}
                        onCheckedChange={() => toggleSource(source.id)}
                      />
                      <Label htmlFor={`mobile-${source.id}`} className="flex-1 cursor-pointer">
                        {source.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Reset */}
          {hasActiveFilters && (
            <Button variant="outline" onClick={onReset} className="w-full">
              <X className="h-4 w-4 mr-2" />
              Réinitialiser les filtres
            </Button>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Desktop: Always visible */}
      <div className="hidden md:block p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Period Filter (mois) */}
          <div className="flex-1 min-w-[200px] max-w-[300px]">
            <Label className="text-sm font-medium mb-2 block">Période</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start text-left font-normal text-sm"
                >
                  <span className="truncate">{formatMonthsLabel(filters.months)}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3" align="start">
                <MonthPicker selectedMonths={filters.months} onChange={onUpdateMonths} />
              </PopoverContent>
            </Popover>
          </div>

          {/* Sources Filter */}
          <div className="flex-1 min-w-[160px] max-w-[220px]">
            <Label className="text-sm font-medium mb-2 block">Sources</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-sm">
                  <span className="truncate">
                    {filters.sourceIds.length === 0
                      ? 'Toutes les sources'
                      : `${filters.sourceIds.length} source(s)`}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-4" align="start">
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {sources.map((source) => (
                    <div key={source.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={source.id}
                        checked={filters.sourceIds.includes(source.id)}
                        onCheckedChange={() => toggleSource(source.id)}
                      />
                      <Label htmlFor={source.id} className="flex-1 cursor-pointer text-sm">
                        {source.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Reset Button */}
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={onReset} className="shrink-0">
              <X className="h-4 w-4 mr-1" />
              Réinitialiser
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
