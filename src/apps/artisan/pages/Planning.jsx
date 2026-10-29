/**
 * Planning.jsx - Majord'home Artisan
 * ============================================================================
 * Page planning avec calendrier FullCalendar interactif.
 * Vues : semaine, jour, mois. Drag & drop + resize.
 * Filtres par technicien et type de RDV.
 *
 * @version 2.0.0 - Sprint 2 : FullCalendar + CRUD RDV
 * ============================================================================
 */

import { estTypeAdaptable } from '@/lib/souplesse';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Loader2,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  Wrench,
  Briefcase,
  Printer,
  MoveHorizontal,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useAppointments, useTeamMembers } from '@hooks/useAppointments';
import { useEtatsJournees } from '@hooks/useTournees';
import { useClientEquipmentLabels } from '@hooks/useClients';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useDeviceClass } from '@hooks/useDeviceClass';
import { isoWeekNumber } from '@/lib/planningPrintModel';
import { telechargerPlanningHebdo } from '@/apps/artisan/components/planning/planningPrintExport';
import { telechargerFeuilleDeRoute } from '@/apps/artisan/components/planning/feuilleDeRouteExport';
import { FeuilleDeRoutePanel } from '@/apps/artisan/components/planning/FeuilleDeRoutePanel';
import { useFeuilleDeRoute } from '@hooks/useFeuilleDeRoute';
import { APPOINTMENT_TYPES } from '@services/appointments.service';
import { EventModal } from '@/apps/artisan/components/planning/EventModal';
import { PlanningClientSearch } from '@/apps/artisan/components/planning/PlanningClientSearch';
import { JourneeEtatChips } from '@/apps/artisan/components/planning/JourneeEtatChips';
import { RemplirJourneePanel } from '@/apps/artisan/components/tournees/RemplirJourneePanel';
import { ChantierModal } from '@/apps/artisan/components/chantiers/ChantierModal';
import { EquipmentKindIcons } from '@/apps/artisan/components/shared/EquipmentKindIcons';
import { supabase } from '@/lib/supabaseClient';
import { formatDateForInput } from '@/lib/utils';
import { logger } from '@lib/logger';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Calcule les bornes de date selon la vue FullCalendar
 */
function getDateRange(dateInfo) {
  if (!dateInfo) {
    // Default : semaine courante étendue à ±1 mois pour prefetch
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
    };
  }
  return {
    startDate: dateInfo.startStr?.split('T')[0] || dateInfo.start?.toISOString().split('T')[0],
    endDate: dateInfo.endStr?.split('T')[0] || dateInfo.end?.toISOString().split('T')[0],
  };
}

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

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/**
 * Barre d'outils du calendrier
 */
