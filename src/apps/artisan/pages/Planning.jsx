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

import { useState, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import {
  Plus,
  Filter,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Users,
  Loader2,
  AlertCircle,
  RefreshCw,
  X,
  CheckCircle2,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAppointments, useTeamMembers } from '@/shared/hooks/useAppointments';
import { APPOINTMENT_TYPES, getAppointmentTypeConfig } from '@/shared/services/appointments.service';
import { EventModal } from '@/apps/artisan/components/planning/EventModal';

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
  onAddEvent,
  onRefresh,
  isLoading
}) {
  const goToday = () => calendarRef.current?.getApi().today();
  const goPrev = () => calendarRef.current?.getApi().prev();
  const goNext = () => calendarRef.current?.getApi().next();

  const views = [
    { value: 'timeGridDay', label: 'Jour' },
    { value: 'timeGridWeek', label: 'Semaine' },
    { value: 'dayGridMonth', label: 'Mois' },
  ];

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      {/* Navigation dates */}
      <div className="flex items-center gap-2">
        <button
          onClick={goToday}
          className="px-3 py-1.5 text-sm font-medium bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Aujourd'hui
        </button>
        <div className="flex items-center">
          <button
            onClick={goPrev}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={goNext}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 min-w-[200px]">
          {title}
        </h2>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
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
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Rafraîchir"
        >
          <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>

        <button
          onClick={onAddEvent}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Nouveau RDV
        </button>
      </div>
    </div>
  );
}

/**
 * Filtres technicien + type
 */
