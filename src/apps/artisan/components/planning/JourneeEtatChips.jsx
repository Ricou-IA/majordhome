/**
 * JourneeEtatChips.jsx — puces d'état de journée sous l'en-tête d'un jour du Planning
 * ============================================================================
 * Réservées à l'admin d'organisation et au team leader (Planning.jsx).
 * Une ligne par technicien : Vide · Ouverte · Pleine · Figée · À arbitrer, avec
 * la zone de travail (grand secteur déduit des RDV ou étiqueté, sinon la ville
 * du jour) — et une ligne sans libellé pour une journée d'interventions que le
 * moteur ne juge pas (technicien hors tournées, jour passé) : feuille de route
 * seule. QUI a une ligne (jamais une personne en congés, « Vide » pour un
 * technicien libre) : src/lib/planningCharge.js. État d'une journée :
 * src/lib/tournee/etat.js, via useEtatsJournees.
 * Répond à « je ne sais pas quand une journée est complète et si le cron l'a
 * organisée » (Eric, 2026-09-29). Le clic ouvre la journée dans le panneau de
 * remplissage, sur place (RemplirJourneePanel, monté par Planning.jsx).
 * ============================================================================
 */

import { Lock, AlertTriangle } from 'lucide-react';
import { LIBELLES_ETAT } from '@/lib/tournee/etat.js';
import { formatCa } from '@/lib/planningCa';

const STYLES = {
  vide: 'bg-secondary-50 text-secondary-500 border-secondary-200',
  ouverte: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pleine: 'bg-amber-50 text-amber-700 border-amber-200',
  figee: 'bg-violet-50 text-violet-700 border-violet-200',
  a_arbitrer: 'bg-red-50 text-red-700 border-red-200',
  // Journée que la machine ne juge pas — technicien hors tournées (`manuelle`),
  // jour passé ou non travaillé (`sans_etat`) : la personne, sa zone et son chiffre,
  // sans libellé (« À la main » n'apprenait rien, Eric 2026-11-15).
  manuelle: 'bg-white text-secondary-600 border-secondary-200',
  sans_etat: 'bg-white text-secondary-600 border-secondary-200',
  // Réponse en cours (RDV, techniciens ou verdict du moteur) : le nom seul, la place est tenue.
  attente: 'bg-white text-secondary-400 border-secondary-100',
};

/** Journée sans verdict du moteur : pas de libellé d'état, la feuille de route au clic. */
const sansVerdict = (item) => item.etat === 'manuelle' || item.etat === 'sans_etat';

/** Zone de travail affichée : grand secteur (entretiens), sinon ville(s) du jour. */
const zone = (item) => item.etiquette || item.lieu || '';

function formatFige(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Libellé affiché : l'état de la journée ; rien pour une journée sans verdict du moteur. */
function libelle(item) {
  return sansVerdict(item) ? '' : LIBELLES_ETAT[item.etat];
}

/** Aide au survol : ce que la puce ne dit pas (secteur, figeage, reste utile estimé). */
function titre(item) {
  if (item.etat === 'attente') return `${item.technicienNom}\nChargement de la journée…`;
  if (sansVerdict(item)) {
    return [
      item.technicienNom,
      item.etat === 'manuelle'
        ? `Planifiée à la main (hors tournées) · ${item.nbRdvs} RDV`
        : `Journée non évaluée par les tournées (jour passé ou non travaillé) · ${item.nbRdvs} RDV`,
      zone(item) ? `Zone : ${zone(item)}` : null,
      'Clic : feuille de route',
    ].filter(Boolean).join('\n');
  }
  const parts = [`${item.technicienNom} — ${libelle(item)}`];
  // Technicien libre un jour que le moteur ne juge pas (jour passé, hors tournées).
  if (item.horsMoteur) return [...parts, 'Aucune intervention ce jour-là'].join('\n');
  if (item.etiquette) parts.push(`Secteur ${item.etiquette}${item.origine === 'deduite' ? ' (déduit des RDV posés)' : ''}`);
  else if (item.lieu) parts.push(`Zone : ${item.lieu}`);
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
 * état à gauche, part du CA HT programmé de sa journée à droite. Une journée
 * sans intervention affiche « 0 € » : c'est l'indicateur d'un planning à
 * remplir — seulement quand le chiffre est connu, jamais un 0 par défaut.
 *
 * @param {{ date: string, etats: Map<string, object>, reserve?: number, onOpen?: (item: object) => void, caParTechnicien?: Map<string, number>|null }} props
 *   `date` ISO `YYYY-MM-DD` ; `etats` = Map de useEtatsJournees ;
 *   `caParTechnicien` = `parTechnicienJour` de planningCa (clé `${date}|${technicienId}`),
 *   null tant que le chiffre est inconnu — rien n'est alors affiché.
 *   `reserve` = nombre de lignes dont la hauteur est tenue même si ce jour en a moins (lignes
 *   invisibles) : l'en-tête ne se vide pas le temps que les lignes d'une nouvelle semaine arrivent.
 */
export function JourneeEtatChips({ date, etats, reserve = 0, onOpen, caParTechnicien = null }) {
  const items = [...etats.values()]
    .filter((i) => i.date === date)
    .sort((a, b) => String(a.technicienNom || '').localeCompare(String(b.technicienNom || ''), 'fr'));
  const vides = Math.max(0, reserve - items.length);
  if (items.length === 0 && vides === 0) return null;
  return (
    <div className="mt-1 flex w-full flex-col gap-0.5">
      {items.map((item) => {
        const ca = caParTechnicien?.get(`${item.date}|${item.technicienId}`) || 0;
        const montant = ca > 0 || (caParTechnicien && item.sansIntervention) ? formatCa(ca) : null;
        return (
          <button
            key={item.technicienId}
            type="button"
            onClick={() => onOpen?.(item)}
            disabled={item.etat === 'attente'}
            title={ca > 0 ? `${titre(item)}\nCA HT programmé : ${formatCa(ca)}` : titre(item)}
            className={`flex w-full items-center gap-1 rounded border px-1.5 py-0.5 text-left text-[10px] font-normal leading-tight ${STYLES[item.etat]}`}
          >
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.couleur || '#94A3B8' }} />
            <span className="max-w-[6rem] shrink-0 truncate font-medium">{String(item.technicienNom || '').split(' ')[0]}</span>
            {item.etat === 'figee' && <Lock className="h-3 w-3 shrink-0" />}
            {item.etat === 'a_arbitrer' && <AlertTriangle className="h-3 w-3 shrink-0" />}
            {libelle(item) && <span className="shrink-0">{libelle(item)}</span>}
            {zone(item) && item.etat !== 'vide' && (
              <span className="min-w-0 truncate opacity-70">{libelle(item) ? '· ' : ''}{zone(item)}</span>
            )}
            {montant && <span className={`ml-auto shrink-0 pl-1 tabular-nums ${ca > 0 ? 'font-semibold' : ''}`}>{montant}</span>}
          </button>
        );
      })}
      {Array.from({ length: vides }, (_, i) => (
        // Même gabarit qu'une ligne, invisible : seule sa hauteur compte.
        <div key={`reserve-${i}`} aria-hidden="true" className="invisible rounded border px-1.5 py-0.5 text-[10px] leading-tight">&nbsp;</div>
      ))}
    </div>
  );
}
