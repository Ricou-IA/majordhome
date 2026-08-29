/**
 * JourneeTimeline.jsx - Majord'home Artisan
 * ============================================================================
 * La journée d'un technicien en une barre horaire : les RDV déjà posés à leur
 * heure réelle, les trous entre eux, l'amplitude pour échelle.
 *
 * Remplace la barre de charge (« 330 / 480 min ») qui disait qu'il restait de
 * la place sans jamais dire OÙ — or c'est la seule question qu'on se pose
 * devant cet écran : ce trou de 10 h à 14 h, qu'est-ce qui y rentre ?
 *
 * Purement présentationnel : tout le placement vient de `src/lib/tournee/
 * timeline.js` (module pur testé), y compris la règle « un RDV non plaçable se
 * montre par un autre canal plutôt que de disparaître ».
 * ============================================================================
 */

import { useMemo } from 'react';
import { construireSegments, graduations, creneauxLibres } from '@/lib/tournee/timeline.js';
import { minutesEnHHMM } from './tourneesPanelUtils';

// Un entretien est ce que ce module pose : il se distingue du reste de la
// journée (installation, SAV, visite technique), qui n'est ici qu'un obstacle
// à contourner. La couleur ne porte jamais l'information seule — l'infobulle
// de chaque bloc énonce le type en toutes lettres.
const COULEUR_BLOC = {
  maintenance: 'bg-blue-500',
  service: 'bg-violet-400',
};
const COULEUR_BLOC_DEFAUT = 'bg-slate-400';

const LIBELLE_TYPE = {
  maintenance: 'Entretien',
  service: 'SAV',
  installation: 'Installation',
  visite_technique: 'Visite technique',
  autre: 'Autre',
};

function libelleRdv(rdv) {
  const type = LIBELLE_TYPE[rdv.appointment_type] || rdv.appointment_type || 'RDV';
  const qui = rdv.client_name || rdv.subject || 'sans client';
  const ou = rdv.city ? ` · ${rdv.city}` : '';
  return `${type} — ${qui}${ou}`;
}

/**
 * @param {object} props
 * @param {{debut: number, fin: number}} props.amplitude  minutes depuis minuit
 * @param {Array<object>} props.rdvs   `journee.rdvs`
 * @param {boolean} [props.avecEchelle=true]  affiche les repères horaires sous la barre
 */
export function JourneeTimeline({ amplitude, rdvs, avecEchelle = true }) {
  const { segments, sansHeure, span } = useMemo(
    () => construireSegments(rdvs, amplitude),
    [rdvs, amplitude],
  );
  const reperes = useMemo(() => graduations(amplitude, 120), [amplitude]);
  const trous = useMemo(() => creneauxLibres(segments, amplitude), [segments, amplitude]);

  // Amplitude inexploitable : pas de barre inventée. On dit ce qu'on a.
  if (span <= 0) {
    return (
      <p className="text-xs text-gray-400 italic">
        Horaires de la journée non exploitables — {(rdvs?.length ?? 0)} RDV non placés.
      </p>
    );
  }

  return (
    <div>
      <div className="relative h-7 rounded bg-gray-100 overflow-hidden">
        {/* Le plus grand trou est souligné : c'est la réponse à « où ça rentre ? ».
            Rendu SOUS les blocs, jamais par-dessus. */}
        {trous.length > 0 && (() => {
          const meilleur = trous.reduce((a, b) => (b.dureeMinutes > a.dureeMinutes ? b : a));
          if (meilleur.dureeMinutes < 60) return null;
          return (
            <div
              className="absolute inset-y-0 bg-emerald-50 border-x border-emerald-200"
              style={{ left: `${meilleur.leftPct}%`, width: `${meilleur.widthPct}%` }}
              title={`Libre ${minutesEnHHMM(meilleur.debutMinutes)}–${minutesEnHHMM(meilleur.finMinutes)}`}
            />
          );
        })()}

        {reperes.map((r) => (
          <div
            key={r.minutes}
            className="absolute inset-y-0 w-px bg-white/70"
            style={{ left: `${r.leftPct}%` }}
          />
        ))}

        {segments.map((s) => (
          <div
            key={s.id}
            className={`absolute inset-y-0 ${COULEUR_BLOC[s.rdv.appointment_type] || COULEUR_BLOC_DEFAUT} ${
              s.deborde ? 'ring-1 ring-inset ring-amber-400' : ''
            }`}
            style={{ left: `${s.leftPct}%`, width: `${s.widthPct}%` }}
            title={`${minutesEnHHMM(s.debutMinutes)}–${minutesEnHHMM(s.finMinutes)} · ${libelleRdv(s.rdv)}${
              s.deborde ? ' (déborde de la journée)' : ''
            }`}
          />
        ))}
      </div>

      {avecEchelle && (
        <div className="relative h-4 mt-0.5">
          {reperes
            // Un repère collé au bord verrait son libellé déborder de la carte.
            .filter((r) => r.leftPct > 4 && r.leftPct < 96)
            .map((r) => (
              <span
                key={r.minutes}
                className="absolute text-[10px] text-gray-400 -translate-x-1/2"
                style={{ left: `${r.leftPct}%` }}
              >
                {r.heure}h
              </span>
            ))}
        </div>
      )}

      {/* Ce que la barre ne peut pas montrer doit se lire quand même : un RDV
          sans heure occupe le technicien, l'omettre ferait lire un trou libre. */}
      {sansHeure.length > 0 && (
        <p className="text-[11px] text-amber-700 mt-0.5">
          {sansHeure.length} RDV sans heure — non placé{sansHeure.length > 1 ? 's' : ''} sur la barre
        </p>
      )}
    </div>
  );
}

export default JourneeTimeline;
