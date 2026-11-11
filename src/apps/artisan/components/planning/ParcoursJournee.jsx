/**
 * ParcoursJournee.jsx — dans la fenêtre « Nouveau RDV », la journée de la personne choisie
 * avec le RDV en cours de pose inséré à son heure (ou telle qu'elle est : `apercu`, clic sur
 * son prénom). Enveloppe de `FeuilleDeRouteSection` en variante compacte : même modèle, même
 * carte, mêmes heures de départ / retour et mêmes décalages que la feuille de route du
 * planning — une seule source (Eric 2026-11-11). Rien n'est enregistré.
 */

import { useMemo } from 'react';
import { Route } from 'lucide-react';
import { FeuilleDeRouteSection } from './FeuilleDeRouteSection';

/**
 * @param {object} p
 * @param {{ date: string, startTime: string|null, endTime?: string }} p.slot  créneau posé (aperçu : startTime null)
 * @param {{ ids: string[], displayName: string, color?: string }} p.personne
 * @param {{ lat: number, lng: number }|null} p.coords  lieu du RDV
 * @param {object} p.rdv  { appointment_type, client_name, client_first_name, address, postal_code, city }
 * @param {boolean} [p.apercu]  tournée telle qu'elle est, sans ce RDV
 * @param {Function} [p.onDecalage]  remonte les décalages qu'impliquerait la pose (cf. FeuilleDeRouteSection)
 * @param {string} [p.titre]  titre imposé (option de comparaison)
 * @param {import('react').ReactNode} [p.children]  pied du bloc liste (boutons Choisir / Ajouter)
 * @param {'tout'|'liste'|'carte'} [p.partie]  bloc affiché (la fenêtre « Nouveau RDV » sépare carte et liste)
 */
export function ParcoursJournee({ slot, personne, coords, rdv, apercu = false, partie = 'tout', titre = null, children = null, onDecalage = null }) {
  const ajout = useMemo(() => (coords && !apercu ? {
    ...rdv,
    scheduled_date: slot.date,
    scheduled_start: slot.startTime,
    scheduled_end: slot.endTime || null,
    lat: coords.lat,
    lng: coords.lng,
  } : null), [coords, apercu, rdv, slot.date, slot.startTime, slot.endTime]);
  const person = useMemo(() => ({ displayName: personne.displayName, color: personne.color }), [personne.displayName, personne.color]);
  const idsKey = personne.ids.join(',');
  const memberIds = useMemo(() => idsKey.split(','), [idsKey]);

  return (
    <div className="rounded-lg border border-secondary-200 bg-white p-2 space-y-1.5">
      <p className="flex items-center gap-2 text-sm font-medium text-secondary-800">
        <Route className="w-4 h-4 text-secondary-500 shrink-0" />
        <span className="truncate">
          {partie === 'carte' ? 'Carte · ' : ''}
          {titre || (apercu ? `Tournée de ${personne.displayName} · sans ce RDV` : `Parcours de ${personne.displayName}`)}
        </span>
      </p>
      {partie !== 'carte' && !coords && !apercu && (
        <p className="text-xs text-amber-700">Adresse du client non localisée : ce RDV est hors itinéraire.</p>
      )}
      <FeuilleDeRouteSection date={slot.date} memberIds={memberIds} person={person} ajout={ajout} compact partie={partie} onDecalage={onDecalage} />
      {partie !== 'carte' && children}
    </div>
  );
}

export default ParcoursJournee;
