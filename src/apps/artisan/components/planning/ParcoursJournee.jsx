/**
 * ParcoursJournee.jsx — dans la fenêtre « Nouveau RDV », le parcours de la journée de la
 * personne choisie avec le RDV en cours de pose inséré à son heure : départ, RDV du jour,
 * trajets, retour, et le trajet pour se rendre à ce RDV (Eric 2026-11-11). Un enchaînement
 * intenable (fin du RDV précédent + trajet au-delà du début) est dit « Impossible » : on prévient,
 * on ne bloque pas (`retardsDeLaJournee`).
 *
 * Même calcul que la feuille de route du planning (`useFeuilleDeRoute` : départ / retour par
 * `resoudreExtremites`, trajets Mapbox Directions, repli vol d'oiseau signalé). Rien n'est
 * enregistré : c'est une aide à la décision.
 */

import { useMemo } from 'react';
import { Route, MapPin, Flag, Loader2, AlertTriangle } from 'lucide-react';
import { useFeuilleDeRoute } from '@hooks/useFeuilleDeRoute';
import { formatDureeRoute, formatKm } from '@/lib/feuilleDeRoute';

/**
 * @param {object} p
 * @param {string} p.orgId               org CORE
 * @param {{ date: string, startTime: string, endTime?: string }} p.slot  créneau posé
 * @param {{ ids: string[], displayName: string, color?: string }} p.personne
 * @param {{ lat: number, lng: number }|null} p.coords  lieu du RDV
 * @param {object} p.rdv                 { appointment_type, client_name, client_first_name, address, postal_code, city }
 * @param {boolean} [p.apercu]           tournée telle qu'elle est (clic sur le prénom), sans ce RDV
 */
export function ParcoursJournee({ orgId, slot, personne, coords, rdv, apercu = false }) {
  const ajout = useMemo(() => (coords && !apercu ? {
    ...rdv,
    scheduled_date: slot.date,
    scheduled_start: slot.startTime,
    scheduled_end: slot.endTime || null,
    lat: coords.lat,
    lng: coords.lng,
  } : null), [coords, apercu, rdv, slot.date, slot.startTime, slot.endTime]);
  const person = useMemo(() => ({ displayName: personne.displayName, color: personne.color }), [personne.displayName, personne.color]);

  const { feuille, isLoading, sansDepot } = useFeuilleDeRoute({
    orgId, date: slot.date, memberIds: personne.ids, person, ajout,
  });

  const nouveau = feuille?.items.find((i) => i.nouveau) || null;
  const iNouveau = feuille ? feuille.items.indexOf(nouveau) : -1;
  // Trajet suivant le RDV : vers l'arrêt localisé suivant, sinon le retour
  const arretApres = feuille && iNouveau >= 0 ? feuille.items.slice(iNouveau + 1).find((i) => i.localise) || null : null;
  const suivant = feuille && iNouveau >= 0 ? (arretApres?.trajetAvant || feuille.retour) : null;
  // Impossibilités dues à ce RDV : on n'y arrive pas à l'heure, ou le RDV suivant ne tient plus
  const impossibles = [
    nouveau?.retard && `Arrivée au plus tôt à ${nouveau.retard.arriveeAuPlusTot} pour un début à ${nouveau.time.split(' – ')[0]} (${formatDureeRoute(nouveau.retard.retardMinutes)} de retard).`,
    arretApres?.retard && `Le RDV suivant (${arretApres.clientName || arretApres.typeLabel}, ${arretApres.time.split(' – ')[0]}) ne tient plus : arrivée au plus tôt à ${arretApres.retard.arriveeAuPlusTot}.`,
  ].filter(Boolean);

  return (
    <div className={`rounded-lg border p-3 space-y-2 text-sm ${impossibles.length ? 'border-red-300 bg-red-50/40' : 'border-secondary-200 bg-secondary-50/50'}`}>
      <div className="flex items-center gap-2 font-medium text-secondary-800">
        <Route className="w-4 h-4 text-secondary-500" />
        <span className="truncate">{apercu ? `Tournée de ${personne.displayName} · sans ce RDV` : `Parcours de ${personne.displayName}`}</span>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-secondary-400 ml-auto" />}
      </div>

      {!coords && !apercu ? (
        <p className="text-xs text-amber-700">Adresse du client non localisée : trajet non calculé.</p>
      ) : sansDepot ? (
        <p className="text-xs text-amber-700">Point de départ non renseigné (siège de l’organisation ou départ de la personne) : trajet non calculé.</p>
      ) : feuille ? (
        <>
          {impossibles.length > 0 && (
            <div className="rounded-md bg-red-100 border border-red-300 px-2 py-1.5 text-xs text-red-800 space-y-0.5">
              <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />Impossible à cette heure</p>
              {impossibles.map((m) => <p key={m}>{m}</p>)}
            </div>
          )}
          {nouveau?.trajetAvant && (
            <p className="text-xs text-secondary-700">
              Pour s’y rendre : <span className="font-semibold">{formatDureeRoute(nouveau.trajetAvant.minutes)}</span>
              {' '}({formatKm(nouveau.trajetAvant.km)})
              {suivant ? <> · ensuite {formatDureeRoute(suivant.minutes)}</> : null}
            </p>
          )}
          {apercu && feuille.items.length === 0 && (
            <p className="text-xs text-secondary-500">Aucun RDV ce jour-là.</p>
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
                {it.retard && (
                  <div className="pl-4 text-red-700 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    arrivée au plus tôt {it.retard.arriveeAuPlusTot} (+{formatDureeRoute(it.retard.retardMinutes)})
                  </div>
                )}
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