function CalendarFilters({ filters, setFilters, members, isLoadingMembers }) {
  const [showTechDropdown, setShowTechDropdown] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);

  const selectedTech = members.find(m => m.id === filters.technicianId);
  const selectedType = APPOINTMENT_TYPES.find(t => t.value === filters.appointmentType);
  const hasFilters = filters.technicianId || filters.appointmentType;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Filtre technicien */}
      <div className="relative">
        <button
          onClick={() => setShowTechDropdown(!showTechDropdown)}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
            filters.technicianId
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Users className="w-4 h-4" />
          {selectedTech ? selectedTech.display_name : 'Technicien'}
          <ChevronDown className={`w-3 h-3 transition-transform ${showTechDropdown ? 'rotate-180' : ''}`} />
        </button>
        {showTechDropdown && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowTechDropdown(false)} />
            <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
              <button
                onClick={() => { setFilters(f => ({ ...f, technicianId: null })); setShowTechDropdown(false); }}
                className={`w-full flex items-center px-3 py-2 text-sm text-left ${!filters.technicianId ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                Tous les techniciens
              </button>
              {members.map(member => (
                <button
                  key={member.id}
                  onClick={() => { setFilters(f => ({ ...f, technicianId: member.id })); setShowTechDropdown(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
                    filters.technicianId === member.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: member.calendar_color || '#6B7280' }}
                  />
                  {member.display_name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

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
          onClick={() => setFilters({ technicianId: null, appointmentType: null, status: null })}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          Effacer
        </button>
      )}
    </div>
  );
}

/**
 * Rendu custom d'un événement dans le calendrier
 */
function renderEventContent(eventInfo) {
  const { appointment_type, client_name, client_first_name, status, lead_id } = eventInfo.event.extendedProps;
  const isCancelled = status === 'cancelled';
  const fullName = [client_name, client_first_name].filter(Boolean).join(' ');

  return (
    <div className={`px-1 py-0.5 overflow-hidden ${isCancelled ? 'opacity-50 line-through' : ''}`}>
      <div className="font-medium text-xs truncate flex items-center gap-1">
        {lead_id && (
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 bg-white/30 rounded-full text-[8px] font-bold shrink-0" title="Depuis pipeline">
            P
          </span>
        )}
        {eventInfo.timeText && (
          <span className="mr-1">{eventInfo.timeText}</span>
        )}
        {eventInfo.event.title}
      </div>
      {fullName && eventInfo.view.type !== 'dayGridMonth' && (
        <div className="text-xs truncate opacity-80">
          {fullName}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function Planning() {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const calendarRef = useRef(null);

  // État local
  const [currentView, setCurrentView] = useState('timeGridWeek');
  const [calendarTitle, setCalendarTitle] = useState('');
  const [dateRange, setDateRange] = useState(() => getDateRange(null));
  const [modalState, setModalState] = useState({ open: false, mode: 'create', appointment: null, defaultDate: null, defaultTime: null });

  // Hooks données
  const {
    events,
    isLoading,
    error,
    filters,
    setFilters,
    createAppointment,
    updateAppointment,
    moveAppointment,
    cancelAppointment,
    deleteAppointment,
    isCreating,
    isUpdating,
    isMoving,
    refresh,
  } = useAppointments({
    orgId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const { members, isLoading: isLoadingMembers } = useTeamMembers(orgId);

  // ==========================================================================
  // HANDLERS FULLCALENDAR
  // ==========================================================================

  // Quand la vue ou les dates changent
  const handleDatesSet = useCallback((dateInfo) => {
    setCalendarTitle(dateInfo.view.title);
    setCurrentView(dateInfo.view.type);
    setDateRange(getDateRange(dateInfo));
  }, []);

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
      defaultDate: startDate.toISOString().split('T')[0],
      defaultTime: selectInfo.allDay ? '09:00' : `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`,
    });
    calendarRef.current?.getApi().unselect();
  }, []);

  // Clic sur un événement → éditer
  const handleEventClick = useCallback((clickInfo) => {
    setModalState({
      open: true,
      mode: 'edit',
      appointment: clickInfo.event.extendedProps,
      defaultDate: null,
      defaultTime: null,
    });
  }, []);

  // Drag & drop d'un événement
  const handleEventDrop = useCallback(async (dropInfo) => {
    const { event } = dropInfo;
    const appointmentId = event.id;

    try {
      const start = event.start;
      const end = event.end || new Date(start.getTime() + 60 * 60000);
      const pad = (n) => String(n).padStart(2, '0');

      const result = await moveAppointment(appointmentId, {
        scheduled_date: start.toISOString().split('T')[0],
        scheduled_start: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
        scheduled_end: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
        duration_minutes: Math.round((end - start) / 60000),
      });

      if (result?.error) {
        dropInfo.revert();
        toast.error('Erreur lors du déplacement');
      } else {
        toast.success('RDV déplacé');
      }
    } catch {
      dropInfo.revert();
      toast.error('Erreur lors du déplacement');
    }
  }, [moveAppointment]);

  // Resize d'un événement
  const handleEventResize = useCallback(async (resizeInfo) => {
    const { event } = resizeInfo;
    const appointmentId = event.id;

    try {
      const start = event.start;
      const end = event.end;
      const pad = (n) => String(n).padStart(2, '0');

      const result = await moveAppointment(appointmentId, {
        scheduled_date: start.toISOString().split('T')[0],
        scheduled_start: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
        scheduled_end: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
        duration_minutes: Math.round((end - start) / 60000),
      });

      if (result?.error) {
        resizeInfo.revert();
        toast.error('Erreur lors du redimensionnement');
      }
    } catch {
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
    try {
      if (modalState.mode === 'create') {
        const result = await createAppointment(formData);
        if (result?.error) {
          toast.error('Erreur lors de la création du RDV');
          return false;
        }
        toast.success('RDV créé avec succès');
      } else {
        const result = await updateAppointment(modalState.appointment.id, formData);
        if (result?.error) {
          toast.error('Erreur lors de la modification du RDV');
          return false;
        }
        toast.success('RDV modifié avec succès');
      }
      handleModalClose();
      return true;
    } catch {
      toast.error('Une erreur est survenue');
      return false;
    }
  }, [modalState, createAppointment, updateAppointment, handleModalClose]);

  const handleModalDelete = useCallback(async () => {
    if (!modalState.appointment?.id) return;
    try {
      const result = await deleteAppointment(modalState.appointment.id);
      if (result?.error) {
        toast.error('Erreur lors de la suppression');
        return;
      }
      toast.success('RDV supprimé');
      handleModalClose();
    } catch {
      toast.error('Erreur lors de la suppression');
    }
  }, [modalState, deleteAppointment, handleModalClose]);

  const handleModalCancel = useCallback(async (reason) => {
    if (!modalState.appointment?.id) return;
    try {
      const result = await cancelAppointment(modalState.appointment.id, reason);
      if (result?.error) {
        toast.error('Erreur lors de l\'annulation');
        return;
      }
      toast.success('RDV annulé');
      handleModalClose();
    } catch {
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
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Planning</h1>
        <p className="text-gray-500">Gérez vos rendez-vous et interventions</p>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <CalendarToolbar
          calendarRef={calendarRef}
          currentView={currentView}
          onViewChange={handleViewChange}
          title={calendarTitle}
          onAddEvent={() => setModalState({ open: true, mode: 'create', appointment: null, defaultDate: new Date().toISOString().split('T')[0], defaultTime: '09:00' })}
          onRefresh={refresh}
          isLoading={isLoading}
        />
        <CalendarFilters
          filters={filters}
          setFilters={setFilters}
          members={members}
          isLoadingMembers={isLoadingMembers}
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
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            locale="fr"
            headerToolbar={false}
            height="auto"
            contentHeight={650}
            // Dates et heures
            firstDay={1}
            slotMinTime="07:00:00"
            slotMaxTime="20:00:00"
            slotDuration="00:30:00"
            slotLabelInterval="01:00:00"
            slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            // Événements
            events={events}
            eventContent={renderEventContent}
            // Interactions
            editable={true}
            selectable={true}
            selectMirror={true}
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
            dayHeaderFormat={{ weekday: 'short', day: 'numeric', month: 'short' }}
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
    </div>
  );
}
