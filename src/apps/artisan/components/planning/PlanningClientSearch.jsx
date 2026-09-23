/**
 * PlanningClientSearch.jsx - Majord'home Artisan
 * ============================================================================
 * Recherche d'un client inscrit depuis le planning (nom, prénom, téléphone,
 * ville — multi-mots) → liste de TOUS ses RDV, passés et à venir. Un clic sur
 * un RDV amène le calendrier à sa date ; les RDV du client y sont surlignés.
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
        className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm rounded-md hover:bg-gray-50"
      >
        <span className="w-28 shrink-0 font-medium text-gray-900">{formatDateShortFR(appt.scheduled_date)}</span>
        <span className="w-24 shrink-0 text-gray-500">
          {hhmm(appt.scheduled_start)}{appt.scheduled_end ? ` – ${hhmm(appt.scheduled_end)}` : ''}
        </span>
        <span className="inline-flex items-center gap-1.5 w-40 shrink-0 text-gray-700">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: type.color }} />
          {type.label}
        </span>
        <span className="flex-1 min-w-0 truncate text-gray-600">
          {persons.length > 0 ? persons.map((p) => p.displayName).join(', ') : <span className="text-gray-400">Non assigné</span>}
        </span>
        {status && <span className={`px-2 py-0.5 rounded text-xs shrink-0 ${status.color}`}>{status.label}</span>}
      </button>
    </li>
  );
}

export function PlanningClientSearch({ orgId, teamList, onPickAppointment, onResultsChange }) {
  const { query, results, searching, search, clear } = useClientSearch(orgId);
  const [client, setClient] = useState(null);
  const [open, setOpen] = useState(false);
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

  const pickClient = (c) => {
    setClient(c);
    setOpen(false);
    clear();
  };

  const reset = () => {
    setClient(null);
    clear();
  };

  return (
    <div className="space-y-2">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => { search(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Rechercher un client (nom, prénom, téléphone, ville)…"
          className="w-full pl-9 pr-9 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />}
        {open && query.length >= 2 && !searching && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <ul className="absolute left-0 right-0 top-full mt-1 max-h-72 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
              {results.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">Aucun client trouvé</li>}
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => pickClient(c)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    <div className="font-medium text-gray-900">{c.display_name}</div>
                    <div className="text-xs text-gray-500 flex gap-3">
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

      {client && (
        <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="font-semibold text-gray-900">{client.display_name}</div>
              <div className="text-xs text-gray-500 flex gap-3">
                {client.city && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{client.postal_code} {client.city}</span>}
                {client.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{client.phone}</span>}
              </div>
            </div>
            <button onClick={reset} className="p-1 text-gray-400 hover:text-gray-700 rounded" title="Fermer la recherche">
              <X className="w-4 h-4" />
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement des RDV…
            </div>
          ) : error ? (
            <div className="text-sm text-red-600 py-2">Impossible de charger les RDV : {error.message}</div>
          ) : appointments.length === 0 ? (
            <div className="text-sm text-gray-500 py-2">Aucun RDV pour ce client.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <section>
                <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">À venir ({upcoming.length})</h4>
                {upcoming.length === 0
                  ? <p className="text-sm text-gray-400 px-3">Aucun</p>
                  : <ul className="max-h-60 overflow-auto">{upcoming.map((a) => <AppointmentRow key={a.id} appt={a} teamList={teamList} onPick={onPickAppointment} />)}</ul>}
              </section>
              <section>
                <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">Passés ({past.length})</h4>
                {past.length === 0
                  ? <p className="text-sm text-gray-400 px-3">Aucun</p>
                  : <ul className="max-h-60 overflow-auto">{past.map((a) => <AppointmentRow key={a.id} appt={a} teamList={teamList} onPick={onPickAppointment} />)}</ul>}
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
