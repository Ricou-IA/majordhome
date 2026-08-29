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
 * Deux modes, une seule barre (deux composants divergeraient) :
 *   - lecture (carte de la liste) : blocs en `div`, aucun handler. La carte est
 *     elle-même un `<button>` — y imbriquer un bouton serait invalide.
 *   - interactif (`onDecaler` fourni, panneau de remplissage) : chaque RDV se
 *     glisse à la souris/au doigt ou aux flèches du clavier, par pas de 15 min.
 *
 * ⚠️ Le glissement ne déplace RIEN en base ici : il remonte une intention au
 * parent, qui l'applique en mémoire (`appliquerDecalages`) et ne l'écrit qu'au
 * moment de poser. Une heure de RDV est une heure annoncée à un client : elle
 * ne bouge pas parce qu'un doigt a glissé sur un écran.
 *
 * Tout le placement et toutes les bornes viennent de `src/lib/tournee/
 * timeline.js` (module pur testé) — y compris la règle « un RDV non plaçable
 * se montre par un autre canal plutôt que de disparaître ».
 * ============================================================================
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  construireSegments, graduations, creneauxLibres, bornesDeplacement,
} from '@/lib/tournee/timeline.js';
import { minutesEnHHMM, formatDuree } from './tourneesPanelUtils';

/** Pas de déplacement. Au pixel près, on écrirait « 09:07 » à un client. */
export const PAS_DECALAGE_MINUTES = 15;

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

const arrondiAuPas = (m) => Math.round(m / PAS_DECALAGE_MINUTES) * PAS_DECALAGE_MINUTES;

/**
 * @param {object} props
 * @param {{debut: number, fin: number}} props.amplitude  minutes depuis minuit
 * @param {Array<object>} props.rdvs   `journee.rdvs`, décalages DÉJÀ appliqués
 * @param {boolean} [props.avecEchelle=true]  repères horaires sous la barre
 * @param {Function} [props.onDecaler]  (rdvId, deltaMinutes) => void — active le
 *   mode interactif. `deltaMinutes` est le déplacement DE CE GESTE, à cumuler
 *   par l'appelant : la barre ne connaît pas l'historique des décalages.
 */
