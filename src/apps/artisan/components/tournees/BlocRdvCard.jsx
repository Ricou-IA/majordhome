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
 * @param {string} [props.className]
 */
export function BlocRdvCard({
  rdv, debutMinutes, finMinutes, className = '',
}) {
  const type = rdv.appointment_type;
  const duree = finMinutes - debutMinutes;
  // La durée d'origine n'est portée que si elle a été modifiée à l'écran
  // (appliquerAjustements) : l'afficher permet de voir ce qu'on a retiré.
  const dureeInitiale = rdv.dureeInitialeMinutes;

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white shadow-lg p-2.5 text-left ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-gray-900 text-sm truncate">
          {rdv.client_name || rdv.subject || 'Sans client'}
        </p>
        {type === 'maintenance' && rdv.client_id && (
          <EquipmentKindIcons clientId={rdv.client_id} size="xs" />
        )}
      </div>

      <p className="text-xs text-gray-500 truncate">{rdv.city || 'Ville inconnue'}</p>

      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center rounded-full font-medium px-2 py-0.5 text-[11px] ${
            COULEUR_TYPE[type] || 'bg-gray-100 text-gray-600'
          }`}
        >
          {LIBELLE_TYPE[type] || type || 'RDV'}
        </span>
        <span className="text-xs font-medium text-gray-900">
          {minutesEnHHMM(debutMinutes)} – {minutesEnHHMM(finMinutes)}
        </span>
        <span className="text-xs text-gray-500">
          {formatDuree(duree)}
          {dureeInitiale != null && (
            <span className="text-emerald-700"> (au lieu de {formatDuree(dureeInitiale)})</span>
          )}
        </span>
      </div>
    </div>
  );
}

export default BlocRdvCard;
