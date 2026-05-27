/**
 * LeadCard.jsx - Majord'home Artisan
 * ============================================================================
 * Carte lead pour la liste et le kanban.
 * Affiche nom, statut, source, montant, prochaine action, jours dans le statut.
 *
 * @version 1.0.0 - Sprint 4 Pipeline Commercial
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { Phone, Calendar, Clock, User, PhoneCall, FileText, Trophy, XCircle, Hourglass, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatEuroCeil } from '@/lib/utils';
import { useLinkedPennylaneQuotes, usePrefetchLinkedPennylaneQuotes } from '@hooks/usePennylane';
import { QuoteSubCard } from './QuoteSubCard';

/**
 * Calcule le nombre de jours depuis une date
 */
function daysSince(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  return diff;
}

/**
 * Formate une date courte (jour + mois abrégé)
 */
function formatShortDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const day = d.getDate();
  const month = d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
  return { day, month };
}

/**
 * Retourne la date contextuelle et l'icône selon le statut du lead
 */
function getContextualDate(lead) {
  const statusLabel = lead.statuses?.label;

  switch (statusLabel) {
    case 'Nouveau':
      return {
        date: lead.created_date || lead.created_at,
        icon: Calendar,
        tooltip: 'Date de création',
      };
    case 'Contacté':
      return {
        date: lead.last_call_date,
        icon: PhoneCall,
        tooltip: lead.call_count > 1 ? `${lead.call_count} appels` : '1 appel',
        extra: null,
      };
    case 'RDV planifié':
      return {
        date: lead.appointment_date,
        icon: Calendar,
        tooltip: 'Date du RDV',
      };
    case 'Devis envoyé':
      return {
        date: lead.quote_sent_date,
        icon: FileText,
        tooltip: 'Date d\'envoi du devis',
      };
    case 'Gagné':
      return {
        date: lead.won_date,
        icon: Trophy,
        tooltip: 'Date de signature',
      };
    case 'Perdu':
      return {
        date: null,
        icon: XCircle,
        tooltip: lead.lost_reason || null,
        text: lead.lost_reason ? lead.lost_reason.substring(0, 20) : null,
      };
    default:
      return { date: lead.created_date, icon: Calendar };
  }
}

/**
 * Couleur du badge "jours dans statut" selon le délai
 */
function getDaysColor(days) {
  if (days == null) return 'text-gray-400';
  if (days > 7) return 'text-red-500';
  if (days > 3) return 'text-amber-500';
  return 'text-gray-400';
}

/**
 * Labels sources raccourcis pour le kanban
 */
const SOURCE_SHORT_LABELS = {
  'Recommandation client': 'Reco Client',
  'Prospection directe': 'Prospection',
};


/**
 * Couleurs pour les badges initiales commerciaux
 */
const COMMERCIAL_COLORS = [
  'bg-indigo-100 text-indigo-700 ring-indigo-300',
  'bg-teal-100 text-teal-700 ring-teal-300',
  'bg-rose-100 text-rose-700 ring-rose-300',
  'bg-amber-100 text-amber-700 ring-amber-300',
];

function getCommercialColor(index) {
  return COMMERCIAL_COLORS[index % COMMERCIAL_COLORS.length];
}

/**
 * @param {Object} props
 * @param {Object} props.lead - Données lead avec statuses/sources jointures
 * @param {Function} props.onClick - Callback clic sur la carte
 * @param {boolean} props.compact - Mode compact pour le kanban
 * @param {Object} props.commercialsMap - Map { id: { initials, name, colorIndex } }
 * @param {Function} props.onMoveToLongTerm - (lead) => void — affiche un bouton MT-LT
 *   sur les cartes "Devis envoyé" si fourni
 * @param {Object} [props.card] - Carte Kanban courante (column_key, devis_count) passée par LeadKanban (Phase 1 pipeline multi-devis)
 */
