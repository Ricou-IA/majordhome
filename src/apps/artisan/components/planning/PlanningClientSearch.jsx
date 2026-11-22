/**
 * PlanningClientSearch.jsx - Majord'home Artisan
 * ============================================================================
 * Recherche d'un client inscrit depuis le planning (nom, prénom, téléphone,
 * ville — multi-mots) → liste de TOUS ses RDV, passés et à venir. Un clic sur
 * un RDV amène le calendrier à sa date ; les RDV du client y sont surlignés.
 * Deux morceaux : le champ (barre d'outils) et la liste des RDV (sous les filtres).
 * ============================================================================
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, X, Loader2, MapPin, Phone } from 'lucide-react';
import { useClientSearch } from '@hooks/useClients';
import { useClientAppointments } from '@hooks/useAppointments';
import { getAppointmentTypeConfig, APPOINTMENT_STATUSES } from '@services/appointments.service';
import { formatDateShortFR } from '@/lib/utils';

const hhmm = (t) => (t ? t.slice(0, 5) : '');

/** Personnes d'un RDV (techniciens + commercial), résolues sur la liste équipe unifiée. */
function personsOf(appt, teamList) {
  const ids = new Set([...(appt.technician_ids || []), appt.assigned_commercial_id].filter(Boolean));
  return teamList.filter((h) => h.recordIds.some((id) => ids.has(id)));
}

function AppointmentRow({ appt, teamList, onPick }) {
  const type = getAppointmentTypeConfig(appt.appointment_type);
  const status = APPOINTMENT_STATUSES.find((s) => s.value === appt.status);
  const persons = personsOf(appt, teamList);
  return (
    <li>
      <button
        onClick={() => onPick(appt)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm rounded-md hover:bg-secondary-50"
      >
        <span className="w-28 shrink-0 font-medium text-secondary-900">{formatDateShortFR(appt.scheduled_date)}</span>
        <span className="w-24 shrink-0 text-secondary-500">
          {hhmm(appt.scheduled_start)}{appt.scheduled_end ? ` – ${hhmm(appt.scheduled_end)}` : ''}
        </span>
        <span className="inline-flex items-center gap-1.5 w-40 shrink-0 text-secondary-700">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: type.color }} />
          {type.label}
        </span>
        <span className="flex-1 min-w-0 truncate text-secondary-600">
          {persons.length > 0 ? persons.map((p) => p.displayName).join(', ') : <span className="text-secondary-400">Non assigné</span>}
        </span>
        {status && <span className={`px-2 py-0.5 rounded text-xs shrink-0 ${status.color}`}>{status.label}</span>}
      </button>
    </li>
  );
}

/**
 * Champ de recherche (dans la barre d'outils du planning, sur la ligne de la
 * navigation). Le client choisi remonte à la page, qui affiche ses RDV sous les
 * filtres avec PlanningClientAppointments.
 */
export function PlanningClientSearchInput({ orgId, onPick }) {
  const { query, results, searching, search, clear } = useClientSearch(orgId);
  const [open, setOpen] = useState(false);

  const pickClient = (c) => {
    onPick(c);
    setOpen(false);
    clear();
  };

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
      <input
        type="text"
        value={query}
        onChange={(e) => { search(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Rechercher un client (nom, prénom, téléphone, ville)…"
        title="Rechercher un client : nom, prénom, téléphone ou ville"
        aria-label="Rechercher un client"
        className="w-full pl-9 pr-9 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-secondary-400" />}
      {open && query.length >= 2 && !searching && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul className="absolute left-0 right-0 top-full mt-1 min-w-[18rem] max-h-72 overflow-auto bg-white border border-secondary-200 rounded-lg shadow-lg z-20 py-1">
            {results.length === 0 && <li className="px-3 py-2 text-sm text-secondary-500">Aucun client trouvé</li>}
            {results.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => pickClient(c)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-secondary-50"
                >
                  <div className="font-medium text-secondary-900">{c.display_name}</div>
                  <div className="text-xs text-secondary-500 flex gap-3">
                    {c.city && <span>{c.postal_code} {c.city}</span>}
                    {c.phone && <span>{c.phone}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * RDV du client recherché, passés et à venir. Monté en permanence : sans client,
 * il n'affiche rien et retire le surlignage du calendrier.
 */
export function PlanningClientAppointments({ orgId, client, teamList, onPickAppointment, onResultsChange, onClose }) {
  const { appointments, isLoading, error } = useClientAppointments(orgId, client?.id);

  // Surlignage des RDV du client dans le calendrier.
  useEffect(() => {
    onResultsChange?.(client ? new Set(appointments.map((a) => a.id)) : null);
  }, [client, appointments, onResultsChange]);

  const { upcoming, past } = useMemo(() => {
    const today = new Date().toLocaleDateString('fr-CA'); // YYYY-MM-DD local
    return {
      // Service trié du plus récent au plus ancien → à venir remis en chronologique.
      upcoming: appointments.filter((a) => a.scheduled_date >= today).reverse(),
      past: appointments.filter((a) => a.scheduled_date < today),
    };
  }, [appointments]);

  if (!client) return null;

  return (
    <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="font-semibold text-secondary-900">{client.display_name}</div>
          <div className="text-xs text-secondary-500 flex gap-3">
            {client.city && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{client.postal_code} {client.city}</span>}
            {client.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{client.phone}</span>}
          </div>
        </div>
        <button onClick={onClose} className="p-1 text-secondary-400 hover:text-secondary-700 rounded" title="Fermer la recherche">
          <X className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-secondary-500 py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement des RDV…
        </div>
      ) : error ? (
        <div className="text-sm text-red-600 py-2">Impossible de charger les RDV : {error.message}</div>
      ) : appointments.length === 0 ? (
        <div className="text-sm text-secondary-500 py-2">Aucun RDV pour ce client.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <section>
            <h4 className="text-xs font-semibold uppercase text-secondary-500 mb-1">À venir ({upcoming.length})</h4>
            {upcoming.length === 0
              ? <p className="text-sm text-secondary-400 px-3">Aucun</p>
              : <ul className="max-h-60 overflow-auto">{upcoming.map((a) => <AppointmentRow key={a.id} appt={a} teamList={teamList} onPick={onPickAppointment} />)}</ul>}
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase text-secondary-500 mb-1">Passés ({past.length})</h4>
            {past.length === 0
              ? <p className="text-sm text-secondary-400 px-3">Aucun</p>
              : <ul className="max-h-60 overflow-auto">{past.map((a) => <AppointmentRow key={a.id} appt={a} teamList={teamList} onPick={onPickAppointment} />)}</ul>}
          </section>
        </div>
      )}
    </div>
  );
}
