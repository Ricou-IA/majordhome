/**
 * CalendarToolbar.jsx - Majord'home Artisan
 * ============================================================================
 * Barre du haut du Planning : navigation dans les dates, semaine, titre, CA HT
 * programmé de la période, recherche d'un client, choix de la vue, menu « … »
 * (Rafraîchir, Imprimer) et « Nouveau RDV ». Affichage seul : tout vient de Planning.jsx.
 * ============================================================================
 */

import { Plus, ChevronLeft, ChevronRight, Loader2, RefreshCw, Printer } from 'lucide-react';
import { formatCa } from '@/lib/planningCa';
import { jourDOuverture } from '@/lib/planningGestes';
import { SegmentedControl } from '@components/ui/segmented-control';
import { Button } from '@components/ui/button';
import { Tag } from '@components/ui/tag';
import { MenuActions } from '@components/ui/menu-actions';
import { useDeviceClass } from '@hooks/useDeviceClass';
import { cn } from '@lib/utils';

// Icônes animées des entrées du menu « … » pendant un chargement ou une impression.
const RafraichirEnCours = ({ className }) => <RefreshCw className={cn(className, 'animate-spin')} />;
const ImpressionEnCours = ({ className }) => <Loader2 className={cn(className, 'animate-spin')} />;

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
  const { isPhone } = useDeviceClass();

  // Rafraîchir et Imprimer vont dans le menu « … ». Imprimer n'y est pas sur
  // téléphone (PDF d'une personne, geste de bureau) ; grisé, il dit pourquoi dans
  // son libellé (une entrée désactivée ne montre pas d'infobulle au survol).
  const actionsMenu = [
    { label: 'Rafraîchir', icon: isLoading ? RafraichirEnCours : RefreshCw, onClick: onRefresh, disabled: isLoading },
    !isPhone && {
      label: printHint ? `Imprimer — ${printHint}` : isPrinting ? 'Impression…' : printLabel || 'Imprimer',
      icon: isPrinting ? ImpressionEnCours : Printer,
      onClick: onPrint,
      disabled: !!printHint || isPrinting,
    },
  ];

  // Sous `sm` (téléphone) : titre sur sa ligne, puis navigation et actions. Dès `xl`
  // (1 440 px, menu ouvert), tout tient sur une ligne : la recherche se resserre.
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap">
      {/* Navigation dates */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="secondary" size="sm" onClick={goToday} className="max-sm:h-10">
          Aujourd&apos;hui
        </Button>
        <div className="flex items-center">
          <button
            onClick={goPrev}
            aria-label="Période précédente"
            className="h-10 w-10 sm:h-auto sm:w-auto flex items-center justify-center sm:p-1.5 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={goNext}
            aria-label="Période suivante"
            className="h-10 w-10 sm:h-auto sm:w-auto flex items-center justify-center sm:p-1.5 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        {weekNumber != null && (
          <span title={`Semaine ${weekNumber}`} className="shrink-0">
            <Tag className="font-semibold tabular-nums">S{weekNumber}</Tag>
          </span>
        )}
        <h2 className="font-display text-count text-secondary-900 whitespace-nowrap sm:min-w-[200px] xl:min-w-0 first-letter:uppercase">
          {title}
        </h2>
        {caCumul > 0 && (
          <span
            className="shrink-0"
            title={`CA HT programmé sur la période affichée, ${caCumulPartiel ? 'part des personnes affichées (filtre équipe actif)' : 'tous techniciens confondus'}.
Devis validés des installations (au prorata des journées posées) + contrats d’entretien. SAV non compté.`}
          >
            <Tag className="font-semibold tabular-nums text-secondary-900">{formatCa(caCumul)} HT</Tag>
          </span>
        )}
      </div>

      {/* Recherche d'un client — sur la ligne de la navigation, entre les dates et les actions */}
      {search && <div className="sm:flex-1 sm:min-w-[14rem] xl:min-w-[8rem] sm:max-w-md">{search}</div>}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Sélecteur de vue */}
        <SegmentedControl value={currentView} onChange={onViewChange} options={views} label="Vue du planning" />

        <MenuActions libelle="Autres actions du planning" actions={actionsMenu} className="max-sm:h-10 max-sm:w-10" />

        {onAddEvent && (
          <Button variant="primary" onClick={onAddEvent} className="max-sm:h-10 max-sm:px-3">
            <Plus aria-hidden="true" />
            <span className="hidden sm:inline">Nouveau RDV</span>
            <span className="sm:hidden">RDV</span>
          </Button>
        )}
      </div>
    </div>
  );
}
