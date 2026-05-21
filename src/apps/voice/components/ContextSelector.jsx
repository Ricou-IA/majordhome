import { useState } from 'react';
import { Calendar, Search, UserPlus, FileText, Check, Clock, MapPin, Loader2 } from 'lucide-react';
import { useTodaysAppointments } from '../hooks/useVoiceContext';
import ClientSearchPanel from './ClientSearchPanel';
import NewProspectForm from './NewProspectForm';

const FRENCH_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const FRENCH_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function formatDate(date) {
  return `${FRENCH_DAYS[date.getDay()]} ${date.getDate()} ${FRENCH_MONTHS[date.getMonth()]}`;
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  return timeStr.slice(0, 5).replace(':', 'h');
}

/**
 * ContextSelector — écran principal de la PWA voice.
 * Affiche les cartes RDV du jour + 3 fallback options.
 *
 * Props :
 *  - onSelectAppointment(apt)
 *  - onSelectExistingClient(client)
 *  - onSelectNewProspect({ first_name, last_name, phone, city })
 *  - onSelectNoteLibre()
 */
export default function ContextSelector({
  onSelectAppointment,
  onSelectExistingClient,
  onSelectNewProspect,
  onSelectNoteLibre,
}) {
  const { data: appointments = [], isLoading } = useTodaysAppointments();
  const [overlay, setOverlay] = useState(null); // 'search' | 'prospect' | null

  const now = new Date();

  return (
    <div className="flex-1 flex flex-col px-4 py-6 max-w-md mx-auto w-full">
      {/* Header */}
      <header className="mb-5">
        <p className="text-secondary-400 text-xs uppercase tracking-wide">
          {formatDate(now)} · {now.getHours()}h{String(now.getMinutes()).padStart(2, '0')}
        </p>
        <h1 className="text-xl font-semibold mt-1">Compte-rendu vocal</h1>
      </header>

      {/* Section RDV du jour */}
      <section className="mb-4">
        <h2 className="flex items-center gap-2 text-secondary-300 text-sm font-medium mb-2">
          <Calendar className="w-4 h-4" />
          Tes RDV aujourd'hui
        </h2>

        {isLoading && (
          <div className="flex items-center justify-center py-6 text-secondary-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!isLoading && appointments.length === 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center text-secondary-400 text-sm">
            Aucun RDV planifié aujourd'hui
          </div>
        )}

        <div className="space-y-2">
          {appointments.map((apt) => (
            <AppointmentCard
              key={apt.id}
              appointment={apt}
              onClick={() => onSelectAppointment(apt)}
            />
          ))}
        </div>
      </section>

      {/* Fallback options */}
      <section className="mt-4 space-y-2">
        <button
          type="button"
          onClick={() => setOverlay('search')}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition text-left"
        >
          <Search className="w-5 h-5 text-orange-400 shrink-0" />
          <div>
            <div className="font-medium">Sélectionner un autre client</div>
            <div className="text-secondary-400 text-xs">RDV imprévu, SAV, retour client</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setOverlay('prospect')}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition text-left"
        >
          <UserPlus className="w-5 h-5 text-orange-400 shrink-0" />
          <div>
            <div className="font-medium">Nouveau prospect</div>
            <div className="text-secondary-400 text-xs">Pas encore en base</div>
          </div>
        </button>

        <button
          type="button"
          onClick={onSelectNoteLibre}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition text-left"
        >
          <FileText className="w-5 h-5 text-orange-400 shrink-0" />
          <div>
            <div className="font-medium">Note libre / réunion</div>
            <div className="text-secondary-400 text-xs">Sans client lié</div>
          </div>
        </button>
      </section>

      {/* Overlays */}
      {overlay === 'search' && (
        <ClientSearchPanel
          onClose={() => setOverlay(null)}
          onSelect={(client) => {
            setOverlay(null);
            onSelectExistingClient(client);
          }}
        />
      )}

      {overlay === 'prospect' && (
        <NewProspectForm
          onClose={() => setOverlay(null)}
          onSubmit={(prospect) => {
            setOverlay(null);
            onSelectNewProspect(prospect);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppointmentCard
// ---------------------------------------------------------------------------

function AppointmentCard({ appointment, onClick }) {
  const { has_voice_memo, scheduled_start, client_name, client_first_name, city, subject } = appointment;
  const fullName = [client_name, client_first_name].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={has_voice_memo}
      className={`w-full text-left rounded-xl border transition px-4 py-3 ${
        has_voice_memo
          ? 'bg-emerald-500/10 border-emerald-500/30 cursor-default'
          : 'bg-white/5 border-white/10 hover:bg-white/10 active:scale-[0.99]'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center shrink-0 mt-0.5">
          <Clock className="w-4 h-4 text-orange-400" />
          <span className="text-xs text-secondary-300 font-mono mt-0.5">
            {formatTime(scheduled_start)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{fullName || 'Sans nom'}</div>
          {city && (
            <div className="text-secondary-400 text-xs flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" />
              {city}
            </div>
          )}
          {subject && (
            <div className="text-secondary-500 text-xs mt-1 line-clamp-1">{subject}</div>
          )}
        </div>
        {has_voice_memo && (
          <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium shrink-0">
            <Check className="w-3.5 h-3.5" /> Vocal fait
          </div>
        )}
      </div>
    </button>
  );
}
