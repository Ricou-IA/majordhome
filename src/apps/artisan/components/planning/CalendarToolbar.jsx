/**
 * CalendarToolbar.jsx - Majord'home Artisan
 * ============================================================================
 * Barre du haut du Planning : navigation dans les dates, semaine, titre, CA HT
 * programmé de la période, recherche d'un client, choix de la vue, impression
 * et « Nouveau RDV ». Affichage seul : tout vient de Planning.jsx.
 * ============================================================================
 */

import { Plus, ChevronLeft, ChevronRight, Loader2, RefreshCw, Printer } from 'lucide-react';
import { formatCa } from '@/lib/planningCa';
import { jourDOuverture } from '@/lib/planningGestes';

const VUES_BUREAU = [
  { value: 'timeGridDay', label: 'Jour' },
  { value: 'timeGridWeek', label: 'Semaine' },
  { value: 'dayGridMonth', label: 'Mois' },
];

// Appareil tenu en main (téléphone, tablette) : une grille horaire à 5
// colonnes, ou plusieurs techniciens côte à côte dans la journée, donnent des
// blocs illisibles. Jour et Semaine deviennent des LISTES pleine largeur (un
// RDV par ligne) ; la grille horaire reste accessible (« Heures ») pour poser
// au doigt. Validé par Eric sur téléphone le 2026-10-24, étendu à la tablette.
const VUES_MOBILE = [
  { value: 'listDay', label: 'Jour' },
  { value: 'listWeek', label: 'Semaine' },
  { value: 'timeGridDay', label: 'Heures' },
  { value: 'dayGridMonth', label: 'Mois' },
];

/**
 * Barre d'outils du calendrier
 */
export function CalendarToolbar({
  calendarRef,
  currentView,
  onViewChange,
  title,
  weekNumber,
  caCumul,
  caCumulPartiel,
  onAddEvent,
  onRefresh,
  isLoading,
  onPrint,
  printHint,
  printLabel,
  isPrinting,
  isMobileDevice,
  search,
}) {
  // Le week-end, « Aujourd'hui » mène au lundi suivant, comme à l'ouverture.
  const goToday = () => {
    const api = calendarRef.current?.getApi();
    const lundi = jourDOuverture();
    if (lundi) api?.gotoDate(lundi);
    else api?.today();
  };
  const goPrev = () => calendarRef.current?.getApi().prev();
  const goNext = () => calendarRef.current?.getApi().next();

  const views = isMobileDevice ? VUES_MOBILE : VUES_BUREAU;

  // Sous `sm` (téléphone) : titre sur sa ligne, puis navigation et actions ;
  // Imprimer disparaît (PDF d'une personne, geste de bureau).
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap">
      {/* Navigation dates */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={goToday}
          className="h-10 sm:h-auto px-3 py-1.5 text-sm font-medium bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Aujourd&apos;hui
        </button>
        <div className="flex items-center">
          <button
            onClick={goPrev}
            aria-label="Période précédente"
            className="h-10 w-10 sm:h-auto sm:w-auto flex items-center justify-center sm:p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={goNext}
            aria-label="Période suivante"
            className="h-10 w-10 sm:h-auto sm:w-auto flex items-center justify-center sm:p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        {weekNumber != null && (
          <span
            className="px-2 py-1 text-sm font-semibold bg-blue-50 text-blue-700 rounded-md shrink-0"
            title={`Semaine ${weekNumber}`}
          >
            S{weekNumber}
          </span>
        )}
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 sm:min-w-[200px] first-letter:uppercase">
          {title}
        </h2>
        {caCumul > 0 && (
          <span
            className="px-2 py-1 text-sm font-semibold tabular-nums bg-secondary-100 text-secondary-900 rounded-md shrink-0"
            title={`CA HT programmé sur la période affichée, ${caCumulPartiel ? 'part des personnes affichées (filtre équipe actif)' : 'tous techniciens confondus'}.\nDevis validés des installations (au prorata des journées posées) + contrats d’entretien. SAV non compté.`}
          >
            {formatCa(caCumul)} HT
          </span>
        )}
      </div>

      {/* Recherche d'un client — sur la ligne de la navigation, entre les dates et les actions */}
      {search && <div className="sm:flex-1 sm:min-w-[14rem] sm:max-w-md">{search}</div>}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Sélecteur de vue */}
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          {views.map(v => (
            <button
              key={v.value}
              onClick={() => onViewChange(v.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                currentView === v.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="h-10 w-10 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Rafraîchir"
          aria-label="Rafraîchir le planning"
        >
          <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>

        <button
          onClick={onPrint}
          disabled={!!printHint || isPrinting}
          className="hidden sm:inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={printHint || printLabel}
        >
          {isPrinting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
          Imprimer
        </button>

        {onAddEvent && (
          <button
            onClick={onAddEvent}
            className="inline-flex items-center gap-2 h-10 px-3 sm:px-4 bg-primary-700 text-white rounded-lg hover:bg-primary-800 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nouveau RDV</span>
            <span className="sm:hidden">RDV</span>
          </button>
        )}
      </div>
    </div>
  );
}
