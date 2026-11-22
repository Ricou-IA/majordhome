/**
 * LeadCard.jsx - Majord'home Artisan
 * ============================================================================
 * Carte lead compacte pour le Kanban pipeline (drag & drop).
 * Affiche nom, source, montant, prochaine action, jours dans le statut,
 * badge devis Pennylane (expand inline). La date de la bande gauche dépend de
 * la COLONNE de la carte : règle unique `dateDeCarte` (src/lib/leadCardDate.js).
 *
 * @version 2.0.0 - Mode liste retiré (onglet Leads supprimé) → compact-only
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { Phone, Calendar, Clock, PhoneCall, FileText, Trophy, XCircle, Hourglass, ChevronDown, ChevronUp, CalendarClock, AlertTriangle, MapPinOff } from 'lucide-react';
import { formatEuroCeil } from '@/lib/utils';
import { useLinkedPennylaneQuotes, usePrefetchLinkedPennylaneQuotes } from '@hooks/usePennylane';
import { usePennylaneEnabled } from '@hooks/useOrgSettings';
import { dateDeCarte } from '@/lib/leadCardDate';
import { estHorsZone } from '@/lib/territoire-config';
import { QuoteSubCard } from './QuoteSubCard';

// Statuts depuis lesquels un lead peut partir en suivi MT-LT : tout le funnel
// actif. Un prospect intéressé mais à échéance lointaine n'a pas forcément de
// devis (Nouveau / Contacté / RDV planifié). Gagné / Perdu sont exclus.
const LONG_TERM_ELIGIBLE_STATUSES = new Set(['Nouveau', 'Contacté', 'RDV planifié', 'Devis envoyé']);

const REFUSED_QUOTE_STATUSES = ['refused', 'denied', 'canceled'];

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

/** Date complète pour l'infobulle (« 3 nov. 2026 ») — l'année ne tient pas dans la bande */
function formatFullDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Icône de la bande gauche quand la date de la colonne est inconnue
const COLUMN_ICONS = {
  nouveau: Calendar,
  contacte: PhoneCall,
  rdv_planifie: Calendar,
  devis_envoye: FileText,
  gagne: Trophy,
  perdu: XCircle,
};

// Colonne déduite du statut du lead, pour une carte rendue sans colonne explicite
const STATUS_LABEL_TO_COLUMN_KEY = {
  'Nouveau': 'nouveau',
  'Contacté': 'contacte',
  'RDV planifié': 'rdv_planifie',
  'Devis envoyé': 'devis_envoye',
  'Gagné': 'gagne',
  'Perdu': 'perdu',
};

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
 * @param {Object} props.commercialsMap - Map { id: { initials, name, colorIndex } }
 * @param {Function} props.onMoveToLongTerm - (lead) => void — affiche un bouton MT-LT
 *   sur les cartes du funnel actif (Nouveau → Devis envoyé) si fourni
 * @param {Object} [props.card] - Carte Kanban courante (column_key, devis_count) passée par LeadKanban (Phase 1 pipeline multi-devis)
 * @param {string} [props.columnKey] - Colonne où la carte est AFFICHÉE (peut différer un instant de `card.column_key`
 *   pendant un déplacement) ; à défaut, celle de la vue puis celle du statut du lead
 */
