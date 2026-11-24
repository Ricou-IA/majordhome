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

import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Hourglass, Lock, CheckCircle2, PhoneCall } from 'lucide-react';
import { estTypeAdaptable } from '@/lib/souplesse';
import { etatConfirmation } from '@/lib/confirmationRdv';
import { modeleVignette, HAUTEUR_CRENEAU, HAUTEUR_CRENEAU_TELEPHONE, MARGE_LISERE } from '@/lib/planningVignette';
import { useDeviceClass } from '@hooks/useDeviceClass';
import { EquipmentKindIcons } from '@/apps/artisan/components/shared/EquipmentKindIcons';

// Classes écrites en toutes lettres : Tailwind ne génère pas une classe composée à la volée.
const LIGNES_NOM = { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' };

// Icône de 12 px dans un texte de 12 px à interligne 13 px : jamais une ligne plus haute.
const ICONE_REPERE = 'inline-block h-3 w-3 align-[-1px] shrink-0';

/**
 * Repères d'état en tête de vignette (Eric 2026-11-23 : le cadenas seul « me semble flou ») :
 *   coche       = confirmé au client (client_confirmed_at) ;
 *   téléphone   = à confirmer (posé depuis plus d'un mois, jamais confirmé) ;
 *   cadenas     = heure figée pour la tournée SANS confirmation au client (une journée
 *                 pleine se fige seule la nuit) ;
 *   flèches     = adaptable ; sablier = pose provisoire (appros du chantier non reçues).
 */
function Reperes({ rdv }) {
  const { adaptable, hour_confirmed_at, appointment_type, provisoire } = rdv;
  const { etat, joursDepuisPose } = etatConfirmation(rdv);
  const repere = (Icone, titre) => (
    <span className="inline-flex shrink-0 opacity-90" title={titre} role="img" aria-label={titre}>
      <Icone className={ICONE_REPERE} aria-hidden="true" />
    </span>
  );
  return (
    <>
      {etat === 'confirme'
        ? repere(CheckCircle2, 'Confirmé au client')
        : etat === 'a_confirmer'
          ? repere(PhoneCall, `À confirmer : posé il y a ${joursDepuisPose} jours, client pas encore prévenu`)
          : null}
      {adaptable
        ? repere(ArrowLeftRight, 'Adaptable : l’heure peut glisser dans sa tolérance')
        : (etat !== 'confirme' && estTypeAdaptable(appointment_type) && hour_confirmed_at)
          ? repere(Lock, 'Heure figée pour la tournée — le client ne l’a pas confirmée')
          : null}
      {provisoire && repere(Hourglass, 'Pose provisoire : appros du chantier non reçues')}
    </>
  );
}

/** Largeur du bloc, suivie quand la colonne change (filtre, fenêtre redimensionnée). */
function useLargeur() {
  const ref = useRef(null);
  const [largeur, setLargeur] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    setLargeur(el.getBoundingClientRect().width);
    const obs = new ResizeObserver(([entree]) => setLargeur(Math.round(entree.contentRect.width)));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, largeur];
}

export function PlanningEventContent({ eventInfo }) {
  const { isPhone } = useDeviceClass();
  const [refLargeur, largeur] = useLargeur();
  const { event, view } = eventInfo;
  const rdv = event.extendedProps;
  // Bande de tolérance (événement de fond) : une plage colorée, sans texte.
  if (rdv.band) return null;
  const m = modeleVignette({
    largeur,
    rdv,
    debut: event.start,
    fin: event.end,
    vue: view.type,
    hauteurCreneau: isPhone ? HAUTEUR_CRENEAU_TELEPHONE : HAUTEUR_CRENEAU,
    // Devis fait : le liseré noir prend de la hauteur, le gabarit en tient compte.
    margeSupplementaire: rdv.devisFait ? MARGE_LISERE : 0,
  });
  const enListe = view.type.startsWith('list');
  // Interligne serré dans la grille (c'est lui qui fait tenir 3 lignes dans une heure) ;
  // en liste, le texte suit la taille de la cellule.
  const racine = `h-full overflow-hidden ${enListe ? 'text-xs' : 'text-[13px] leading-[15px]'} ${
    rdv.status === 'cancelled' ? 'opacity-50 line-through' : ''
  }`;
  // Icônes d'équipement : entretien et SAV seulement (règle dans le modèle).
  const icones = m.icones ? <EquipmentKindIcons clientId={rdv.client_id} size="xs" /> : null;
  const heure = m.heure ? <span className="shrink-0 tabular-nums">{m.heure}</span> : null;
  const zoneALaSuite = m.zone
    ? <span className="font-normal opacity-90">{m.nom ? ' · ' : ''}{m.zone}</span>
    : null;

  // Une ligne : tout sur la même, le nom prend la place qui reste.
  if (m.gabarit === 'ligne') {
    return (
      <div ref={refLargeur} className={`${racine} flex items-center gap-1 whitespace-nowrap`} title={m.infobulle}>
        <Reperes rdv={rdv} />
        {heure}
        <span className="shrink-0">{m.type}</span>
        {icones}
        <span className="truncate min-w-0"><span className="font-bold">{m.nom}</span>{zoneALaSuite}</span>
      </div>
    );
  }

  // Resserré (plusieurs personnes ce jour-là) : repères + heure, puis le nom de famille.
  if (m.gabarit === 'etroit') {
    return (
      <div ref={refLargeur} className={racine} title={m.infobulle}>
        {/* L'heure d'abord, entière ; les repères passent à la ligne s'ils ne tiennent pas (recette H7 : « 1… »). */}
        <div className="flex flex-wrap items-center gap-0.5">
          {heure}
          <Reperes rdv={rdv} />
        </div>
        {/* Coupé entre deux syllabes (page en lang="fr"), jamais au hasard d'une lettre (« CORMAR/Y »). */}
        {m.nom && <div className={`font-bold break-words hyphens-auto ${LIGNES_NOM[m.lignesNom] || 'line-clamp-4'}`}>{m.nom}</div>}
      </div>
    );
  }

  // Cadre plein : créneau, puis type en toutes lettres (à la ligne si la colonne est étroite).
  if (m.gabarit === 'plein') {
    return (
      <div ref={refLargeur} className={racine} title={m.infobulle}>
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
      <div ref={refLargeur} className={racine} title={m.infobulle}>
        {entete}
        <div className="truncate"><span className="font-bold">{m.nom}</span>{zoneALaSuite}</div>
      </div>
    );
  }
  return (
    <div ref={refLargeur} className={racine} title={m.infobulle}>
      {entete}
      {m.nom && <div className={`font-bold break-words ${LIGNES_NOM[m.lignesNom]}`}>{m.nom}</div>}
      {m.zone && <div className="truncate font-normal opacity-90">{m.zone}</div>}
    </div>
  );
}