export function JourneeTimeline({
  amplitude, rdvs, avecEchelle = true, onDecaler,
}) {
  const interactif = typeof onDecaler === 'function';
  const barreRef = useRef(null);
  // Position provisoire pendant le geste. Le parent n'est prévenu qu'au
  // relâchement : `sequencerTournee` énumère jusqu'à 40 320 ordres, le
  // rejouer à chaque pixel figerait l'écran.
  const [drag, setDrag] = useState(null); // { id, debutMinutes, depuis, bornes }

  const base = useMemo(() => construireSegments(rdvs, amplitude), [rdvs, amplitude]);
  const reperes = useMemo(() => graduations(amplitude, 120), [amplitude]);

  // Segments affichés = segments réels, sauf celui qu'on est en train de
  // glisser, montré à sa position provisoire.
  const segments = useMemo(() => {
    if (!drag) return base.segments;
    return base.segments.map((s) => (s.id !== drag.id ? s : {
      ...s,
      debutMinutes: drag.debutMinutes,
      finMinutes: drag.debutMinutes + (s.finMinutes - s.debutMinutes),
      leftPct: ((drag.debutMinutes - amplitude.debut) / base.span) * 100,
    }));
  }, [base, drag, amplitude]);

  const trous = useMemo(() => creneauxLibres(segments, amplitude), [segments, amplitude]);

  const minutesParPixel = useCallback(() => {
    const largeur = barreRef.current?.getBoundingClientRect().width || 0;
    return largeur > 0 ? base.span / largeur : 0;
  }, [base.span]);

  const onPointerDown = useCallback((e, segment) => {
    if (!interactif) return;
    const bornes = bornesDeplacement(base.segments, segment.id, amplitude);
    if (!bornes) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({
      id: segment.id,
      debutMinutes: segment.debutMinutes,
      depuis: { x: e.clientX, debutMinutes: segment.debutMinutes },
      bornes,
    });
  }, [interactif, base.segments, amplitude]);

  const onPointerMove = useCallback((e) => {
    if (!drag) return;
    const ratio = minutesParPixel();
    if (!ratio) return;
    const brut = drag.depuis.debutMinutes + (e.clientX - drag.depuis.x) * ratio;
    const cible = Math.min(
      Math.max(arrondiAuPas(brut), drag.bornes.minDebut),
      drag.bornes.maxDebut,
    );
    if (cible !== drag.debutMinutes) setDrag((d) => (d ? { ...d, debutMinutes: cible } : d));
  }, [drag, minutesParPixel]);

  const terminerDrag = useCallback(() => {
    if (!drag) return;
    const delta = drag.debutMinutes - drag.depuis.debutMinutes;
    setDrag(null);
    if (delta !== 0) onDecaler(drag.id, delta);
  }, [drag, onDecaler]);

  // Clavier : un déplacement qui change l'heure promise à un client doit être
  // atteignable autrement qu'au geste — et c'est aussi le moyen le plus précis.
  const onKeyDown = useCallback((e, segment) => {
    if (!interactif) return;
    const sens = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!sens) return;
    e.preventDefault();
    const bornes = bornesDeplacement(base.segments, segment.id, amplitude);
    if (!bornes) return;
    const cible = Math.min(
      Math.max(segment.debutMinutes + sens * PAS_DECALAGE_MINUTES, bornes.minDebut),
      bornes.maxDebut,
    );
    const delta = cible - segment.debutMinutes;
    if (delta !== 0) onDecaler(segment.id, delta);
  }, [interactif, base.segments, amplitude, onDecaler]);

  // Amplitude inexploitable : pas de barre inventée. On dit ce qu'on a.
  if (base.span <= 0) {
    return (
      <p className="text-xs text-gray-400 italic">
        Horaires de la journée non exploitables — {(rdvs?.length ?? 0)} RDV non placés.
      </p>
    );
  }

  const meilleurTrou = trous.length > 0
    ? trous.reduce((a, b) => (b.dureeMinutes > a.dureeMinutes ? b : a))
    : null;

  return (
    <div>
      <div
        ref={barreRef}
        className={`relative rounded bg-gray-100 overflow-hidden ${interactif ? 'h-10' : 'h-7'}`}
      >
        {/* Le plus grand trou est souligné : c'est la réponse à « où ça rentre ? ».
            Rendu SOUS les blocs, jamais par-dessus. */}
        {meilleurTrou && meilleurTrou.dureeMinutes >= 60 && (
          <div
            className="absolute inset-y-0 bg-emerald-50 border-x border-emerald-200"
            style={{ left: `${meilleurTrou.leftPct}%`, width: `${meilleurTrou.widthPct}%` }}
            title={`Libre ${minutesEnHHMM(meilleurTrou.debutMinutes)}–${minutesEnHHMM(meilleurTrou.finMinutes)} (${formatDuree(meilleurTrou.dureeMinutes)})`}
          />
        )}

        {reperes.map((r) => (
          <div
            key={r.minutes}
            className="absolute inset-y-0 w-px bg-white/70"
            style={{ left: `${r.leftPct}%` }}
          />
        ))}

        {segments.map((s) => {
          const decale = s.rdv.decalageMinutes || 0;
          const style = { left: `${s.leftPct}%`, width: `${s.widthPct}%` };
          const classes = [
            'absolute inset-y-0 flex items-center justify-center overflow-hidden',
            COULEUR_BLOC[s.rdv.appointment_type] || COULEUR_BLOC_DEFAUT,
            s.deborde ? 'ring-1 ring-inset ring-amber-400' : '',
            decale ? 'ring-2 ring-inset ring-emerald-500' : '',
            interactif ? 'cursor-grab active:cursor-grabbing touch-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-900' : '',
            drag?.id === s.id ? 'opacity-90 shadow-lg' : '',
          ].filter(Boolean).join(' ');
          const infobulle = `${minutesEnHHMM(s.debutMinutes)}–${minutesEnHHMM(s.finMinutes)} · ${libelleRdv(s.rdv)}`
            + (s.deborde ? ' (déborde de la journée)' : '')
            + (decale ? ` · décalé de ${formatDuree(decale)}` : '')
            + (interactif ? ' — glisser ou flèches ← → pour décaler' : '');
          // Un libellé dans un bloc étroit serait tronqué en bouillie.
          const etiquette = s.widthPct >= 12 ? minutesEnHHMM(s.debutMinutes) : null;

          if (!interactif) {
            return (
              <div key={s.id} className={classes} style={style} title={infobulle}>
                {etiquette && (
                  <span className="text-[10px] font-medium text-white/90">{etiquette}</span>
                )}
              </div>
            );
          }
          return (
            <button
              key={s.id}
              type="button"
              className={classes}
              style={style}
              title={infobulle}
              aria-label={infobulle}
              onPointerDown={(e) => onPointerDown(e, s)}
              onPointerMove={onPointerMove}
              onPointerUp={terminerDrag}
              onPointerCancel={terminerDrag}
              onKeyDown={(e) => onKeyDown(e, s)}
            >
              {etiquette && (
                <span className="text-[10px] font-medium text-white/90 pointer-events-none">
                  {etiquette}
                </span>
              )}
            </button>
          );
        })}
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
      {base.sansHeure.length > 0 && (
        <p className="text-[11px] text-amber-700 mt-0.5">
          {base.sansHeure.length} RDV sans heure — non placé{base.sansHeure.length > 1 ? 's' : ''} sur la barre
        </p>
      )}
    </div>
  );
}

export default JourneeTimeline;
