/**
 * Planning.jsx - Majord'home Artisan
 * ============================================================================
 * Page planning avec calendrier FullCalendar interactif.
 * Vues : semaine, jour, mois. Drag & drop + resize.
 *
 * La page assemble ; chaque sujet a son fichier :
 *   - barre du haut ........ components/planning/CalendarToolbar.jsx
 *   - filtres en entonnoir . components/planning/CalendarFilters.jsx (règles : lib/planningEvents.js)
 *   - vignette d'un RDV .... components/planning/PlanningEventContent.jsx (règles : lib/planningVignette.js)
 *   - charge et CA du jour . hooks/usePlanningCharge.js + components/planning/PlanningDayHeader.jsx
 *                            (règles : lib/planningCharge.js, lib/planningCa.js)
 * Une nouvelle règle va dans le module pur concerné, avec son test — pas ici.
 *
 * @version 2.0.0 - Sprint 2 : FullCalendar + CRUD RDV
 * ============================================================================
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useAppointments, useTeamMembers } from '@hooks/useAppointments';
import { usePlanningCharge } from '@hooks/usePlanningCharge';
import { useClientEquipmentLabels } from '@hooks/useClients';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useDeviceClass } from '@hooks/useDeviceClass';
import { isoWeekNumber } from '@/lib/planningPrintModel';
import { telechargerPlanningHebdo } from '@/apps/artisan/components/planning/planningPrintExport';
import { telechargerFeuilleDeRoute } from '@/apps/artisan/components/planning/feuilleDeRouteExport';
import { FeuilleDeRoutePanel } from '@/apps/artisan/components/planning/FeuilleDeRoutePanel';
import { useFeuilleDeRoute } from '@hooks/useFeuilleDeRoute';
import { EventModal } from '@/apps/artisan/components/planning/EventModal';
import { CalendarToolbar } from '@/apps/artisan/components/planning/CalendarToolbar';
import { CalendarFilters } from '@/apps/artisan/components/planning/CalendarFilters';
import { PlanningClientSearchInput, PlanningClientAppointments } from '@/apps/artisan/components/planning/PlanningClientSearch';
import { PlanningEventContent } from '@/apps/artisan/components/planning/PlanningEventContent';
import { PlanningDayHeader } from '@/apps/artisan/components/planning/PlanningDayHeader';
import { RemplirJourneePanel } from '@/apps/artisan/components/tournees/RemplirJourneePanel';
import { ChantierModal } from '@/apps/artisan/components/chantiers/ChantierModal';
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
  return {
    startDate: dateInfo.startStr?.split('T')[0] || dateInfo.start?.toISOString().split('T')[0],
    endDate: dateInfo.endStr?.split('T')[0] || dateInfo.end?.toISOString().split('T')[0],
  };
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
  // Charge par technicien (puces d'état) et CA programmé : pilotage, pas terrain
  // (Eric, 2026-11-14) — admin d'organisation et team leader, jamais le technicien.
  const voitCharge = effectiveRole === 'org_admin' || effectiveRole === 'team_leader';
  // Sur appareil tenu en main (tablette, téléphone) : la journée, pas la semaine.
  // Téléphone / tablette : la journée en liste (cf. VUES_MOBILE).
  const { isMobileDevice } = useDeviceClass();
  const vueInitiale = isMobileDevice ? 'listDay' : 'timeGridWeek';

  // État local
  const [currentView, setCurrentView] = useState(vueInitiale);
  const [calendarTitle, setCalendarTitle] = useState('');
  const [calendarWeek, setCalendarWeek] = useState(null);
  // Plage affichée, inconnue tant que le calendrier ne l'a pas annoncée (datesSet,
  // dès son montage) : rien ne se charge avant. L'ancien défaut (± 1 mois « pour
  // précharger ») lançait trois mois de RDV, leurs techniciens et leurs chantiers
  // sous une clé de cache que la semaine affichée ne réutilisait jamais.
  const [dateRange, setDateRange] = useState({ startDate: null, endDate: null });
  // Période que le titre annonce (≠ dateRange en vue Mois : la grille déborde) — cumul du CA.
  const [periode, setPeriode] = useState(null);
  const [modalState, setModalState] = useState({ open: false, mode: 'create', appointment: null, defaultDate: null, defaultTime: null });
  const [selectedChantier, setSelectedChantier] = useState(null);
  const [loadingChantier, setLoadingChantier] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  // Client recherché depuis la barre d'outils (ses RDV s'affichent sous les filtres)
  const [searchedClient, setSearchedClient] = useState(null);
  // RDV du client recherché (surlignés dans le calendrier) — null = pas de recherche
  const [searchHitIds, setSearchHitIds] = useState(null);

  // Hooks données
  const {
    appointments,
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

  // Charge de la plage visible : état de chaque journée de technicien, lignes sous
  // l'en-tête du jour, CA HT programmé (règles : src/lib/planningCharge.js et
  // planningCa.js). `orgId` du Planning = org CORE, attendue par le moteur de tournées.
  const {
    recordIdsFiltres, etatsJournees, journeesHorizon, etatsLoading, etatsError,
    lignes: lignesCharge, ca: caPlanning, caError, caCumul,
  } = usePlanningCharge({
    orgId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    periode,
    appointments,
    members,
    teamList,
    memberProfileKeys: filters.memberProfileKeys,
    // RDV en cours de chargement, ou restreints par un filtre de type ou de statut :
    // la charge est partielle, on ne dit pas qu'une journée est vide.
    rdvsPartiels: isLoading || !!(filters.appointmentType || filters.status),
    voitCharge,
  });

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
    // Journée que le moteur ne juge pas (hors tournées, jour passé) : la feuille de route seule.
    if (item.etat === 'manuelle' || item.etat === 'sans_etat') {
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
    if (etatsLoading || !journeesHorizon || !dateRange.endDate || journeeOuverte.date >= dateRange.endDate) return;
    toast.info('Cette journée n’est pas planifiée par la machine (jour passé, non travaillé, ou technicien planifié à la main).');
    fermerJournee();
  }, [journeeOuverte, journeeSelectionnee, etatsError, etatsLoading, journeesHorizon, dateRange.endDate, fermerJournee]);

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

  // En-tête d'un jour : charge par technicien et chiffre, pour l'admin d'organisation
  // et le team leader seulement (jamais en vue Mois).
  const dayHeaderContent = useCallback((arg) => {
    if (!voitCharge || arg.view.type === 'dayGridMonth') return <span>{arg.text}</span>;
    return (
      <PlanningDayHeader
        texte={arg.text}
        date={arg.date.toLocaleDateString('fr-CA')}
        lignes={lignesCharge}
        ca={caPlanning}
        caError={caError}
        filtreEquipe={!!recordIdsFiltres}
        onOpen={ouvrirJournee}
      />
    );
  }, [voitCharge, lignesCharge, ouvrirJournee, caPlanning, caError, recordIdsFiltres]);

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
    setPeriode({
      debut: dateInfo.view.currentStart.toLocaleDateString('fr-CA'),
      finExclue: dateInfo.view.currentEnd.toLocaleDateString('fr-CA'),
    });
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
        <h1 className="text-2xl font-bold text-gray-900">Planning</h1>
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
      <h1 className="text-2xl font-bold text-gray-900">Planning</h1>

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 space-y-3">
        <CalendarToolbar
          calendarRef={calendarRef}
          currentView={currentView}
          onViewChange={handleViewChange}
          title={calendarTitle}
          weekNumber={calendarWeek}
          caCumul={caCumul}
          caCumulPartiel={!!recordIdsFiltres}
          onAddEvent={canCreateAppointment ? () => setModalState({ open: true, mode: 'create', appointment: null, defaultDate: new Date().toISOString().split('T')[0], defaultTime: '09:00' }) : null}
          onRefresh={refresh}
          isLoading={isLoading}
          onPrint={handlePrint}
          printHint={printHint}
          printLabel={printLabel}
          isPrinting={isPrinting}
          isMobileDevice={isMobileDevice}
          search={<PlanningClientSearchInput orgId={orgId} onPick={setSearchedClient} />}
        />
        <CalendarFilters
          filters={filters}
          setFilters={setFilters}
          teamList={teamList}
        />
        <PlanningClientAppointments
          orgId={orgId}
          client={searchedClient}
          teamList={teamList}
          onPickAppointment={handlePickSearchedAppointment}
          onResultsChange={setSearchHitIds}
          onClose={() => setSearchedClient(null)}
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