function CalendarToolbar({
  calendarRef,
  currentView,
  onViewChange,
  title,
  weekNumber,
  onAddEvent,
  onRefresh,
  isLoading,
  onPrint,
  printHint,
  printLabel,
  isPrinting,
  isMobileDevice,
}) {
  const goToday = () => calendarRef.current?.getApi().today();
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
      </div>

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
            className="inline-flex items-center gap-2 h-10 px-3 sm:px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
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

/**
 * Bouton toggle de bucket (Intervention / Commercial)
 */
function KindToggle({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-50 border-blue-200 text-blue-700'
          : 'bg-white border-gray-300 text-gray-400 hover:bg-gray-50'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

/**
 * Filtres : toggles bucket (Intervention/Commercial) + chips équipe (par personne) + type
 */
function CalendarFilters({ filters, setFilters, teamList }) {
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);

  const kinds = filters.kinds || { intervention: true, commercial: true };
  const selectedKeys = filters.memberProfileKeys || [];
  const selectedType = APPOINTMENT_TYPES.find(t => t.value === filters.appointmentType);
  const hasFilters =
    selectedKeys.length > 0 || filters.appointmentType || !kinds.intervention || !kinds.commercial;

  const toggleKind = (kind) =>
    setFilters(f => ({ ...f, kinds: { ...f.kinds, [kind]: !f.kinds[kind] } }));

  const toggleMember = (profileKey) =>
    setFilters(f => {
      const cur = f.memberProfileKeys || [];
      const next = cur.includes(profileKey) ? cur.filter(k => k !== profileKey) : [...cur, profileKey];
      return { ...f, memberProfileKeys: next };
    });

  const resetAll = () =>
    setFilters(f => ({
      ...f,
      kinds: { intervention: true, commercial: true },
      memberProfileKeys: [],
      appointmentType: null,
    }));

  // Sous `sm` (téléphone) : les chips équipe défilent sur une ligne au lieu
  // d'empiler six lignes de boutons ; les tolérances (bandes de souplesse) sont
  // une lecture de bureau.
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Toggles bucket */}
      <div className="flex items-center gap-1.5">
        <KindToggle active={kinds.intervention} onClick={() => toggleKind('intervention')} icon={Wrench} label="Intervention" />
        <KindToggle active={kinds.commercial} onClick={() => toggleKind('commercial')} icon={Briefcase} label="Commercial" />
        {/* Bandes de tolérance des RDV adaptables (souplesse) — sur demande */}
        <span className="hidden sm:inline-flex">
          <KindToggle
            active={!!filters.showTolerance}
            onClick={() => setFilters(f => ({ ...f, showTolerance: !f.showTolerance }))}
            icon={MoveHorizontal}
            label="Tolérances"
          />
        </span>
      </div>

      <span className="hidden sm:block w-px h-6 bg-gray-200" />

      {/* Chips équipe (1 par personne) */}
      <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto no-scrollbar w-full sm:w-auto sm:flex-wrap -mx-1 px-1 py-0.5">
        {teamList.map(h => {
          const isSel = selectedKeys.includes(h.profileKey);
          return (
            <button
              key={h.profileKey}
              onClick={() => toggleMember(h.profileKey)}
              title={h.displayName}
              aria-pressed={isSel}
              className={`inline-flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 sm:py-1 rounded-full border text-sm transition-colors ${
                isSel
                  ? 'border-gray-400 bg-gray-100 text-gray-900'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: h.color }} />
              {h.displayName.split(' ')[0]}
            </button>
          );
        })}
      </div>

      <span className="hidden sm:block w-px h-6 bg-gray-200" />

      {/* Filtre type */}
      <div className="relative">
        <button
          onClick={() => setShowTypeDropdown(!showTypeDropdown)}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
            filters.appointmentType
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <CalendarIcon className="w-4 h-4" />
          {selectedType ? selectedType.label : 'Type'}
          <ChevronDown className={`w-3 h-3 transition-transform ${showTypeDropdown ? 'rotate-180' : ''}`} />
        </button>
        {showTypeDropdown && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowTypeDropdown(false)} />
            <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
              <button
                onClick={() => { setFilters(f => ({ ...f, appointmentType: null })); setShowTypeDropdown(false); }}
                className={`w-full flex items-center px-3 py-2 text-sm text-left ${!filters.appointmentType ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                Tous les types
              </button>
              {APPOINTMENT_TYPES.map(type => (
                <button
                  key={type.value}
                  onClick={() => { setFilters(f => ({ ...f, appointmentType: type.value })); setShowTypeDropdown(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
                    filters.appointmentType === type.value ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full ${type.bgClass}`} />
                  {type.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Reset filtres */}
      {hasFilters && (
        <button
          onClick={resetAll}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          Effacer
        </button>
      )}
    </div>
  );
}

/**
 * Rendu custom d'un événement dans le calendrier.
 * Vrai composant React (pas une simple render function) : EquipmentKindIcons
 * lit le cache useClientEquipmentKinds via hook.
 */
function PlanningEventContent({ eventInfo }) {
  const {
    typeConfig, client_name, client_first_name, status, grand_secteur, client_id, adaptable, hour_confirmed_at,
    appointment_type, provisoire,
  } = eventInfo.event.extendedProps;
  const typeSouple = estTypeAdaptable(appointment_type);
  const isCancelled = status === 'cancelled';
  const fullName = [client_name, client_first_name].filter(Boolean).join(' ');
  // Ligne 1 = type (plus le nom), ligne 2 = nom · grand secteur → le nom n'apparaît
  // qu'une seule fois (fini le doublon) et le grand secteur est visible d'un coup d'œil.
  const typeLabel = typeConfig?.label || eventInfo.event.title;

  return (
    <div className={`px-1 py-0.5 overflow-hidden ${isCancelled ? 'opacity-50 line-through' : ''}`}>
      <div className="font-medium text-xs truncate flex items-center gap-1">
        {/* Souplesse : ↔ adaptable (heure provisoire), 🔒 heure communiquée au client */}
        {adaptable ? (
          <span className="mr-0.5 opacity-90" title="Adaptable : l’heure peut glisser dans sa tolérance">↔</span>
        ) : (typeSouple && hour_confirmed_at) ? (
          <span className="mr-0.5 opacity-90" title="Heure communiquée au client">🔒</span>
        ) : null}
        {/* Pose provisoire : appros du chantier non reçues (bloc hachuré) */}
        {provisoire && (
          <span className="mr-0.5 opacity-90" title="Pose provisoire : appros du chantier non reçues">⏳</span>
        )}
        {/* Vues liste : l'heure a déjà sa colonne */}
        {eventInfo.timeText && !eventInfo.view.type.startsWith('list') && (
          <span className="mr-1">{eventInfo.timeText}</span>
        )}
        {typeLabel}
        <EquipmentKindIcons clientId={client_id} size="xs" />
      </div>
      {(fullName || grand_secteur) && eventInfo.view.type !== 'dayGridMonth' && (
        <div className="text-xs truncate opacity-80">
          {fullName}
          {grand_secteur && <span className="opacity-90"> · Secteur {grand_secteur}</span>}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function Planning() {
  const { organization, user, effectiveRole } = useAuth();
  const { can } = useCanAccess();
  const orgId = organization?.id;
  const calendarRef = useRef(null);
  const canCreateAppointment = can('planning', 'create');
  // Sur appareil tenu en main (tablette, téléphone) : la journée, pas la semaine.
  // Téléphone / tablette : la journée en liste (cf. VUES_MOBILE).
  const { isMobileDevice } = useDeviceClass();
  const vueInitiale = isMobileDevice ? 'listDay' : 'timeGridWeek';

  // État local
  const [currentView, setCurrentView] = useState(vueInitiale);
  const [calendarTitle, setCalendarTitle] = useState('');
  const [calendarWeek, setCalendarWeek] = useState(null);
  const [dateRange, setDateRange] = useState(() => getDateRange(null));
  const [modalState, setModalState] = useState({ open: false, mode: 'create', appointment: null, defaultDate: null, defaultTime: null });
  const [selectedChantier, setSelectedChantier] = useState(null);
  const [loadingChantier, setLoadingChantier] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  // RDV du client recherché (surlignés dans le calendrier) — null = pas de recherche
  const [searchHitIds, setSearchHitIds] = useState(null);

  // État de chaque journée de technicien (vide / ouverte / pleine / figée / à
  // arbitrer) pour la plage visible — puces sous l'en-tête du jour. `orgId` du
  // Planning = org CORE, c'est bien le coreOrgId attendu par le hook.
  const {
    etats: etatsJournees, journees: journeesHorizon, isLoading: etatsLoading, error: etatsError,
  } = useEtatsJournees({ coreOrgId: orgId, startDate: dateRange.startDate, endDate: dateRange.endDate });

  // Journée ouverte dans le panneau de remplissage : clic sur une puce, ou lien
  // direct depuis le tableau de bord des entretiens (/planning?journee=&tech=,
  // cf. lienJourneePlanning). On garde la CLÉ, pas l'objet : la journée affichée
  // est dérivée en direct de l'horizon, pour qu'un nouvel essai après une pose
  // voie la charge à jour et non l'état capturé au clic.
  const [searchParams, setSearchParams] = useSearchParams();
  const [journeeOuverte, setJourneeOuverte] = useState(() => {
    const date = searchParams.get('journee');
    const technicienId = searchParams.get('tech');
    return date && technicienId ? { date, technicienId } : null;
  });
  const [dateInitiale] = useState(() => searchParams.get('journee') || undefined);
  // Technicien hors tournées (puce « À la main ») : pas de remplissage, sa feuille de route seule.
  const [feuilleOuverte, setFeuilleOuverte] = useState(null);
  const ouvrirJournee = useCallback((item) => {
    if (item.etat === 'manuelle') {
      setFeuilleOuverte(item);
      return;
    }
    setJourneeOuverte({ date: item.date, technicienId: item.technicienId });
  }, []);
  const fermerJournee = useCallback(() => {
    setJourneeOuverte(null);
    // Le lien direct a servi : sans ce nettoyage, un rechargement rouvrirait le panneau.
    if (searchParams.has('journee') || searchParams.has('tech')) {
      const next = new URLSearchParams(searchParams);
      next.delete('journee');
      next.delete('tech');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const journeeSelectionnee = useMemo(() => {
    if (!journeeOuverte || !journeesHorizon) return null;
    return journeesHorizon.find(
      (j) => j.date === journeeOuverte.date && j.technicienId === journeeOuverte.technicienId,
    ) || null;
  }, [journeeOuverte, journeesHorizon]);
  // Journée demandée mais absente de l'horizon chargé (jour passé, non travaillé,
  // technicien planifié « à la main ») : on le dit, plutôt qu'un lien qui n'ouvre
  // rien. Tant que la plage visible ne couvre pas la date, on attend son chargement.
  useEffect(() => {
    if (!journeeOuverte || journeeSelectionnee) return;
    if (etatsError) {
      toast.error(`Journée indisponible — chargement des tournées en échec (${etatsError.message || 'échec inconnu'})`);
      fermerJournee();
      return;
    }
    if (etatsLoading || !journeesHorizon || journeeOuverte.date >= dateRange.endDate) return;
    toast.info('Cette journée n’est pas planifiée par la machine (jour passé, non travaillé, ou technicien planifié à la main).');
    fermerJournee();
  }, [journeeOuverte, journeeSelectionnee, etatsError, etatsLoading, journeesHorizon, dateRange.endDate, fermerJournee]);

  // Hooks données
  const {
    events,
    isLoading,
    error,
    filters,
    setFilters,
    teamList,
    createAppointment,
    updateAppointment,
    moveAppointment,
    cancelAppointment,
    deleteAppointment,
    isCreating,
    isUpdating,
    refresh,
  } = useAppointments({
    orgId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const { members } = useTeamMembers(orgId);
  const { labelsByClientId } = useClientEquipmentLabels();
  const { settings: orgSettings } = useOrgSettings();

  // Sur appareil tenu en main : ouvrir sur SON planning (profileKey = user.id,
  // clé d'unification de teamList). Appliqué une seule fois, dès que l'équipe
  // est connue ; un admin sans ressource planning garde la vue globale, et
  // « Effacer » reste possible : c'est un défaut, pas un verrou.
  const defautPersonneApplique = useRef(false);
  useEffect(() => {
    if (defautPersonneApplique.current || !isMobileDevice || !user?.id || teamList.length === 0) return;
    defautPersonneApplique.current = true;
    if (teamList.some((h) => h.profileKey === user.id)) {
      setFilters((f) => ({ ...f, memberProfileKeys: [user.id] }));
    }
  }, [isMobileDevice, user?.id, teamList, setFilters]);

  // ==========================================================================
  // PUCES D'EN-TÊTE — état de journée des personnes affichées
  // ==========================================================================

  // Ids (team_members / commercials) des personnes filtrées ; null = toute l'équipe.
  const recordIdsFiltres = useMemo(() => {
    const keys = filters.memberProfileKeys || [];
    if (keys.length === 0) return null;
    const set = new Set(keys);
    return new Set(teamList.filter((h) => set.has(h.profileKey)).flatMap((h) => h.recordIds));
  }, [filters.memberProfileKeys, teamList]);

  // Puces du moteur restreintes au filtre équipe, + une puce « À la main » par
  // technicien HORS tournées (`include_in_routing = false`) qui a des RDV ce
  // jour-là : la machine ne le planifie pas, mais sa journée existe et sa
  // feuille de route aussi. Sans elle, il n'avait aucune puce (Mohammed, 2026-10-14).
  const etatsAffiches = useMemo(() => {
    const map = new Map();
    for (const [cle, item] of etatsJournees) {
      if (!recordIdsFiltres || recordIdsFiltres.has(item.technicienId)) map.set(cle, item);
    }
    const horsTournees = new Map((members || [])
      .filter((m) => m.role === 'technician' && m.include_in_routing !== true)
      .map((m) => [m.id, m]));
    if (horsTournees.size === 0) return map;
    const parJournee = new Map();
    for (const e of events) {
      const a = e.extendedProps;
      if (!a?.scheduled_date || a.band) continue;
      for (const techId of a.technician_ids || []) {
        const m = horsTournees.get(techId);
        if (!m || (recordIdsFiltres && !recordIdsFiltres.has(techId))) continue;
        const cle = `${a.scheduled_date}|${techId}`;
        if (map.has(cle)) continue;
        if (!parJournee.has(cle)) parJournee.set(cle, { date: a.scheduled_date, member: m, rdvs: new Map() });
        parJournee.get(cle).rdvs.set(a.id, a.appointment_type);
      }
    }
    for (const [cle, { date, member, rdvs }] of parJournee) {
      map.set(cle, {
        date,
        technicienId: member.id,
        technicienNom: String(member.display_name || '').trim(),
        couleur: member.calendar_color,
        etat: 'manuelle',
        nbRdvs: rdvs.size,
        enConges: [...rdvs.values()].every((t) => t === 'leave'),
      });
    }
    return map;
  }, [etatsJournees, recordIdsFiltres, members, events]);

  const dayHeaderContent = useCallback((arg) => {
    const date = arg.date.toLocaleDateString('fr-CA');
    return (
      <div className="flex flex-col items-start">
        <span>{arg.text}</span>
        {arg.view.type !== 'dayGridMonth' && (
          <JourneeEtatChips date={date} etats={etatsAffiches} onOpen={ouvrirJournee} />
        )}
      </div>
    );
  }, [etatsAffiches, ouvrirJournee]);

  // ==========================================================================
  // IMPRESSION — UNE personne (1 chip équipe) : planning hebdo en vue Semaine,
  // feuille de route (interventions + itinéraire) en vue Jour
  // ==========================================================================

  const printPerson = filters.memberProfileKeys?.length === 1
    ? teamList.find((h) => h.profileKey === filters.memberProfileKeys[0])
    : null;
  // Les vues liste (appareils mobiles) impriment comme leur équivalent grille.
  const isDayView = currentView === 'timeGridDay' || currentView === 'listDay';
  const isWeekView = currentView === 'timeGridWeek' || currentView === 'listWeek';
  const printHint = !isWeekView && !isDayView
    ? 'Passez en vue Semaine ou Jour pour imprimer'
    : !printPerson
      ? 'Sélectionnez une seule personne dans les filtres équipe'
      : null;
  const printLabel = isDayView
    ? 'Imprimer la feuille de route du jour (PDF)'
    : 'Imprimer le planning de la semaine (PDF)';

  // Même modèle que le panneau journée : l'impression ne recalcule rien.
  const feuilleImpression = useFeuilleDeRoute({
    orgId,
    date: isDayView && printPerson ? dateRange.startDate : null,
    memberIds: printPerson?.recordIds || [],
    person: printPerson,
  });

  const handlePrint = useCallback(async () => {
    if (!printPerson || !dateRange.startDate) return;
    if (isDayView) {
      if (!feuilleImpression.feuille || feuilleImpression.isLoading) {
        toast.info('Feuille de route en cours de calcul, réessayez dans un instant.');
        return;
      }
      setIsPrinting(true);
      try {
        await telechargerFeuilleDeRoute({
          feuille: feuilleImpression.feuille, carteUrl: feuilleImpression.carteUrl, settings: orgSettings,
        });
      } catch (err) {
        toast.error(`Impression impossible : ${err?.message || 'erreur inconnue'}`);
      } finally {
        setIsPrinting(false);
      }
      return;
    }
    setIsPrinting(true);
    try {
      // events = blocs calendrier déjà filtrés sur la personne ; le modèle
      // déduplique par id (RDV multi-tech éclaté en plusieurs blocs).
      await telechargerPlanningHebdo({
        appointments: events.map((e) => e.extendedProps),
        person: printPerson,
        weekStart: dateRange.startDate,
        equipmentLabelsByClient: labelsByClientId,
        settings: orgSettings,
      });
    } catch (err) {
      toast.error(`Impression impossible : ${err?.message || 'erreur inconnue'}`);
    } finally {
      setIsPrinting(false);
    }
  }, [printPerson, dateRange.startDate, isDayView, feuilleImpression, events, labelsByClientId, orgSettings]);

  // ==========================================================================
  // HANDLERS FULLCALENDAR
  // ==========================================================================

  // Quand la vue ou les dates changent
  const handleDatesSet = useCallback((dateInfo) => {
    setCalendarTitle(dateInfo.view.title);
    setCurrentView(dateInfo.view.type);
    setDateRange(getDateRange(dateInfo));
    // Numéro de semaine ISO — pertinent uniquement sur les vues à 1 semaine
    const viewType = dateInfo.view.type;
    setCalendarWeek(
      ['timeGridWeek', 'timeGridDay', 'listWeek', 'listDay'].includes(viewType)
        ? isoWeekNumber(dateInfo.start)
        : null
    );
  }, []);

  // Recherche client : clic sur un RDV → le calendrier va à sa date
  const handlePickSearchedAppointment = useCallback((appt) => {
    calendarRef.current?.getApi().gotoDate(appt.scheduled_date);
  }, []);

  const eventClassNames = useCallback(
    (arg) => (searchHitIds?.has(arg.event.extendedProps.id) ? ['mdh-search-hit'] : []),
    [searchHitIds]
  );

  // Changer de vue
  const handleViewChange = useCallback((viewName) => {
    calendarRef.current?.getApi().changeView(viewName);
    setCurrentView(viewName);
  }, []);

  // Clic sur un créneau vide → créer un RDV
  const handleDateSelect = useCallback((selectInfo) => {
    const startDate = selectInfo.start;
    setModalState({
      open: true,
      mode: 'create',
      appointment: null,
      // Date LOCALE : toISOString() passe en UTC et recule d'un jour une sélection
      // « journée entière » (minuit local = veille 22h UTC).
      defaultDate: formatDateForInput(startDate),
      defaultTime: selectInfo.allDay ? '09:00' : `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`,
    });
    calendarRef.current?.getApi().unselect();
  }, []);

  // Clic sur un événement → éditer (RDV) OU ouvrir chantier (slot chantier Phase 0)
  const handleEventClick = useCallback(async (clickInfo) => {
    const props = clickInfo.event.extendedProps;

    // Slot chantier : fetch + ouvrir ChantierModal
    if (props.appointment_kind === 'chantier_slot') {
      if (!props.parent_lead_id) {
        toast.error('Chantier introuvable');
        return;
      }
      setLoadingChantier(true);
      try {
        const { data, error } = await supabase
          .from('majordhome_chantiers')
          .select('*')
          .eq('id', props.parent_lead_id)
          .single();
        if (error || !data) {
          toast.error('Impossible de charger le chantier');
          return;
        }
        setSelectedChantier(data);
      } finally {
        setLoadingChantier(false);
      }
      return;
    }

    // RDV classique : EventModal existante
    setModalState({
      open: true,
      mode: 'edit',
      appointment: props,
      defaultDate: null,
      defaultTime: null,
    });
  }, []);

  // Drag & drop d'un événement
  const handleEventDrop = useCallback(async (dropInfo) => {
    const { event } = dropInfo;
    const appointmentId = event.extendedProps.id || event.id;

    try {
      const start = event.start;
      const end = event.end || new Date(start.getTime() + 60 * 60000);
      const pad = (n) => String(n).padStart(2, '0');

      await moveAppointment(appointmentId, {
        scheduled_date: start.toISOString().split('T')[0],
        scheduled_start: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
        scheduled_end: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
        duration_minutes: Math.round((end - start) / 60000),
      });
      toast.success('RDV déplacé');
    } catch (err) {
      logger.error('[Planning] moveAppointment error:', err);
      dropInfo.revert();
      toast.error('Erreur lors du déplacement');
    }
  }, [moveAppointment]);

  // Resize d'un événement
  const handleEventResize = useCallback(async (resizeInfo) => {
    const { event } = resizeInfo;
    const appointmentId = event.extendedProps.id || event.id;

    try {
      const start = event.start;
      const end = event.end;
      const pad = (n) => String(n).padStart(2, '0');

      await moveAppointment(appointmentId, {
        scheduled_date: start.toISOString().split('T')[0],
        scheduled_start: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
        scheduled_end: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
        duration_minutes: Math.round((end - start) / 60000),
      });
    } catch (err) {
      logger.error('[Planning] resize error:', err);
      resizeInfo.revert();
      toast.error('Erreur lors du redimensionnement');
    }
  }, [moveAppointment]);

  // ==========================================================================
  // HANDLERS MODAL
  // ==========================================================================

  const handleModalClose = useCallback(() => {
    setModalState({ open: false, mode: 'create', appointment: null, defaultDate: null, defaultTime: null });
  }, []);

  const handleModalSave = useCallback(async (formData) => {
    const isCreate = modalState.mode === 'create';
    try {
      if (isCreate) {
        await createAppointment(formData);
        toast.success('RDV créé avec succès');
      } else {
        await updateAppointment(modalState.appointment.id, formData);
        toast.success('RDV modifié avec succès');
      }
      handleModalClose();
      return true;
    } catch (err) {
      logger.error('[Planning] save appointment error:', err);
      toast.error(isCreate ? 'Erreur lors de la création du RDV' : 'Erreur lors de la modification du RDV');
      return false;
    }
  }, [modalState, createAppointment, updateAppointment, handleModalClose]);

  const handleModalDelete = useCallback(async () => {
    if (!modalState.appointment?.id) return;
    try {
      await deleteAppointment(modalState.appointment.id);
      toast.success('RDV supprimé');
      handleModalClose();
    } catch (err) {
      logger.error('[Planning] deleteAppointment error:', err);
      toast.error('Erreur lors de la suppression');
    }
  }, [modalState, deleteAppointment, handleModalClose]);

  const handleModalCancel = useCallback(async (reason) => {
    if (!modalState.appointment?.id) return;
    try {
      await cancelAppointment(modalState.appointment.id, reason);
      toast.success('RDV annulé');
      handleModalClose();
    } catch (err) {
      logger.error('[Planning] cancelAppointment error:', err);
      toast.error('Erreur lors de l\'annulation');
    }
  }, [modalState, cancelAppointment, handleModalClose]);

  // ==========================================================================
  // RENDU
  // ==========================================================================

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Planning</h1>
          <p className="text-gray-500">Gérez vos rendez-vous et interventions</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Erreur de chargement</h3>
          <p className="text-gray-500 mb-4">{error?.message || 'Impossible de charger le planning'}</p>
          <button onClick={refresh} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <RefreshCw className="w-4 h-4 inline mr-2" />
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header — le sous-titre ne dit rien que la page ne montre : masqué sur téléphone */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Planning</h1>
        <p className="hidden sm:block text-gray-500">Gérez vos rendez-vous et interventions</p>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 space-y-3">
        <CalendarToolbar
          calendarRef={calendarRef}
          currentView={currentView}
          onViewChange={handleViewChange}
          title={calendarTitle}
          weekNumber={calendarWeek}
          onAddEvent={canCreateAppointment ? () => setModalState({ open: true, mode: 'create', appointment: null, defaultDate: new Date().toISOString().split('T')[0], defaultTime: '09:00' }) : null}
          onRefresh={refresh}
          isLoading={isLoading}
          onPrint={handlePrint}
          printHint={printHint}
          printLabel={printLabel}
          isPrinting={isPrinting}
          isMobileDevice={isMobileDevice}
        />
        <CalendarFilters
          filters={filters}
          setFilters={setFilters}
          teamList={teamList}
        />
        <PlanningClientSearch
          orgId={orgId}
          teamList={teamList}
          onPickAppointment={handlePickSearchedAppointment}
          onResultsChange={setSearchHitIds}
        />
      </div>

      {/* Calendrier */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {isLoading && events.length === 0 && (
          <div className="flex items-center justify-center py-4 border-b border-gray-200 bg-blue-50">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500 mr-2" />
            <span className="text-sm text-blue-600">Chargement du planning...</span>
          </div>
        )}

        <div className="fc-wrapper">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView={vueInitiale}
            initialDate={dateInitiale}
            locale="fr"
            headerToolbar={false}
            height="auto"
            contentHeight={650}
            // Dates et heures
            firstDay={1}
            weekends={false}
            slotMinTime="07:00:00"
            slotMaxTime="20:00:00"
            slotDuration="00:30:00"
            slotLabelInterval="01:00:00"
            slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            // Événements
            events={events}
            eventContent={(eventInfo) => <PlanningEventContent eventInfo={eventInfo} />}
            eventClassNames={eventClassNames}
            // Interactions
            editable={canCreateAppointment}
            selectable={canCreateAppointment}
            selectMirror={canCreateAppointment}
            dayMaxEvents={true}
            nowIndicator={true}
            // Callbacks
            datesSet={handleDatesSet}
            select={handleDateSelect}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            // Style
            eventDisplay="block"
            // RDV concurrents (2 techniciens) côte à côte sans se recouvrir
            slotEventOverlap={false}
            dayHeaderFormat={{ weekday: 'short', day: 'numeric', month: 'short' }}
            // Vues liste (téléphone) : « lundi 26 octobre » sur toute la largeur
            listDayFormat={{ weekday: 'long', day: 'numeric', month: 'long' }}
            listDaySideFormat={false}
            dayHeaderContent={dayHeaderContent}
            allDaySlot={false}
            expandRows={true}
            stickyHeaderDates={true}
            // Texte français
            buttonText={{
              today: "Aujourd'hui",
              month: 'Mois',
              week: 'Semaine',
              day: 'Jour',
            }}
            noEventsText="Aucun événement"
          />
        </div>
      </div>

      {/* Modale événement */}
      <EventModal
        isOpen={modalState.open}
        mode={modalState.mode}
        appointment={modalState.appointment}
        defaultDate={modalState.defaultDate}
        defaultTime={modalState.defaultTime}
        members={members}
        orgId={orgId}
        userId={user?.id}
        onClose={handleModalClose}
        onSave={handleModalSave}
        onDelete={handleModalDelete}
        onCancel={handleModalCancel}
        isSaving={isCreating || isUpdating}
      />

      {/* Remplir / figer une journée de technicien — clic sur sa puce d'état.
          Seule porte de programmation au fil de l'eau (spec auto-RDV § 5). */}
      {journeeSelectionnee && (
        <RemplirJourneePanel
          journee={journeeSelectionnee}
          etat={etatsJournees.get(`${journeeSelectionnee.date}|${journeeSelectionnee.technicienId}`)}
          onClose={fermerJournee}
        />
      )}

      {/* Feuille de route d'un technicien hors tournées — clic sur sa puce « À la main » */}
      {feuilleOuverte && (
        <FeuilleDeRoutePanel journee={feuilleOuverte} onClose={() => setFeuilleOuverte(null)} />
      )}

      {/* Modale Chantier — clic sur slot chantier (Phase 0) */}
      {selectedChantier && (
        <ChantierModal
          chantier={selectedChantier}
          onClose={() => setSelectedChantier(null)}
          onUpdated={() => {
            refresh();
            if (selectedChantier?.id) {
              supabase
                .from('majordhome_chantiers')
                .select('*')
                .eq('id', selectedChantier.id)
                .single()
                .then(({ data }) => data && setSelectedChantier(data));
            }
          }}
          effectiveRole={effectiveRole}
          canEditAll={can('chantiers', 'update')}
        />
      )}

      {/* Loader pendant fetch du chantier */}
      {loadingChantier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 pointer-events-none">
          <div className="bg-white rounded-lg shadow-xl px-6 py-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            <span className="text-sm text-gray-700">Chargement du chantier…</span>
          </div>
        </div>
      )}
    </div>
  );
}