export function LeadCard({ lead, onClick, compact = false, commercialsMap, onMoveToLongTerm, card }) {
  const [expanded, setExpanded] = useState(false);

  // Devis Pennylane liés (expand inline dans le kanban)
  // Hooks AVANT tout return conditionnel (règles des hooks React)
  const hasDevis = (card?.devis_count || 0) > 0;
  const { linkedQuotes } = useLinkedPennylaneQuotes(hasDevis && expanded ? lead?.id : null);
  // Prefetch au survol → ouverture instant si user clique dans la foulée
  const prefetchLinkedQuotes = usePrefetchLinkedPennylaneQuotes();
  const handleMouseEnter = hasDevis && !expanded ? () => prefetchLinkedQuotes(lead?.id) : undefined;

  // Filtrer les devis selon la colonne (pertinents uniquement)
  // Aligne sur la vue majordhome_kanban_cards (migration 2026-05-27) :
  // - devis_envoye groupe pending+draft+expired (expired non suivi metier)
  // - gagne groupe accepted+invoiced
  // - perdu groupe refused+denied+canceled (expired exclu)
  // useMemo doit rester avant tout return conditionnel (règles des hooks React)
  const filteredQuotes = useMemo(() => {
    return (linkedQuotes || []).filter(q => {
      if (!card?.column_key) return true;
      const status = q.quote_status;
      if (card.column_key === 'devis_envoye') return ['pending', 'draft', 'expired'].includes(status);
      if (card.column_key === 'gagne') return ['accepted', 'invoiced'].includes(status);
      if (card.column_key === 'perdu') return ['refused', 'denied', 'canceled'].includes(status);
      return true;
    });
  }, [linkedQuotes, card?.column_key]);

  if (!lead) return null;

  const name = `${lead.last_name || ''} ${lead.first_name || ''}`.trim() || 'Sans nom';
  const statusLabel = lead.statuses?.label || '—';
  const statusColor = lead.statuses?.color || '#6B7280';
  const sourceRaw = lead.sources?.name || null;
  const sourceLabel = sourceRaw ? (SOURCE_SHORT_LABELS[sourceRaw] || sourceRaw) : null;
  const sourceColor = lead.sources?.color || '#6B7280';
  // Montant affiche :
  // - Colonne Gagne -> somme des devis valides (card.total_amount = accepted_sum
  //   de la vue majordhome_kanban_cards, decision produit 2026-05-27 : tous
  //   les devis acceptes = autant d'interventions a prevoir)
  // - Autres colonnes -> montant du dernier devis (order_amount_ht pose par
  //   lead_attach_quotes_and_send) car on ne peut pas prevoir lequel sera
  //   signe (cas Amalric avec 6 devis pending)
  const amount = card?.column_key === 'gagne'
    ? (Number(card?.total_amount) || lead.order_amount_ht || lead.estimated_revenue || 0)
    : (lead.order_amount_ht || lead.estimated_revenue || 0);
  const daysInStatus = daysSince(lead.updated_at);

  // Commercial assigné (initiales)
  const commercial = commercialsMap?.[lead.assigned_user_id];

  // Mode compact (kanban)
  if (compact) {
    const ctx = getContextualDate(lead);
    const shortDate = formatShortDate(ctx.date);
    const CtxIcon = ctx.icon;
    const isPerdu = lead.statuses?.label === 'Perdu';

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onClick?.(lead)}
        onMouseEnter={handleMouseEnter}
        onFocus={handleMouseEnter}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(lead); }}
        className="w-full text-left bg-white rounded-lg border hover:shadow-md transition-shadow
                   focus:outline-none focus:ring-2 focus:ring-blue-500 flex cursor-pointer"
      >
        {/* Bande date à gauche */}
        <div
          className="flex flex-col items-center justify-center px-2 py-2 rounded-l-lg min-w-[44px] border-r"
          style={{ backgroundColor: `${statusColor}10`, borderColor: `${statusColor}30` }}
          title={ctx.tooltip}
        >
          {isPerdu ? (
            <>
              <XCircle className="h-4 w-4 mb-0.5" style={{ color: statusColor }} />
              {ctx.text && (
                <span className="text-[9px] text-gray-500 text-center leading-tight line-clamp-2">
                  {ctx.text}
                </span>
              )}
            </>
          ) : shortDate ? (
            <>
              <span className="text-sm font-bold leading-none" style={{ color: statusColor }}>
                {shortDate.day}
              </span>
              <span className="text-[10px] uppercase leading-tight" style={{ color: statusColor }}>
                {shortDate.month}
              </span>
              {ctx.extra && (
                <span className="text-[9px] font-medium text-gray-500 mt-0.5">{ctx.extra}</span>
              )}
            </>
          ) : (
            <CtxIcon className="h-4 w-4 text-gray-300" />
          )}
        </div>

        {/* Contenu carte */}
        <div className="flex-1 min-w-0 p-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-sm text-gray-900 truncate">{name}</p>
            <div className="flex items-center gap-1.5 shrink-0">
              {onMoveToLongTerm && lead.statuses?.label === 'Devis envoyé' && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onMoveToLongTerm(lead); }}
                  className="inline-flex items-center justify-center h-5 w-5 rounded-full text-purple-600 hover:bg-purple-100 transition-colors"
                  title="Passer en Projet MT-LT (sortir du pipeline)"
                >
                  <Hourglass className="h-3.5 w-3.5" />
                </button>
              )}
              <span className={`text-xs font-semibold whitespace-nowrap ${amount > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                {formatEuroCeil(amount)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 mt-1.5">
            {sourceLabel && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-full text-white font-medium truncate max-w-[100px]"
                style={{ backgroundColor: sourceColor }}
                title={sourceLabel}
              >
                {sourceLabel}
              </span>
            )}
            {commercial && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ring-1 ${getCommercialColor(commercial.colorIndex)}`}
                title={commercial.name}
              >
                {commercial.initials}
              </span>
            )}
            {lead.statuses?.label === 'Contacté' && lead.call_count > 0 && (
              <span className="text-xs flex items-center gap-0.5 text-amber-600" title={`${lead.call_count} appel${lead.call_count > 1 ? 's' : ''}`}>
                <Phone className="h-3 w-3" />{lead.call_count}
              </span>
            )}
            {lead.statuses?.label === 'Devis envoyé' && lead.followup_count > 0 && (
              <span className="text-xs flex items-center gap-0.5 text-purple-600" title={`${lead.followup_count} relance${lead.followup_count > 1 ? 's' : ''}`}>
                <Phone className="h-3 w-3" />{lead.followup_count}
              </span>
            )}
            {daysInStatus !== null && (
              <span className={`text-xs flex items-center gap-0.5 ${getDaysColor(daysInStatus)}`}>
                <Clock className="h-3 w-3" />
                {daysInStatus}j
              </span>
            )}
            {hasDevis && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                className="ml-auto inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium transition-colors"
                style={{
                  backgroundColor: card?.column_key === 'gagne' ? '#d97706'
                    : card?.column_key === 'perdu' ? '#94a3b8'
                    : '#1d4ed8',
                  color: 'white',
                }}
                title="Voir les devis Pennylane attachés"
              >
                <FileText className="w-3 h-3" />
                {card.devis_count}
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>

          {lead.next_action && (
            <p className="text-xs text-gray-500 mt-1.5 truncate">
              → {lead.next_action}
            </p>
          )}

          {expanded && filteredQuotes.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {filteredQuotes.map(q => (
                <QuoteSubCard key={q.id} quote={q} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Mode normal (liste)
  return (
    <button
      type="button"
      onClick={() => onClick?.(lead)}
      className="w-full text-left bg-white rounded-lg border p-4 hover:shadow-md hover:border-blue-200
                 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500
                 min-h-[44px]"
    >
      {/* Ligne 1 : Nom + Statut */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900 truncate">{name}</h3>
        <Badge
          className="text-xs text-white shrink-0"
          style={{ backgroundColor: statusColor }}
        >
          {statusLabel}
        </Badge>
      </div>

      {/* Ligne 2 : Source + Montant */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          {sourceLabel && (
            <span
              className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
              style={{ backgroundColor: sourceColor }}
            >
              {sourceLabel}
            </span>
          )}
        </div>
        <span className={`text-sm font-semibold ${amount > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
          {formatEuroCeil(amount)}
        </span>
      </div>

      {/* Ligne 3 : Téléphone */}
      {lead.phone && (
        <p className="text-sm text-gray-600 mt-2 flex items-center gap-1.5">
          <Phone className="h-3.5 w-3.5 text-gray-400" />
          {lead.phone}
        </p>
      )}

      {/* Ligne 4 : Prochaine action */}
      {lead.next_action ? (
        <div className="mt-2 flex items-start gap-1.5 text-sm">
          <Calendar className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
          <span className="text-blue-700">
            {lead.next_action}
            {lead.next_action_date && (
              <span className="text-blue-500 ml-1">
                ({new Date(lead.next_action_date).toLocaleDateString('fr-FR')})
              </span>
            )}
          </span>
        </div>
      ) : (
        <p className="text-xs text-gray-400 mt-2 italic">Aucune action planifiée</p>
      )}

      {/* Ligne 5 : Jours + Assigné */}
      <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
        {daysInStatus !== null && (
          <span className={`flex items-center gap-1 ${getDaysColor(daysInStatus)}`}>
            <Clock className="h-3 w-3" />
            {daysInStatus === 0 ? "Aujourd'hui" : `${daysInStatus}j dans ce statut`}
          </span>
        )}
        {commercial ? (
          <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full font-semibold ring-1 ${getCommercialColor(commercial.colorIndex)}`}>
            <User className="h-3 w-3" />
            {commercial.initials}
          </span>
        ) : lead.assigned_user_id ? (
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            Assigné
          </span>
        ) : null}
      </div>
    </button>
  );
}

/**
 * Skeleton de chargement pour LeadCard
 */
export function LeadCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border p-4 animate-pulse">
      <div className="flex justify-between">
        <div className="h-5 bg-gray-200 rounded w-36" />
        <div className="h-5 bg-gray-200 rounded w-20" />
      </div>
      <div className="flex justify-between mt-3">
        <div className="h-4 bg-gray-200 rounded w-24" />
        <div className="h-4 bg-gray-200 rounded w-16" />
      </div>
      <div className="h-4 bg-gray-200 rounded w-32 mt-3" />
      <div className="h-3 bg-gray-200 rounded w-48 mt-3" />
    </div>
  );
}

export default LeadCard;
