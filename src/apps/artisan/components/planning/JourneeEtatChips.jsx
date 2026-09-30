/**
 * JourneeEtatChips.jsx — puces d'état de journée sous l'en-tête d'un jour du Planning
 * ============================================================================
 * Une puce par technicien planifié par la machine : Vide · Ouverte · Pleine ·
 * Figée · À arbitrer, avec le secteur (déduit des RDV ou étiqueté). Source
 * unique de l'état : src/lib/tournee/etat.js, via useEtatsJournees.
 * Répond à « je ne sais pas quand une journée est complète et si le cron l'a
 * organisée » (Eric, 2026-09-29). Le clic ouvre la journée dans le panneau de
 * remplissage, sur place (RemplirJourneePanel, monté par Planning.jsx).
 * ============================================================================
 */

import { Lock, AlertTriangle } from 'lucide-react';
import { LIBELLES_ETAT } from '@/lib/tournee/etat.js';

const STYLES = {
  vide: 'bg-secondary-50 text-secondary-500 border-secondary-200',
  ouverte: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pleine: 'bg-amber-50 text-amber-700 border-amber-200',
  figee: 'bg-violet-50 text-violet-700 border-violet-200',
  a_arbitrer: 'bg-red-50 text-red-700 border-red-200',
};

function formatFige(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Aide au survol : ce que la puce ne dit pas (secteur, figeage, reste utile estimé). */
function titre(item) {
  const parts = [`${item.technicienNom} — ${LIBELLES_ETAT[item.etat]}`];
  if (item.etiquette) parts.push(`Secteur ${item.etiquette}${item.origine === 'deduite' ? ' (déduit des RDV posés)' : ''}`);
  if (item.figeeAt) {
    parts.push(`Figée le ${formatFige(item.figeeAt)} par ${item.figeePar === 'cron' ? 'le cron' : 'un membre de l’équipe'}`);
  } else if (item.etat === 'figee') {
    // Figée sans trace de journée : pleine, et chaque entretien a son heure communiquée.
    parts.push('Journée pleine, toutes les heures sont communiquées aux clients');
  } else if (item.remplissage) {
    parts.push(`Reste utile ≈ ${Math.round(item.remplissage.resteUtileMinutes)} min (estimé à vol d’oiseau)`);
  }
  return parts.join('\n');
}

/**
 * @param {{ date: string, etats: Map<string, object>, onOpen?: (item: object) => void }} props
 *   `date` ISO `YYYY-MM-DD` ; `etats` = Map de useEtatsJournees.
 */
export function JourneeEtatChips({ date, etats, onOpen }) {
  const items = [...etats.values()]
    .filter((i) => i.date === date)
    .sort((a, b) => String(a.technicienNom || '').localeCompare(String(b.technicienNom || ''), 'fr'));
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {items.map((item) => (
        <button
          key={item.technicienId}
          type="button"
          onClick={() => onOpen?.(item)}
          title={titre(item)}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-normal leading-tight ${STYLES[item.etat]}`}
        >
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.couleur || '#94A3B8' }} />
          <span className="max-w-[5rem] truncate">{String(item.technicienNom || '').split(' ')[0]}</span>
          {item.etat === 'figee' && <Lock className="h-3 w-3" />}
          {item.etat === 'a_arbitrer' && <AlertTriangle className="h-3 w-3" />}
          <span>{LIBELLES_ETAT[item.etat]}</span>
          {item.etiquette && item.etat !== 'vide' && <span className="opacity-70">· {item.etiquette}</span>}
        </button>
      ))}
    </div>
  );
}
