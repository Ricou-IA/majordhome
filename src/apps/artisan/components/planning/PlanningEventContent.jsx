/**
 * PlanningEventContent.jsx - Majord'home Artisan
 * ============================================================================
 * Vignette d'un RDV dans le calendrier. Le gabarit dépend de la place du bloc
 * (durée du RDV) : une ligne pour un SAV de 30 min, le cadre entier pour une
 * installation. Tout ce qui est affiché vient de modeleVignette()
 * (src/lib/planningVignette.js, pur et testé) — ici, on ne fait que dessiner.
 *
 * Vrai composant React (pas une simple fonction de rendu) : EquipmentKindIcons
 * lit le cache des équipements du client par un hook.
 * ============================================================================
 */

import { estTypeAdaptable } from '@/lib/souplesse';
import { modeleVignette, HAUTEUR_CRENEAU, HAUTEUR_CRENEAU_TELEPHONE } from '@/lib/planningVignette';
import { useDeviceClass } from '@hooks/useDeviceClass';
import { EquipmentKindIcons } from '@/apps/artisan/components/shared/EquipmentKindIcons';

// Classes écrites en toutes lettres : Tailwind ne génère pas une classe composée à la volée.
const LIGNES_NOM = { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3' };

/** Repères d'état en tête de vignette : souplesse, heure communiquée, pose provisoire. */
function Reperes({ rdv }) {
  const { adaptable, hour_confirmed_at, appointment_type, provisoire } = rdv;
  return (
    <>
      {adaptable ? (
        <span className="shrink-0 opacity-90" title="Adaptable : l’heure peut glisser dans sa tolérance">↔</span>
      ) : (estTypeAdaptable(appointment_type) && hour_confirmed_at) ? (
        <span className="shrink-0 opacity-90" title="Heure communiquée au client">🔒</span>
      ) : null}
      {provisoire && (
        <span className="shrink-0 opacity-90" title="Pose provisoire : appros du chantier non reçues">⏳</span>
      )}
    </>
  );
}

export function PlanningEventContent({ eventInfo }) {
  const { isPhone } = useDeviceClass();
  const { event, view } = eventInfo;
  const rdv = event.extendedProps;
  // Bande de tolérance (événement de fond) : une plage colorée, sans texte.
  if (rdv.band) return null;
  const m = modeleVignette({
    rdv,
    debut: event.start,
    fin: event.end,
    vue: view.type,
    hauteurCreneau: isPhone ? HAUTEUR_CRENEAU_TELEPHONE : HAUTEUR_CRENEAU,
  });
  const enListe = view.type.startsWith('list');
  // Interligne serré dans la grille (c'est lui qui fait tenir 3 lignes dans une heure) ;
  // en liste, le texte suit la taille de la cellule.
  const racine = `h-full overflow-hidden text-xs ${enListe ? '' : 'leading-[13px]'} ${
    rdv.status === 'cancelled' ? 'opacity-50 line-through' : ''
  }`;
  const icones = <EquipmentKindIcons clientId={rdv.client_id} size="xs" />;
  const heure = m.heure ? <span className="shrink-0 tabular-nums">{m.heure}</span> : null;
  const zoneALaSuite = m.zone
    ? <span className="font-normal opacity-90">{m.nom ? ' · ' : ''}{m.zone}</span>
    : null;

  // Une ligne : tout sur la même, le nom prend la place qui reste.
  if (m.gabarit === 'ligne') {
    return (
      <div className={`${racine} flex items-center gap-1 whitespace-nowrap`} title={m.infobulle}>
        <Reperes rdv={rdv} />
        {heure}
        <span className="shrink-0">{m.type}</span>
        {icones}
        <span className="truncate min-w-0"><span className="font-bold">{m.nom}</span>{zoneALaSuite}</span>
      </div>
    );
  }

  // Cadre plein : créneau, puis type en toutes lettres (à la ligne si la colonne est étroite).
  if (m.gabarit === 'plein') {
    return (
      <div className={racine} title={m.infobulle}>
        <div className="flex flex-wrap items-center gap-x-1">
          <Reperes rdv={rdv} />
          {heure}
          <span className="inline-flex items-center gap-1 min-w-0">
            <span className="truncate">{m.type}</span>
            {icones}
          </span>
        </div>
        {m.nom && <div className={`font-bold break-words ${LIGNES_NOM[m.lignesNom]}`}>{m.nom}</div>}
        {m.zone && <div className="truncate font-normal opacity-90">{m.zone}</div>}
      </div>
    );
  }

  // Deux et trois lignes : créneau · type court · icônes, puis le nom ; la zone suit
  // le nom (deux lignes) ou prend sa propre ligne (trois lignes et plus).
  const entete = (
    <div className="flex items-center gap-1 whitespace-nowrap">
      <Reperes rdv={rdv} />
      {heure}
      <span className="truncate min-w-0">{m.type}</span>
      {icones}
    </div>
  );
  if (m.gabarit === 'deux') {
    return (
      <div className={racine} title={m.infobulle}>
        {entete}
        <div className="truncate"><span className="font-bold">{m.nom}</span>{zoneALaSuite}</div>
      </div>
    );
  }
  return (
    <div className={racine} title={m.infobulle}>
      {entete}
      {m.nom && <div className={`font-bold break-words ${LIGNES_NOM[m.lignesNom]}`}>{m.nom}</div>}
      {m.zone && <div className="truncate font-normal opacity-90">{m.zone}</div>}
    </div>
  );
}
