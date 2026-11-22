/**
 * Planning.jsx - Majord'home Artisan
 * ============================================================================
 * Page planning avec calendrier FullCalendar interactif.
 * Vues : semaine, jour, mois. Drag & drop + resize.
 *
 * La page assemble ; chaque sujet a son fichier :
 *   - barre du haut ........... components/planning/CalendarToolbar.jsx
 *   - filtres en entonnoir .... components/planning/CalendarFilters.jsx (règles : lib/planningEvents.js)
 *   - vignette d'un RDV ....... components/planning/PlanningEventContent.jsx (règles : lib/planningVignette.js)
 *   - vue et plage affichées .. hooks/usePlanningVue.js (règles : lib/planningGestes.js)
 *   - gestes sur le calendrier  hooks/usePlanningGestes.js (règles : lib/planningGestes.js)
 *   - semaines voisines ....... hooks/usePlanningPrechargement.js (requêtes : hooks/planningQueries.js)
 *   - fenêtre de RDV .......... hooks/usePlanningFenetreRdv.js + components/planning/EventModal.jsx
 *   - charge et CA du jour .... hooks/usePlanningCharge.js + components/planning/PlanningDayHeader.jsx
 *                               (règles : lib/planningCharge.js, lib/planningCa.js)
 *   - journée d'un technicien . hooks/usePlanningJournee.js (règles : lib/planningCharge.js)
 *   - impression .............. hooks/usePlanningImpression.js (règles : lib/planningPrintModel.js)
 * Une nouvelle règle va dans le module pur concerné, avec son test — pas ici.
 *
 * @version 2.0.0 - Sprint 2 : FullCalendar + CRUD RDV
 * ============================================================================
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useAppointments, useTeamMembers } from '@hooks/useAppointments';
import { usePlanningVue } from '@hooks/usePlanningVue';
import { usePlanningGestes } from '@hooks/usePlanningGestes';
import { usePlanningFenetreRdv } from '@hooks/usePlanningFenetreRdv';
import { usePlanningPrechargement } from '@hooks/usePlanningPrechargement';
import { usePlanningCharge } from '@hooks/usePlanningCharge';
import { usePlanningJournee } from '@hooks/usePlanningJournee';
import { usePlanningImpression } from '@hooks/usePlanningImpression';
import { useDeviceClass } from '@hooks/useDeviceClass';
import { creneauParDefaut, bornesDeGrille } from '@/lib/planningGestes';
import { cssDesCouloirs } from '@/lib/planningCouloirs';
import { FeuilleDeRoutePanel } from '@/apps/artisan/components/planning/FeuilleDeRoutePanel';
import { EventModal } from '@/apps/artisan/components/planning/EventModal';
import { CalendarToolbar } from '@/apps/artisan/components/planning/CalendarToolbar';
import { CalendarFilters } from '@/apps/artisan/components/planning/CalendarFilters';
import { PlanningClientSearchInput, PlanningClientAppointments } from '@/apps/artisan/components/planning/PlanningClientSearch';
import { PlanningEventContent } from '@/apps/artisan/components/planning/PlanningEventContent';
import { PlanningDayHeader } from '@/apps/artisan/components/planning/PlanningDayHeader';
import { RemplirJourneePanel } from '@/apps/artisan/components/tournees/RemplirJourneePanel';

// Vue Mois : une colonne est un jour de la SEMAINE, pas une date. Avec le format des
// autres vues (jour + mois), le calendrier y écrivait une date de référence sans
// rapport avec le mois affiché (« LUN. 5 JANV. » en octobre).
const OPTIONS_PAR_VUE = { dayGridMonth: { dayHeaderFormat: { weekday: 'short' } } };

export default function Planning() {
  const { organization, user, effectiveRole } = useAuth();
  const { can } = useCanAccess();
  const orgId = organization?.id;
  const calendarRef = useRef(null);
  const canCreateAppointment = can('planning', 'create');
  // Charge par technicien (puces d'état) et CA programmé : pilotage, pas terrain
  // (Eric, 2026-11-14) — admin d'organisation et team leader, jamais le technicien.
  const voitCharge = effectiveRole === 'org_admin' || effectiveRole === 'team_leader';
  // Sur appareil tenu en main (tablette, téléphone) : la journée en liste, pas la
  // semaine en grille (cf. VUES_MOBILE de CalendarToolbar).
  const { isMobileDevice } = useDeviceClass();
  const vueInitiale = isMobileDevice ? 'listDay' : 'timeGridWeek';

  // Ce que le calendrier affiche : vue, titre, semaine, plage chargée, période du titre.
  const {
    vue: currentView, titre: calendarTitle, semaine: calendarWeek, plage: dateRange, periode,
    surDates, changerDeVue, allerAuJour,
  } = usePlanningVue({ calendarRef, vueInitiale });

  // Client recherché depuis la barre d'outils (ses RDV s'affichent sous les filtres)
  const [searchedClient, setSearchedClient] = useState(null);
  // RDV du client recherché (surlignés dans le calendrier) — null = pas de recherche
  const [searchHitIds, setSearchHitIds] = useState(null);

  // Données : RDV de la plage, blocs du calendrier, filtres, équipe, écritures.
  const {
    appointments,
    events,
    isLoading,
    isLoadingTechnicians,
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

  // Semaines (ou jours) voisins chargés d'avance : « précédent » / « suivant » sans attente.
  usePlanningPrechargement({
    orgId,
    vue: currentView,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    appointmentType: filters.appointmentType,
    status: filters.status,
    voitCharge,
    pret: !isLoading && !error,
  });

  // Fenêtre de RDV (création sur un créneau, édition d'un RDV) et gestes du
  // calendrier : clic dans le vide, clic sur un RDV, RDV glissé ou étiré.
  const {
    fenetre, ouvrirCreation, ouvrirEdition, fermer: fermerFenetre, enregistrer, supprimer, annuler,
  } = usePlanningFenetreRdv({ createAppointment, updateAppointment, deleteAppointment, cancelAppointment });
  const { surSelection, surClic, surDeplacement, surEtirement } = usePlanningGestes({
    calendarRef, moveAppointment, ouvrirCreation, ouvrirEdition,
  });
  const nouveauRdv = useCallback(() => ouvrirCreation(creneauParDefaut()), [ouvrirCreation]);

  // Création directe (?nouveau=1, menu « Créer ») : ouvre la fenêtre de RDV puis retire
  // le paramètre, pour qu'un rechargement ne la rouvre pas.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('nouveau') !== '1') return;
    if (canCreateAppointment) nouveauRdv();
    const next = new URLSearchParams(searchParams);
    next.delete('nouveau');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, canCreateAppointment, nouveauRdv]);

  // Charge de la plage visible : état de chaque journée de technicien, lignes sous
  // l'en-tête du jour, CA HT programmé (règles : src/lib/planningCharge.js et
  // planningCa.js). `orgId` du Planning = org CORE, attendue par le moteur de tournées.
  const {
    recordIdsFiltres, etatsJournees, journeesHorizon, etatsLoading, etatsError,
    lignes: lignesCharge, hauteurEnTete, ca: caPlanning, caError, caCumul,
  } = usePlanningCharge({
    orgId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    periode,
    appointments,
    members,
    teamList,
    memberProfileKeys: filters.memberProfileKeys,
    // RDV restreints par un filtre de type ou de statut : la charge est partielle, on
    // ne dit pas qu'une journée est vide. RDV ou techniciens en cours de chargement :
    // chaque technicien garde sa ligne, sans état ni chiffre, le temps de la réponse.
    rdvsPartiels: !!(filters.appointmentType || filters.status),
    rdvsEnChargement: isLoading || isLoadingTechnicians,
    voitCharge,
  });

  // Journée d'un technicien ouverte par sa ligne de charge ou par lien direct :
  // panneau de remplissage, ou feuille de route seule (usePlanningJournee).
  const {
    dateInitiale, journeeSelectionnee, feuilleOuverte, ouvrirJournee, fermerJournee, fermerFeuille,
  } = usePlanningJournee({ journeesHorizon, etatsLoading, etatsError, finPlage: dateRange.endDate });

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

  // Impression pour UNE personne : feuille de route en vue Jour, planning de la
  // semaine en vue Semaine (usePlanningImpression).
  const { printHint, printLabel, isPrinting, handlePrint } = usePlanningImpression({
    orgId,
    vue: currentView,
    startDate: dateRange.startDate,
    memberProfileKeys: filters.memberProfileKeys,
    teamList,
    events,
  });

  // Une colonne par personne dans chaque jour : les places calculées par useAppointments
  // (lib/planningCouloirs.js) sont imposées au cadre de chaque bloc par ces règles.
  const cssCouloirs = useMemo(() => cssDesCouloirs(events), [events]);
  // Grille de 7 h 30 à 18 h, élargie seulement si un RDV affiché en sort.
  const grille = useMemo(() => bornesDeGrille(events), [events]);

  // Recherche client : clic sur un de ses RDV → le calendrier va à sa date ; ses RDV sont surlignés.
  const handlePickSearchedAppointment = useCallback((appt) => allerAuJour(appt.scheduled_date), [allerAuJour]);
  const eventClassNames = useCallback(
    (arg) => (searchHitIds?.has(arg.event.extendedProps.id) ? ['mdh-search-hit'] : []),
    [searchHitIds]
  );

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
          <button onClick={refresh} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
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
          onViewChange={changerDeVue}
          title={calendarTitle}
          weekNumber={calendarWeek}
          caCumul={caCumul}
          caCumulPartiel={!!recordIdsFiltres}
          onAddEvent={canCreateAppointment ? nouveauRdv : null}
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

        {/* Hauteur d'en-tête réservée (lignes de charge) : la grille ne saute pas au changement
            de semaine. Jamais en vue Mois, qui n'a pas de lignes. */}
        <div
          className="fc-wrapper"
          style={hauteurEnTete && currentView !== 'dayGridMonth' ? { '--mdh-head-h': `${hauteurEnTete}px` } : undefined}
        >
          {cssCouloirs && <style>{cssCouloirs}</style>}
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
            slotMinTime={grille.slotMinTime}
            slotMaxTime={grille.slotMaxTime}
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
            datesSet={surDates}
            select={surSelection}
            eventClick={surClic}
            eventDrop={surDeplacement}
            eventResize={surEtirement}
            // Style
            eventDisplay="block"
            // RDV concurrents (2 techniciens) côte à côte sans se recouvrir
            slotEventOverlap={false}
            dayHeaderFormat={{ weekday: 'short', day: 'numeric', month: 'short' }}
            views={OPTIONS_PAR_VUE}
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

      {/* Fenêtre de RDV */}
      <EventModal
        isOpen={fenetre.open}
        mode={fenetre.mode}
        appointment={fenetre.appointment}
        defaultDate={fenetre.defaultDate}
        defaultTime={fenetre.defaultTime}
        members={members}
        orgId={orgId}
        userId={user?.id}
        onClose={fermerFenetre}
        onSave={enregistrer}
        onDelete={supprimer}
        onCancel={annuler}
        isSaving={isCreating || isUpdating}
      />

      {/* Remplir / figer une journée de technicien — clic sur sa ligne de charge.
          Seule porte de programmation au fil de l'eau (spec auto-RDV § 5). */}
      {journeeSelectionnee && (
        <RemplirJourneePanel
          journee={journeeSelectionnee}
          etat={etatsJournees.get(`${journeeSelectionnee.date}|${journeeSelectionnee.technicienId}`)}
          onClose={fermerJournee}
        />
      )}

      {/* Feuille de route seule — journée que le moteur ne juge pas (hors tournées, jour passé) */}
      {feuilleOuverte && (
        <FeuilleDeRoutePanel journee={feuilleOuverte} onClose={fermerFeuille} />
      )}
    </div>
  );
}
