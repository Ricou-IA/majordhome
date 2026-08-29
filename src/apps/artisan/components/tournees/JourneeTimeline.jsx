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
 *   - lecture : blocs en `div`, aucun handler.
 *   - interactif (`onAjuster` fourni — carte de la liste comme panneau de
 *     remplissage) : chaque RDV se DÉPLACE (corps du bloc, ou flèches ← →) et
 *     se RACCOURCIT (poignée droite, ou Maj + flèches), par pas de 15 min.
 *     Raccourcir une intervention est l'autre façon de faire de la place.
 *
 * En mode interactif, les blocs sont des `<button>` : l'élément qui contient
 * cette barre ne doit donc jamais en être un lui-même (cf. `JourneeCard`, dont
 * seul l'en-tête est cliquable).
 *
 * Survoler un bloc ouvre sa carte (`BlocRdvCard`) sous la barre — qui, où,
 * quoi, quand, combien de temps. L'infobulle native qu'elle remplace empilait
 * tout sur une ligne et y mêlait la consigne d'usage ; celle-ci est écrite une
 * fois en en-tête, elle n'a rien à faire sur chaque bloc.
 *
 * `apercus` dessine par-dessus les entretiens PAS ENCORE POSÉS, à la place que
 * le moteur leur a trouvée. C'est la réponse à « où le caler ? » : on voit le
 * client entrer dans le trou, entre quels rendez-vous et à quelle heure, au
 * lieu de le déduire d'une ligne de liste.
 *
 * ⚠️ Un ajustement ne déplace RIEN en base ici : il remonte une intention au
 * parent, qui l'applique en mémoire (`appliquerAjustements`) et ne l'écrit que
 * sur un geste explicite. Une heure de RDV est une heure annoncée à un client :
 * elle ne bouge pas parce qu'un doigt a glissé sur un écran.
 * ============================================================================
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  construireSegments, graduations, creneauxLibres, bornesDeplacement, bornesDuree,
  trajetDepuisPrecedent,
} from '@/lib/tournee/timeline.js';
import { minutesEnHHMM, formatDuree } from './tourneesPanelUtils';
import { BlocRdvCard } from './BlocRdvCard';

/** Pas d'ajustement. Au pixel près, on écrirait « 09:07 » à un client. */
export const PAS_AJUSTEMENT_MINUTES = 15;

/**
 * Largeur minimale (% de la barre) pour écrire l'heure dans un bloc. En dessous,
 * seule la carte de survol la porte. 8 % ≈ 48 min sur une journée de 10 h : un
 * entretien d'une heure garde donc son heure lisible. Un bloc VIDE se lit comme
 * une donnée manquante, ce qui est pire qu'un libellé serré.
 */
const SEUIL_ETIQUETTE_PCT = 8;

// Un entretien est ce que ce module pose : il se distingue du reste de la
// journée (installation, SAV, visite technique), qui n'est ici qu'un obstacle
// à contourner. La couleur ne porte jamais l'information seule — la carte de
// survol énonce le type en toutes lettres.
const COULEUR_BLOC = {
  maintenance: 'bg-blue-500',
  service: 'bg-violet-400',
};
const COULEUR_BLOC_DEFAUT = 'bg-slate-400';

const arrondiAuPas = (m) => Math.round(m / PAS_AJUSTEMENT_MINUTES) * PAS_AJUSTEMENT_MINUTES;

/**
 * @param {object} props
 * @param {{debut: number, fin: number}} props.amplitude  minutes depuis minuit
 * @param {Array<object>} props.rdvs   `journee.rdvs`, ajustements DÉJÀ appliqués
 * @param {boolean} [props.avecEchelle=true]  repères horaires sous la barre
 * @param {Function} [props.onAjuster]  (rdvId, { deltaMinutes?, dureeMinutes? }) => void
 *   — active le mode interactif. `deltaMinutes` est le déplacement DE CE GESTE,
 *   à cumuler par l'appelant ; `dureeMinutes` est la nouvelle durée ABSOLUE
 *   (elle se remplace, elle ne se cumule pas).
 * @param {Array<{id, debutMinutes, finMinutes, label, pressenti?}>} [props.apercus]
 *   Entretiens PAS ENCORE POSÉS, dessinés en surimpression.
 */
