/**
 * BlocRdvCard.jsx - Majord'home Artisan
 * ============================================================================
 * Carte d'un rendez-vous, affichée au survol de son bloc sur la barre horaire.
 * Remplace l'infobulle native du navigateur, qui empilait tout sur une ligne
 * (« 08:00–11:00 · Entretien — LASSALLE · MONBEQUI — glisser ou flèches… ») et
 * mêlait la donnée à la consigne d'usage. La consigne est écrite une fois, en
 * en-tête de la barre ; elle n'a rien à faire sur chaque bloc.
 *
 * Reprend la lecture d'une carte de kanban : qui, où, quoi, quand, combien de
 * temps. Les icônes d'équipement (🪵 bûche / 🔥 flamme / ❄️ flocon) sont celles
 * du reste de l'app — même composant, même cache — et ne s'affichent que sur un
 * entretien : c'est là qu'elles disent quelque chose du travail à faire.
 * ============================================================================
 */

import { estTypeAdaptable } from '@/lib/souplesse';
import { Car } from 'lucide-react';
import { EquipmentKindIcons } from '@apps/artisan/components/shared/EquipmentKindIcons';
import { minutesEnHHMM, formatDuree } from './tourneesPanelUtils';

const LIBELLE_TYPE = {
  maintenance: 'Entretien',
  service: 'SAV',
  installation: 'Installation',
  visite_technique: 'Visite technique',
  autre: 'Autre',
};

const COULEUR_TYPE = {
  maintenance: 'bg-blue-100 text-blue-800',
  service: 'bg-violet-100 text-violet-800',
  installation: 'bg-slate-100 text-slate-700',
};

/**
 * @param {object} props
 * @param {object} props.rdv        RDV brut (`journee.rdvs`)
 * @param {number} props.debutMinutes  heure affichée — celle du bloc, décalage compris
 * @param {number} props.finMinutes
 * @param {{minutes, disponibleMinutes, insuffisant, depuis}|null} [props.trajet]
 *   temps de route depuis le RDV précédent. Cette information manquait à l'écran
 *   au point que la poignée de redimensionnement a été prise pour « le
 *   transport » (31/08) : une donnée qu'on cherche et qui n'est nulle part finit
 *   lue dans autre chose. Les DEUX chiffres sont affichés quand ils divergent —
 *   un planning qui laisse 30 min pour un trajet estimé à 46 doit le dire, c'est
 *   la seule raison pour laquelle le rendez-vous se déplace librement.
 * @param {string} [props.className]
 */
export function BlocRdvCard({
  rdv, debutMinutes, finMinutes, trajet = null, className = '',
}) {
  const type = rdv.appointment_type;
  const duree = finMinutes - debutMinutes;
  // La durée d'origine n'est portée que si elle a été modifiée à l'écran
  // (appliquerAjustements) : l'afficher permet de voir ce qu'on a retiré.
  const dureeInitiale = rdv.dureeInitialeMinutes;

  return (
    <div
      className={`w-64 rounded-lg border border-gray-200 bg-white shadow-lg px-2.5 py-2 text-left ${className}`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <p className="font-semibold text-gray-900 text-xs truncate">
          {estTypeAdaptable(type) && (rdv.hour_confirmed_at || rdv.time_flex_minutes === 0
            ? <span className="mr-1" title="Heure communiquée au client (figé)">🔒</span>
            : <span className="mr-1" title="Adaptable : le CTA « Trouver le créneau » et « Figer la journée » peuvent le glisser dans sa tolérance. Le remplissage de journée, lui, ne déplace jamais un RDV posé.">↔</span>)}
          {rdv.client_name || rdv.subject || 'Sans client'}
        </p>
        {type === 'maintenance' && rdv.client_id && (
          <EquipmentKindIcons clientId={rdv.client_id} size="xs" />
        )}
      </div>

      <p className="text-[11px] text-gray-500 truncate">{rdv.city || 'Ville inconnue'}</p>

      <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[11px]">
        <span
          className={`inline-flex items-center rounded-full font-medium px-1.5 py-px ${
            COULEUR_TYPE[type] || 'bg-gray-100 text-gray-600'
          }`}
        >
          {LIBELLE_TYPE[type] || type || 'RDV'}
        </span>
        <span className="font-medium text-gray-900">
          {minutesEnHHMM(debutMinutes)}–{minutesEnHHMM(finMinutes)}
        </span>
        <span className="text-gray-500">
          {formatDuree(duree)}
          {dureeInitiale != null && (
            <span className="text-emerald-700"> (au lieu de {formatDuree(dureeInitiale)})</span>
          )}
        </span>
      </div>

      {/* Le trajet depuis le RDV précédent : c'est lui qui borne le déplacement
          de ce bloc — et son insuffisance explique qu'il n'en soit pas borné. */}
      {trajet && (
        <p
          className={`mt-1 flex items-start gap-1 text-[11px] ${
            trajet.insuffisant ? 'text-amber-700' : 'text-gray-400'
          }`}
        >
          <Car className="h-3 w-3 flex-shrink-0 mt-px" />
          <span>
            {formatDuree(trajet.minutes)} de route depuis {trajet.depuis}
            {trajet.insuffisant && (
              <>
                {' '}— <strong className="font-semibold">
                  {formatDuree(trajet.disponibleMinutes)} disponibles seulement
                </strong>
              </>
            )}
          </span>
        </p>
      )}
    </div>
  );
}

export default BlocRdvCard;
