import { useEffect, useState } from 'react';
import { supabase } from '@lib/supabaseClient';
import { Button } from '@components/ui/button';
import { Calendar } from '@components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select';
import { CalendarIcon, X, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@lib/utils';
import { Checkbox } from '@components/ui/checkbox';
import { Label } from '@components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@components/ui/collapsible';

export const DashboardFilters = ({
  filters,
  onUpdatePeriod,
  onUpdateSourceIds,
  onUpdateCommercialId,
  onReset,
  isAdmin,
}) => {
  const [sources, setSources] = useState([]);
  const [commercials, setCommercials] = useState([]);
  const [dateRange, setDateRange] = useState(filters.period);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    fetchData();
  }, [isAdmin]);

  const fetchData = async () => {
    const [sourcesRes, commercialsRes] = await Promise.all([
      supabase.from('sources').select('id, name').eq('is_active', true).order('name'),
      isAdmin
        ? supabase.from('profiles').select('id, full_name').order('full_name')
        : Promise.resolve({ data: null }),
    ]);

    setSources(sourcesRes.data || []);
    if (commercialsRes.data) {
      setCommercials(commercialsRes.data);
    }
  };

  const handleDateRangeChange = (range) => {
    if (range.from && range.to) {
      const newRange = { from: range.from, to: range.to };
      setDateRange(newRange);
      onUpdatePeriod(newRange);
    }
  };

  const toggleSource = (sourceId) => {
    const newSourceIds = filters.sourceIds.includes(sourceId)
      ? filters.sourceIds.filter((id) => id !== sourceId)
      : [...filters.sourceIds, sourceId];
    onUpdateSourceIds(newSourceIds);
  };

  const hasActiveFilters = filters.sourceIds.length > 0 || filters.commercialId !== null;

  return (
    <div className="bg-card rounded-lg border">
      {/* Mobile: Collapsible filters */}
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="md:hidden">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between p-4 h-auto">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              <span className="font-medium">Filtres</span>
              {hasActiveFilters && (
                <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">
                  Actifs
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{isOpen ? 'Masquer' : 'Afficher'}</span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="p-4 pt-0 space-y-4">
          <MobileFilters
            dateRange={dateRange}
            filters={filters}
            sources={sources}
            commercials={commercials}
            isAdmin={isAdmin}
            hasActiveFilters={hasActiveFilters}
            onDateRangeChange={handleDateRangeChange}
            onToggleSource={toggleSource}
            onUpdateCommercialId={onUpdateCommercialId}
            onReset={onReset}
          />
        </CollapsibleContent>
      </Collapsible>

      {/* Desktop: Always visible */}
      <div className="hidden md:block p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Period Filter */}
          <div className="flex-1 min-w-[180px] max-w-[280px]">
            <Label className="text-sm font-medium mb-2 block">Période</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn('w-full justify-start text-left font-normal text-sm', !dateRange && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {dateRange?.from
                      ? dateRange.to
                        ? `${format(dateRange.from, 'dd MMM', { locale: fr })} - ${format(dateRange.to, 'dd MMM yy', { locale: fr })}`
                        : format(dateRange.from, 'dd MMM yyyy', { locale: fr })
                      : 'Choisir une période'}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={{ from: dateRange.from, to: dateRange.to }}
                  onSelect={handleDateRangeChange}
                  initialFocus
                  locale={fr}
                  className="pointer-events-auto"
                />
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

          {/* Commercial Filter (Admin only) */}
          {isAdmin && (
            <div className="flex-1 min-w-[160px] max-w-[220px]">
              <Label className="text-sm font-medium mb-2 block">Commercial</Label>
              <Select
                value={filters.commercialId || 'all'}
                onValueChange={(value) => onUpdateCommercialId(value === 'all' ? null : value)}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Tous" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les commerciaux</SelectItem>
                  {commercials.map((commercial) => (
                    <SelectItem key={commercial.id} value={commercial.id}>
                      {commercial.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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

// Mobile filters component
const MobileFilters = ({
  dateRange,
  filters,
  sources,
  commercials,
  isAdmin,
  hasActiveFilters,
  onDateRangeChange,
  onToggleSource,
  onUpdateCommercialId,
  onReset,
}) => (
  <div className="space-y-4">
    {/* Period */}
    <div>
      <Label className="text-sm font-medium mb-2 block">Période</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start text-left font-normal">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {format(dateRange.from, 'dd MMM', { locale: fr })} - {format(dateRange.to, 'dd MMM yy', { locale: fr })}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={{ from: dateRange.from, to: dateRange.to }}
            onSelect={onDateRangeChange}
            initialFocus
            locale={fr}
            className="pointer-events-auto"
          />
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
                  onCheckedChange={() => onToggleSource(source.id)}
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

    {/* Commercial (Admin only) */}
    {isAdmin && (
      <div>
        <Label className="text-sm font-medium mb-2 block">Commercial</Label>
        <Select
          value={filters.commercialId || 'all'}
          onValueChange={(value) => onUpdateCommercialId(value === 'all' ? null : value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Tous les commerciaux" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les commerciaux</SelectItem>
            {commercials.map((commercial) => (
              <SelectItem key={commercial.id} value={commercial.id}>
                {commercial.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )}

    {/* Reset */}
    {hasActiveFilters && (
      <Button variant="outline" onClick={onReset} className="w-full">
        <X className="h-4 w-4 mr-2" />
        Réinitialiser les filtres
      </Button>
    )}
  </div>
);
