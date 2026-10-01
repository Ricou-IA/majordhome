/**
 * ChantierCard.jsx - Majord'home Artisan
 * ============================================================================
 * Carte chantier pour le Kanban chantiers.
 * Affiche : nom client, CP, équipement, montant, date estimative, commercial.
 *
 * @version 1.1.0 - Sprint 6 Chantiers
 * ============================================================================
 */

import { MapPin, Calendar, CalendarClock } from 'lucide-react';
import { formatEuroCeil } from '@/lib/utils';
import { getChantierStatusConfig, getChantierAmount } from '@services/chantiers.service';
import { poseProvisoire } from '@/lib/installOrder';

/** Puce de date hachurée (pose provisoire : appros non reçues), même motif que le planning. */
const PROVISIONAL_CHIP_STYLE = {
  backgroundColor: '#F59E0B14',
  borderColor: '#F59E0B40',
  backgroundImage: 'repeating-linear-gradient(45deg, rgba(245, 158, 11, 0.18) 0 4px, transparent 4px 8px)',
};

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
  const amount = getChantierAmount(chantier);
  const statusConfig = getChantierStatusConfig(chantier.chantier_status);
  // Puce gauche : RDV installation si présent (vue dérivée), sinon date de signature.
  // Marqueur ambre « à replanifier » réactivé en Bloc B stage 4 (flux de planif installation
  // depuis ChantierModal) : chantier en planification sans RDV d'installation actif.
  const hasActiveRdv = Boolean(chantier.has_active_rdv);
  const chipDate = (hasActiveRdv && chantier.next_rdv_date)
    ? formatShortDate(chantier.next_rdv_date)
    : formatShortDate(chantier.won_date);
  const needsReplan = chantier.chantier_status === 'planification' && !hasActiveRdv;
  // Pose provisoire : RDV posé avant réception des appros → puce hachurée ambre, la carte
  // reste dans sa colonne (règle 2026-10-01, cf. installOrder.poseProvisoire).
  const provisoire = hasActiveRdv && poseProvisoire(chantier);
  const commercial = commercialsMap?.[chantier.assigned_user_id];

  let chipStyle = { backgroundColor: `${statusConfig.color}10`, borderColor: `${statusConfig.color}30` };
  let chipTitle = hasActiveRdv ? 'Date RDV installation' : 'Date signature';
  let chipColor = statusConfig.color;
  if (needsReplan) {
    chipStyle = { backgroundColor: '#F59E0B14', borderColor: '#F59E0B40' };
    chipTitle = 'Installation à replanifier';
  } else if (provisoire) {
    chipStyle = PROVISIONAL_CHIP_STYLE;
    chipTitle = 'Pose provisoire : appros non reçues';
    chipColor = '#B45309';
  }

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
        style={chipStyle}
        title={chipTitle}
      >
        {needsReplan ? (
          <CalendarClock className="h-4 w-4 text-amber-500" />
        ) : chipDate ? (
          <>
            <span className="text-sm font-bold leading-none" style={{ color: chipColor }}>
              {chipDate.day}
            </span>
            <span className="text-[10px] uppercase leading-tight" style={{ color: chipColor }}>
              {chipDate.month}
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
            {formatEuroCeil(amount)}
          </span>
        </div>

        {(chantier.label || Number(chantier.quotes_count) >= 2 || Number(chantier.validated_quotes_count) === 0) && (
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            {chantier.label && <p className="text-xs text-gray-500 truncate">{chantier.label}</p>}
            {Number(chantier.quotes_count) >= 2 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold shrink-0" title="Devis groupés sur ce chantier">
                {chantier.quotes_count} devis
              </span>
            )}
            {Number(chantier.validated_quotes_count) === 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold shrink-0" title="Aucun devis validé sur ce chantier">
                sans devis validé
              </span>
            )}
          </div>
        )}

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

        {/* Ligne 3 : Type équipement — toujours rendue (hauteur réservée) pour
            uniformiser la taille des cartes même sans type d'équipement */}
        <div className="mt-1.5 h-[22px]">
          {chantier.equipment_type_label && (
            <span className="inline-block text-xs px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium truncate max-w-full">
              {chantier.equipment_type_label}
            </span>
          )}
        </div>

        {/* Ligne 4 : date de passage en planification (la date estimative a disparu :
            c'est le RDV d'installation, provisoire ou non, qui porte la date) */}
        {chantier.planification_date && (
          <p className="text-[10px] text-gray-400 mt-1">
            Planif. : {formatDateSlash(chantier.planification_date)}
          </p>
        )}
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
