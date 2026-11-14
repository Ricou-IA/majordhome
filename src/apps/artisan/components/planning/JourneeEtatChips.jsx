/**
 * JourneeEtatChips.jsx — puces d'état de journée sous l'en-tête d'un jour du Planning
 * ============================================================================
 * Réservées à l'admin d'organisation et au team leader (Planning.jsx).
 * Une puce par technicien planifié par la machine : Vide · Ouverte · Pleine ·
 * Figée · À arbitrer, avec le secteur (déduit des RDV ou étiqueté) — et « À la
 * main » pour un technicien hors tournées (feuille de route seule). Source
 * unique de l'état : src/lib/tournee/etat.js, via useEtatsJournees.
 * Répond à « je ne sais pas quand une journée est complète et si le cron l'a
 * organisée » (Eric, 2026-09-29). Le clic ouvre la journée dans le panneau de
 * remplissage, sur place (RemplirJourneePanel, monté par Planning.jsx).
 * ============================================================================
 */

import { Lock, AlertTriangle } from 'lucide-react';
import { LIBELLES_ETAT } from '@/lib/tournee/etat.js';
import { formatCa } from '@/lib/planningCa';

const STYLES = {
  conges: 'bg-slate-100 text-slate-600 border-slate-300',
  vide: 'bg-secondary-50 text-secondary-500 border-secondary-200',
  ouverte: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pleine: 'bg-amber-50 text-amber-700 border-amber-200',
  figee: 'bg-violet-50 text-violet-700 border-violet-200',
  a_arbitrer: 'bg-red-50 text-red-700 border-red-200',
  // Technicien hors tournées : la machine ne juge pas sa journée (Planning.jsx).
  manuelle: 'bg-sky-50 text-sky-700 border-sky-200',
};

function formatFige(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Libellé affiché : « Congés » quand la journée ne porte que des congés, sinon l'état du moteur. */
function libelle(item) {
  if (item.enConges) return 'Congés';
  return item.etat === 'manuelle' ? 'À la main' : LIBELLES_ETAT[item.etat];
}

/** Aide au survol : ce que la puce ne dit pas (secteur, figeage, reste utile estimé). */
function titre(item) {
  const parts = [`${item.technicienNom} — ${libelle(item)}`];
  if (item.enConges) return parts.join('\n');
  if (item.etat === 'manuelle') {
    parts.push(`Planifiée à la main (hors tournées) · ${item.nbRdvs} RDV`, 'Clic : feuille de route');
    return parts.join('\n');
  }
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
 * Une ligne par technicien (Eric, 2026-11-14 : « pour que ce soit lisible ») :
 * état à gauche, part du CA HT programmé de sa journée à droite.
 *
 * @param {{ date: string, etats: Map<string, object>, onOpen?: (item: object) => void, caParTechnicien?: Map<string, number>|null }} props
 *   `date` ISO `YYYY-MM-DD` ; `etats` = Map de useEtatsJournees ;
 *   `caParTechnicien` = `parTechnicienJour` de planningCa (clé `${date}|${technicienId}`),
 *   null tant que le chiffre est inconnu — rien n'est alors affiché.
 */
export function JourneeEtatChips({ date, etats, onOpen, caParTechnicien = null }) {
  const items = [...etats.values()]
    .filter((i) => i.date === date)
    .sort((a, b) => String(a.technicienNom || '').localeCompare(String(b.technicienNom || ''), 'fr'));
  if (items.length === 0) return null;
  return (
    <div className="mt-1 flex w-full flex-col gap-0.5">
      {items.map((item) => {
        const ca = caParTechnicien?.get(`${item.date}|${item.technicienId}`) || 0;
        return (
          <button
            key={item.technicienId}
            type="button"
            onClick={() => onOpen?.(item)}
            title={ca > 0 ? `${titre(item)}\nCA HT programmé : ${formatCa(ca)}` : titre(item)}
            className={`flex w-full items-center gap-1 rounded border px-1.5 py-0.5 text-left text-[10px] font-normal leading-tight ${STYLES[item.enConges ? 'conges' : item.etat]}`}
          >
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.couleur || '#94A3B8' }} />
            <span className="max-w-[6rem] shrink-0 truncate font-medium">{String(item.technicienNom || '').split(' ')[0]}</span>
            {!item.enConges && item.etat === 'figee' && <Lock className="h-3 w-3 shrink-0" />}
            {!item.enConges && item.etat === 'a_arbitrer' && <AlertTriangle className="h-3 w-3 shrink-0" />}
            <span className="shrink-0">{libelle(item)}</span>
            {item.etiquette && item.etat !== 'vide' && !item.enConges && <span className="min-w-0 truncate opacity-70">· {item.etiquette}</span>}
            {ca > 0 && <span className="ml-auto shrink-0 pl-1 font-semibold tabular-nums">{formatCa(ca)}</span>}
          </button>
        );
      })}
    </div>
  );
}
