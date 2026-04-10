/**
 * EntretienSAVCard.jsx - Majord'home Artisan
 * ============================================================================
 * Carte individuelle pour le kanban Entretien & SAV.
 * Bandeau gauche coloré par type (bleu entretien / orange SAV).
 * Affiche : nom client, code postal, montant contrat/devis, date, tag type.
 *
 * @version 1.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { useState } from 'react';
import { MapPin, Calendar, Wrench, ClipboardCheck, Euro, MessageSquare, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { formatEuro } from '@/lib/utils';
import { savService } from '@services/sav.service';
import { PARTS_ORDER_STATUSES } from '@services/sav.service';

// ============================================================================
// CONSTANTES VISUELLES
// ============================================================================

const TYPE_CONFIG = {
  entretien: {
    label: 'Entretien',
    color: '#3B82F6',
    bgClass: 'bg-blue-50 text-blue-700',
    stripeClass: 'bg-blue-500',
    Icon: ClipboardCheck,
  },
  sav: {
    label: 'SAV',
    color: '#F97316',
    bgClass: 'bg-orange-50 text-orange-700',
    stripeClass: 'bg-orange-500',
    Icon: Wrench,
  },
};

function PartsOrderBadge({ status }) {
  if (!status) return null;
  const config = PARTS_ORDER_STATUSES.find(s => s.value === status);
  if (!config) return null;

  const colorMap = {
    commande: 'bg-amber-100 text-amber-700',
    recu: 'bg-green-100 text-green-700',
  };

  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${colorMap[status] || 'bg-gray-100 text-gray-600'}`}>
      {config.label}
    </span>
  );
}

// ============================================================================
// COMPOSANT
// ============================================================================

export function EntretienSAVCard({ item, onClick, onRefresh, orgId }) {
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const type = item.intervention_type;
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.entretien;

  const name = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim() || 'Sans nom';
  // Montant : SAV = devis + contrat si entretien inclus, Entretien = contrat
  const devis = Number(item.devis_amount) || 0;
  const contrat = Number(item.contract_amount) || 0;
  const amount = type === 'sav'
    ? devis + (item.includes_entretien ? contrat : 0)
    : contrat;

  // Date pertinente : scheduled_date ou created_at
  const dateStr = item.scheduled_date || item.created_at;
  const dateObj = dateStr ? new Date(dateStr) : null;
  const dayNum = dateObj ? dateObj.getDate() : '';
  const monthShort = dateObj
    ? dateObj.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')
    : '';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(item); }}
      className="w-full text-left bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-all overflow-hidden group cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="flex">
        {/* Bandeau gauche coloré avec date */}
        <div
          className={`w-12 flex-shrink-0 flex flex-col items-center justify-center py-2 text-white ${config.stripeClass}`}
        >
          <span className="text-sm font-bold leading-none">{dayNum}</span>
          <span className="text-[10px] uppercase leading-tight mt-0.5">{monthShort}</span>
        </div>

        {/* Contenu */}
        <div className="flex-1 min-w-0 px-3 py-2 space-y-1">
          {/* Ligne 1 : Nom + montant */}
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm text-gray-900 truncate">
              {name}
            </span>
            {amount > 0 && (
              <span className="text-xs font-semibold text-emerald-700 flex-shrink-0">
                {formatEuro(amount)}
              </span>
            )}
          </div>

          {/* Ligne 2 : Code postal + ville */}
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="truncate">
              {[item.client_postal_code, item.client_city].filter(Boolean).join(' ') || '—'}
            </span>
          </div>

          {/* Ligne 3 : Tags type + badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${config.bgClass}`}>
              {config.label}
            </span>
            {item.tags?.includes('Web') && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">
                Web
              </span>
            )}
            {item.tags?.includes('Contrat') && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                Contrat
              </span>
            )}
            {type === 'sav' && item.includes_entretien && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                Entretien à faire
              </span>
            )}
            {type === 'sav' && item.parts_order_status && (
              <PartsOrderBadge status={item.parts_order_status} />
            )}
          </div>

          {/* Ligne 4 : Numéro contrat */}
          {item.contract_number && (
            <div className="text-[10px] text-gray-400">
              {item.contract_number}
            </div>
          )}

          {/* Badge certificat (planifié) / Bouton facturé (réalisé) */}
          {(type === 'entretien' || (type === 'sav' && item.includes_entretien)) && item.workflow_status === 'planifie' && (
            <span className="inline-flex items-center gap-1 mt-1 px-2 py-1 bg-[#1B4F72] text-white text-[10px] font-medium rounded-md">
              <ClipboardCheck className="w-3 h-3" />
              Certificat à faire
            </span>
          )}
          {(type === 'entretien' || (type === 'sav' && item.includes_entretien)) && item.workflow_status === 'realise' && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  await savService.updateWorkflowStatus(item.id, 'facture');
                  onRefresh?.();
                }}
                className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-md border border-gray-300 text-gray-600 bg-white hover:bg-green-50 hover:border-green-400 hover:text-green-700 transition-colors"
              >
                <Euro className="w-3 h-3" />
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (smsSent) return;
                  setSmsLoading(true);
                  const { error } = await savService.sendAvisRequest({
                    interventionId: item.id,
                    clientId: item.client_id,
                    clientFirstName: item.client_first_name,
                    clientPhone: item.client_phone,
                    clientPhoneSecondary: item.client_phone_secondary,
                    orgId,
                  });
                  setSmsLoading(false);
                  if (error) {
                    toast.error(error.message || 'Erreur envoi demande d\'avis');
                  } else {
                    setSmsSent(true);
                    toast.success('Demande d\'avis envoyée');
                  }
                }}
                disabled={smsLoading || smsSent}
                className={`inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-md border transition-colors ${
                  smsSent
                    ? 'border-green-300 text-green-600 bg-green-50'
                    : 'border-gray-300 text-gray-600 bg-white hover:bg-teal-50 hover:border-teal-400 hover:text-teal-700'
                } disabled:opacity-60`}
              >
                {smsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : smsSent ? <Check className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function EntretienSAVCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
      <div className="flex">
        <div className="w-12 bg-gray-200 h-20" />
        <div className="flex-1 p-3 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-100 rounded w-1/2" />
          <div className="h-3 bg-gray-100 rounded w-1/4" />
        </div>
      </div>
    </div>
  );
}

export default EntretienSAVCard;
