/**
 * ChantierCard.jsx - Majord'home Artisan
 * ============================================================================
 * Carte chantier pour le Kanban chantiers.
 * Affiche : nom client, CP, équipement, montant, date estimative, commercial.
 *
 * @version 1.1.0 - Sprint 6 Chantiers
 * ============================================================================
 */

import { MapPin, Calendar } from 'lucide-react';
import { formatEuro } from '@/lib/utils';
import { getChantierStatusConfig } from '@/shared/services/chantiers.service';

function formatShortDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const day = d.getDate();
  const month = d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
  return { day, month };
}

function formatDateSlash(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

const COMMERCIAL_COLORS = [
  'bg-indigo-100 text-indigo-700 ring-indigo-300',
  'bg-teal-100 text-teal-700 ring-teal-300',
  'bg-rose-100 text-rose-700 ring-rose-300',
  'bg-amber-100 text-amber-700 ring-amber-300',
];

function getCommercialColor(index) {
  return COMMERCIAL_COLORS[index % COMMERCIAL_COLORS.length];
}

export function ChantierCard({ chantier, onClick, commercialsMap }) {
  if (!chantier) return null;

  const name = `${chantier.last_name || ''} ${chantier.first_name || ''}`.trim() || 'Sans nom';
  const amount = Number(chantier.order_amount_ht) || Number(chantier.estimated_revenue) || 0;
  const statusConfig = getChantierStatusConfig(chantier.chantier_status);
  const shortDate = formatShortDate(chantier.won_date);
  const commercial = commercialsMap?.[chantier.assigned_user_id];

  return (
    <button
      type="button"
      onClick={() => onClick?.(chantier)}
      className="w-full text-left bg-white rounded-lg border hover:shadow-md transition-shadow
                 focus:outline-none focus:ring-2 focus:ring-blue-500 flex min-h-[72px]"
    >
      {/* Bande date à gauche */}
      <div
        className="flex flex-col items-center justify-center px-2 py-2 rounded-l-lg min-w-[44px] border-r"
        style={{ backgroundColor: `${statusConfig.color}10`, borderColor: `${statusConfig.color}30` }}
        title="Date signature"
      >
        {shortDate ? (
          <>
            <span className="text-sm font-bold leading-none" style={{ color: statusConfig.color }}>
              {shortDate.day}
            </span>
            <span className="text-[10px] uppercase leading-tight" style={{ color: statusConfig.color }}>
              {shortDate.month}
            </span>
          </>
        ) : (
          <Calendar className="h-4 w-4 text-gray-300" />
        )}
      </div>

      {/* Contenu carte */}
      <div className="flex-1 min-w-0 p-2.5">
        {/* Ligne 1 : Nom + Montant */}
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-sm text-gray-900 truncate">{name}</p>
          <span className={`text-xs font-semibold whitespace-nowrap ${amount > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
            {formatEuro(amount)}
          </span>
        </div>

        {/* Ligne 2 : CP + Commandes + Commercial */}
        <div className="flex items-center gap-1.5 mt-1.5">
          {chantier.postal_code && (
            <span className="text-xs text-gray-500 flex items-center gap-0.5 shrink-0">
              <MapPin className="h-3 w-3" />
              {chantier.postal_code}
            </span>
          )}
          <OrderIndicator label="Éq." status={chantier.equipment_order_status} />
          <OrderIndicator label="Mat." status={chantier.materials_order_status} />
          {commercial && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ring-1 ml-auto shrink-0 ${getCommercialColor(commercial.colorIndex)}`}
              title={commercial.name}
            >
              {commercial.initials}
            </span>
          )}
        </div>

        {/* Ligne 3 : Type équipement */}
        {chantier.equipment_type_label && (
          <span className="inline-block text-xs px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium truncate max-w-full mt-1.5">
            {chantier.equipment_type_label}
          </span>
        )}

        {/* Ligne 4 : Dates estimative + planification */}
        <p className="text-[10px] text-gray-400 mt-1">
          Estim. : {formatDateSlash(chantier.estimated_date) || '—'}
          {chantier.planification_date && (
            <span className="ml-2">
              Planif. : {formatDateSlash(chantier.planification_date)}
            </span>
          )}
        </p>
      </div>
    </button>
  );
}

function OrderIndicator({ label, status }) {
  const config = {
    recu: 'bg-emerald-500 text-white',
    commande: 'bg-blue-500 text-white',
    na: 'bg-gray-200 text-gray-400',
  };
  const fallback = 'bg-gray-50 text-gray-300 border border-gray-200';
  const css = config[status] || fallback;

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${css}`}>
      {label}
    </span>
  );
}

export default ChantierCard;