export function LeadCard({ lead, onClick, commercialsMap, onMoveToLongTerm, card, columnKey }) {
  const [expanded, setExpanded] = useState(false);

  // Devis Pennylane liés (expand inline dans le kanban)
  // Hooks AVANT tout return conditionnel (règles des hooks React)
  const hasDevis = (card?.devis_count || 0) > 0;
  // Flag « à rapprocher » : org Pennylane, carte « Devis envoyé » sans aucun
  // devis PL rattaché (placement par fallback status_id). Ces leads ne devraient
  // plus exister (invariant DB depuis 2026-06-10) ; le flag aide à traiter à la
  // main les violateurs historiques.
  const pennylaneActive = usePennylaneEnabled();
  const needsQuoteLink = pennylaneActive && card?.column_key === 'devis_envoye' && !hasDevis;
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
  // Exception (Eric, 2026-10-05) : la carte Devis envoye liste AUSSI les devis
  // refuses du lead, marques « Refusé » et ranges apres les devis en cours —
  // le lead ne passe en Perdu que si 100 % de ses devis sont refuses, un refus
  // partiel doit donc rester visible ici. Badge et montant ne comptent que
  // les devis en cours.
  const filteredQuotes = useMemo(() => {
    const quotes = (linkedQuotes || []).filter(q => {
      if (!card?.column_key) return true;
      const status = q.quote_status;
      if (card.column_key === 'devis_envoye') {
        return ['pending', 'draft', 'expired'].includes(status) || REFUSED_QUOTE_STATUSES.includes(status);
      }
      if (card.column_key === 'gagne') return ['accepted', 'invoiced'].includes(status);
      if (card.column_key === 'perdu') return REFUSED_QUOTE_STATUSES.includes(status);
      return true;
    });
    if (card?.column_key !== 'devis_envoye') return quotes;
    const isRefused = (q) => REFUSED_QUOTE_STATUSES.includes(q.quote_status);
    return [...quotes.filter(q => !isRefused(q)), ...quotes.filter(isRefused)];
  }, [linkedQuotes, card?.column_key]);

  if (!lead) return null;

  const name = `${lead.last_name || ''} ${lead.first_name || ''}`.trim() || 'Sans nom';
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

  // Date de la bande gauche : dépend de la colonne (création, dernier contact, RDV,
  // 1er devis, gain, perte). Colonne RDV planifié sans RDV actif -> marqueur ambre.
  const effectiveColumnKey = columnKey || card?.column_key || STATUS_LABEL_TO_COLUMN_KEY[lead.statuses?.label];
  const ctx = dateDeCarte({ columnKey: effectiveColumnKey, lead, card });
  const showAmber = ctx.aReplanifier;
  const shortDate = formatShortDate(ctx.date);
  const CtxIcon = COLUMN_ICONS[effectiveColumnKey] || Calendar;
  const dateTitle = shortDate ? `${ctx.libelle} ${formatFullDate(ctx.date)}` : ctx.libelle;

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
        title={dateTitle}
      >
        {showAmber ? (
          <CalendarClock className="h-4 w-4 text-amber-500" />
        ) : shortDate ? (
          <>
            <span className="text-sm font-bold leading-none" style={{ color: statusColor }}>
              {shortDate.day}
            </span>
            <span className="text-[11px] uppercase leading-tight" style={{ color: statusColor }}>
              {shortDate.month}
            </span>
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
            {onMoveToLongTerm && LONG_TERM_ELIGIBLE_STATUSES.has(lead.statuses?.label) && (
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

        {/* Les repères passent à la ligne plutôt que d'écraser la source : « Bouche-à-oreille »
            se lit en entier, c'est le délai ou le bouton des devis qui descend d'une ligne. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-1.5">
          {estHorsZone(lead) && (
            <span
              className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800 font-medium whitespace-nowrap"
              title="Adresse hors de la zone où l’entreprise intervient"
            >
              <MapPinOff className="h-3 w-3" />Hors zone
            </span>
          )}
          {sourceLabel && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full text-white font-medium truncate max-w-full"
              style={{ backgroundColor: sourceColor }}
              title={sourceLabel}
            >
              {sourceLabel}
            </span>
          )}
          {commercial && (
            <span
              className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ring-1 ${getCommercialColor(commercial.colorIndex)}`}
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

        {needsQuoteLink && (
          <p
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-amber-700"
            title="Devis envoyé sans devis Pennylane rattaché — à rapprocher manuellement"
          >
            <AlertTriangle className="h-3 w-3" />
            Devis à rapprocher
          </p>
        )}
        {lead.next_action && (
          <p className="text-xs text-gray-500 mt-1.5 truncate">
            → {lead.next_action}
          </p>
        )}

        {expanded && filteredQuotes.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {filteredQuotes.map(q => (
              <QuoteSubCard
                key={q.id}
                quote={q}
                refused={card?.column_key === 'devis_envoye' && REFUSED_QUOTE_STATUSES.includes(q.quote_status)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default LeadCard;