export function JourneeTimeline({
  amplitude, rdvs, avecEchelle = true, onAjuster, apercus,
}) {
  const interactif = typeof onAjuster === 'function';
  const barreRef = useRef(null);
  // Position provisoire pendant le geste. Le parent n'est prévenu qu'au
  // relâchement : chaque ajustement relance le classement des candidats (la clé
  // de cache porte l'empreinte des créneaux), le rejouer à chaque pixel
  // enverrait une rafale de calculs pour rien.
  const [geste, setGeste] = useState(null); // { id, mode, valeur, depuis, bornes }
  const [survoleId, setSurvoleId] = useState(null);

  const base = useMemo(() => construireSegments(rdvs, amplitude), [rdvs, amplitude]);
  const reperes = useMemo(() => graduations(amplitude, 120), [amplitude]);

  // Segments affichés = segments réels, sauf celui qu'on manipule, montré à sa
  // position (ou sa durée) provisoire.
  const segments = useMemo(() => {
    if (!geste) return base.segments;
    return base.segments.map((s) => {
      if (s.id !== geste.id) return s;
      const duree = geste.mode === 'duree' ? geste.valeur : (s.finMinutes - s.debutMinutes);
      const debut = geste.mode === 'debut' ? geste.valeur : s.debutMinutes;
      return {
        ...s,
        debutMinutes: debut,
        finMinutes: debut + duree,
        leftPct: ((debut - amplitude.debut) / base.span) * 100,
        widthPct: Math.max((duree / base.span) * 100, 1.5),
      };
    });
  }, [base, geste, amplitude]);

  const trous = useMemo(() => creneauxLibres(segments, amplitude), [segments, amplitude]);

  const minutesParPixel = useCallback(() => {
    const largeur = barreRef.current?.getBoundingClientRect().width || 0;
    return largeur > 0 ? base.span / largeur : 0;
  }, [base.span]);

  const demarrerGeste = useCallback((e, segment, mode) => {
    if (!interactif) return;
    const bornes = mode === 'debut'
      ? bornesDeplacement(base.segments, segment.id, amplitude)
      : bornesDuree(base.segments, segment.id, amplitude);
    if (!bornes) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const valeur = mode === 'debut'
      ? segment.debutMinutes
      : segment.finMinutes - segment.debutMinutes;
    setGeste({ id: segment.id, mode, valeur, depuis: { x: e.clientX, valeur }, bornes });
  }, [interactif, base.segments, amplitude]);

  const onPointerMove = useCallback((e) => {
    if (!geste) return;
    const ratio = minutesParPixel();
    if (!ratio) return;
    const brut = geste.depuis.valeur + (e.clientX - geste.depuis.x) * ratio;
    const [mini, maxi] = geste.mode === 'debut'
      ? [geste.bornes.minDebut, geste.bornes.maxDebut]
      : [geste.bornes.minDuree, geste.bornes.maxDuree];
    const cible = Math.min(Math.max(arrondiAuPas(brut), mini), maxi);
    if (cible !== geste.valeur) setGeste((g) => (g ? { ...g, valeur: cible } : g));
  }, [geste, minutesParPixel]);

  const terminerGeste = useCallback(() => {
    if (!geste) return;
    const {
      id, mode, valeur, depuis,
    } = geste;
    setGeste(null);
    if (valeur === depuis.valeur) return;
    if (mode === 'debut') onAjuster(id, { deltaMinutes: valeur - depuis.valeur });
    else onAjuster(id, { dureeMinutes: valeur });
  }, [geste, onAjuster]);

  // Clavier : un ajustement qui change ce qu'un client attend doit être
  // atteignable autrement qu'au geste — et c'est le moyen le plus précis.
  // Flèches = déplacer, Maj + flèches = raccourcir/rallonger.
  const onKeyDown = useCallback((e, segment) => {
    if (!interactif) return;
    const sens = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!sens) return;
    e.preventDefault();
    const pas = sens * PAS_AJUSTEMENT_MINUTES;

    if (e.shiftKey) {
      const bornes = bornesDuree(base.segments, segment.id, amplitude);
      if (!bornes) return;
      const actuelle = segment.finMinutes - segment.debutMinutes;
      const cible = Math.min(Math.max(actuelle + pas, bornes.minDuree), bornes.maxDuree);
      if (cible !== actuelle) onAjuster(segment.id, { dureeMinutes: cible });
      return;
    }

    const bornes = bornesDeplacement(base.segments, segment.id, amplitude);
    if (!bornes) return;
    const cible = Math.min(
      Math.max(segment.debutMinutes + pas, bornes.minDebut),
      bornes.maxDebut,
    );
    if (cible !== segment.debutMinutes) {
      onAjuster(segment.id, { deltaMinutes: cible - segment.debutMinutes });
    }
  }, [interactif, base.segments, amplitude, onAjuster]);

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
  const survole = segments.find((s) => s.id === (geste?.id || survoleId));
  // Trajet depuis le RDV précédent, calculé sur les segments RÉELS (pas ceux
  // du geste en cours) : c'est l'écart du planning tel qu'il est posé.
  const trajetBrut = survole ? trajetDepuisPrecedent(base.segments, survole.id) : null;
  const trajetSurvole = trajetBrut ? {
    ...trajetBrut,
    depuis: base.segments.find((s) => s.id === trajetBrut.depuisId)?.rdv?.client_name
      || 'l\u2019arrêt précédent',
  } : null;

  return (
    <div className="relative">
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
          const raccourci = s.rdv.dureeInitialeMinutes != null;
          const style = { left: `${s.leftPct}%`, width: `${s.widthPct}%` };
          const classes = [
            'absolute inset-y-0 flex items-center justify-center overflow-hidden',
            COULEUR_BLOC[s.rdv.appointment_type] || COULEUR_BLOC_DEFAUT,
            s.deborde ? 'ring-1 ring-inset ring-amber-400' : '',
            (decale || raccourci) ? 'ring-2 ring-inset ring-emerald-500' : '',
            interactif ? 'group cursor-grab active:cursor-grabbing touch-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-900' : '',
            geste?.id === s.id ? 'opacity-90 shadow-lg' : '',
          ].filter(Boolean).join(' ');
          const etiquette = s.widthPct >= SEUIL_ETIQUETTE_PCT ? minutesEnHHMM(s.debutMinutes) : null;
          // Description pour les lecteurs d'écran : la carte de survol porte la
          // même chose à l'œil.
          const description = `${minutesEnHHMM(s.debutMinutes)}–${minutesEnHHMM(s.finMinutes)}`
            + ` · ${s.rdv.client_name || 'sans client'}`
            + ` · ${formatDuree(s.finMinutes - s.debutMinutes)}`;

          if (!interactif) {
            return (
              <div
                key={s.id}
                className={classes}
                style={style}
                onMouseEnter={() => setSurvoleId(s.id)}
                onMouseLeave={() => setSurvoleId(null)}
              >
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
              aria-label={`${description} — flèches pour décaler, Maj + flèches pour ajuster la durée`}
              onPointerDown={(e) => demarrerGeste(e, s, 'debut')}
              onPointerMove={onPointerMove}
              onPointerUp={terminerGeste}
              onPointerCancel={terminerGeste}
              onKeyDown={(e) => onKeyDown(e, s)}
              onMouseEnter={() => setSurvoleId(s.id)}
              onMouseLeave={() => setSurvoleId(null)}
            >
              {etiquette && (
                <span className="text-[10px] font-medium text-white/90 pointer-events-none">
                  {etiquette}
                </span>
              )}
              {/* Poignée de durée : raccourcir une intervention est l'autre
                  façon de faire de la place. Rendue en dernier pour passer
                  au-dessus de l'étiquette.
                  ⚠️ Invisible tant que le bloc n'est pas survolé : en zone
                  teintée permanente au bord du bloc, elle se lisait comme une
                  DONNÉE (« l'espace plus foncé, c'est le transport ? », 31/08).
                  Un élément d'interaction ne doit jamais pouvoir passer pour
                  une part du planning. */}
              <span
                role="presentation"
                className="absolute inset-y-0 right-0 w-2.5 flex items-center justify-center cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity"
                onPointerDown={(e) => demarrerGeste(e, s, 'duree')}
                onPointerMove={onPointerMove}
                onPointerUp={terminerGeste}
                onPointerCancel={terminerGeste}
              >
                <span className="w-0.5 h-3.5 rounded-full bg-white/90" />
              </span>
            </button>
          );
        })}

        {/* Entretiens en attente de pose : au-dessus des blocs existants, en
            pointillés — jamais confondus avec un RDV réellement posé. */}
        {(apercus || []).map((a) => {
          const gauche = ((Math.max(a.debutMinutes, amplitude.debut) - amplitude.debut) / base.span) * 100;
          const largeur = ((Math.min(a.finMinutes, amplitude.fin)
            - Math.max(a.debutMinutes, amplitude.debut)) / base.span) * 100;
          if (largeur <= 0) return null;
          return (
            <div
              key={`apercu-${a.id}`}
              className={`absolute inset-y-0 rounded-sm border-2 border-dashed border-emerald-600 ${
                a.pressenti ? 'bg-emerald-200/50' : 'bg-emerald-300/80'
              } flex items-center justify-center overflow-hidden`}
              style={{ left: `${gauche}%`, width: `${Math.max(largeur, 1.5)}%` }}
              title={`À poser · ${minutesEnHHMM(a.debutMinutes)}–${minutesEnHHMM(a.finMinutes)} · ${a.label}`}
            >
              {largeur >= SEUIL_ETIQUETTE_PCT && (
                <span className="text-[10px] font-semibold text-emerald-900 pointer-events-none">
                  {minutesEnHHMM(a.debutMinutes)}
                </span>
              )}
            </div>
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

      {/* Carte du RDV survolé (ou manipulé) : elle flotte sous la barre, hors du
          conteneur qui rogne, et ne capte pas le pointeur — sinon elle
          couperait le geste en cours dès qu'elle apparaît sous le curseur.
          Alignée sur son bloc plutôt qu'étalée sur toute la largeur, et bornée
          à 70 % pour ne pas sortir du cadre côté droit. */}
      {survole && (
        <div
          className="absolute top-full z-20 pointer-events-none"
          style={{ left: `${Math.min(survole.leftPct, 70)}%` }}
        >
          <BlocRdvCard
            rdv={survole.rdv}
            debutMinutes={survole.debutMinutes}
            finMinutes={survole.finMinutes}
            trajet={trajetSurvole}
          />
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
