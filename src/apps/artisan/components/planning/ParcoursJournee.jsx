/**
 * ParcoursJournee.jsx — dans la fenêtre « Nouveau RDV », le parcours de la journée de la
 * personne choisie avec le RDV en cours de pose inséré à son heure : départ, RDV du jour,
 * trajets, retour, et le trajet pour se rendre à ce RDV (Eric 2026-11-11).
 *
 * Même calcul que la feuille de route du planning (`useFeuilleDeRoute` : départ / retour par
 * `resoudreExtremites`, trajets Mapbox Directions, repli vol d'oiseau signalé). Rien n'est
 * enregistré : c'est une aide à la décision.
 */

import { useMemo } from 'react';
import { Route, MapPin, Flag, Loader2 } from 'lucide-react';
import { useFeuilleDeRoute } from '@hooks/useFeuilleDeRoute';
import { formatDureeRoute, formatKm } from '@/lib/feuilleDeRoute';

/**
 * @param {object} p
 * @param {string} p.orgId               org CORE
 * @param {{ date: string, startTime: string, endTime?: string }} p.slot  créneau posé
 * @param {{ ids: string[], displayName: string, color?: string }} p.personne
 * @param {{ lat: number, lng: number }|null} p.coords  lieu du RDV
 * @param {object} p.rdv                 { appointment_type, client_name, client_first_name, address, postal_code, city }
 */
export function ParcoursJournee({ orgId, slot, personne, coords, rdv }) {
  const ajout = useMemo(() => (coords ? {
    ...rdv,
    scheduled_date: slot.date,
    scheduled_start: slot.startTime,
    scheduled_end: slot.endTime || null,
    lat: coords.lat,
    lng: coords.lng,
  } : null), [coords, rdv, slot.date, slot.startTime, slot.endTime]);
  const person = useMemo(() => ({ displayName: personne.displayName, color: personne.color }), [personne.displayName, personne.color]);

  const { feuille, isLoading, sansDepot } = useFeuilleDeRoute({
    orgId, date: slot.date, memberIds: personne.ids, person, ajout,
  });

  const nouveau = feuille?.items.find((i) => i.nouveau) || null;
  const iNouveau = feuille ? feuille.items.indexOf(nouveau) : -1;
  // Trajet suivant le RDV : vers l'arrêt localisé suivant, sinon le retour
  const suivant = feuille && iNouveau >= 0
    ? (feuille.items.slice(iNouveau + 1).find((i) => i.localise)?.trajetAvant || feuille.retour)
    : null;

  return (
    <div className="rounded-lg border border-secondary-200 bg-secondary-50/50 p-3 space-y-2 text-sm">
      <div className="flex items-center gap-2 font-medium text-secondary-800">
        <Route className="w-4 h-4 text-secondary-500" />
        <span className="truncate">Parcours de {personne.displayName}</span>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-secondary-400 ml-auto" />}
      </div>

      {!coords ? (
        <p className="text-xs text-amber-700">Adresse du client non localisée : trajet non calculé.</p>
      ) : sansDepot ? (
        <p className="text-xs text-amber-700">Point de départ non renseigné (siège de l’organisation ou départ de la personne) : trajet non calculé.</p>
      ) : feuille ? (
        <>
          {nouveau?.trajetAvant && (
            <p className="text-xs text-secondary-700">
              Pour s’y rendre : <span className="font-semibold">{formatDureeRoute(nouveau.trajetAvant.minutes)}</span>
              {' '}({formatKm(nouveau.trajetAvant.km)})
              {suivant ? <> · ensuite {formatDureeRoute(suivant.minutes)}</> : null}
            </p>
          )}
          <ol className="space-y-1 text-xs">
            <li className="flex items-center gap-1.5 text-secondary-500"><MapPin className="w-3 h-3" />{feuille.departLabel}</li>
            {feuille.items.map((it) => (
              <li key={it.id} className="space-y-0.5">
                {it.trajetAvant && (
                  <div className="pl-4 text-secondary-400">↓ {formatDureeRoute(it.trajetAvant.minutes)} · {formatKm(it.trajetAvant.km)}</div>
                )}
                <div className={`flex gap-1.5 rounded px-1.5 py-0.5 ${it.nouveau ? 'bg-primary-50 text-primary-800 font-semibold ring-1 ring-primary-200' : 'text-secondary-700'}`}>
                  <span className="tabular-nums shrink-0">{it.time}</span>
                  <span className="truncate">{it.nouveau ? `Ce RDV · ${it.clientName || ''}` : (it.clientName || it.typeLabel)}</span>
                </div>
                {!it.localise && <div className="pl-4 text-amber-700">adresse non localisée</div>}
              </li>
            ))}
            {feuille.retour && (
              <div className="pl-4 text-secondary-400">↓ {formatDureeRoute(feuille.retour.minutes)} · {formatKm(feuille.retour.km)}</div>
            )}
            <li className="flex items-center gap-1.5 text-secondary-500"><Flag className="w-3 h-3" />{feuille.retourLabel}</li>
          </ol>
          {feuille.totaux && (
            <p className="text-xs text-secondary-600 border-t border-secondary-200 pt-1.5">
              Journée : <span className="font-semibold">{formatDureeRoute(feuille.totaux.minutes)}</span> de route · {formatKm(feuille.totaux.km)}
              {feuille.estime ? ' (estimé à vol d’oiseau)' : ''}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

export default ParcoursJournee;
