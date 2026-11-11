/**
 * SchedulingTransitionModal.jsx - Majord'home Artisan
 * ============================================================================
 * Planifier une carte entretien / SAV au glisser-déposer vers « Planifié » (kanban) ou
 * depuis la fiche contrat. Depuis le 2026-11-11 : la fenêtre unique « Nouveau RDV »
 * (EventModal), rattachée à la carte, avec à droite :
 * - la souplesse du RDV ;
 * - « Réaliser l'entretien » (SAV uniquement) et le montant total.
 * La création reste à l'appelant (onConfirm(slots, includesEntretien, { timeFlexMinutes })
 * → savService.scheduleEntretien, voie unique de planification entretien / SAV).
 * ============================================================================
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardCheck, Check } from 'lucide-react';
import { SouplesseSelect } from '@/apps/artisan/components/shared/SouplesseSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamMembers } from '@hooks/useAppointments';
import { formatEuro } from '@/lib/utils';
import { EventModal } from '@apps/artisan/components/planning/EventModal';

export function SchedulingTransitionModal({ item, orgId, onConfirm, onCancel, souplesseDefaut = 30 }) {
  const { user } = useAuth();
  const { members: teamMembers } = useTeamMembers(orgId);
  const [includesEntretien, setIncludesEntretien] = useState(item?.includes_entretien || false);
  // Souplesse du RDV (spec 2026-09-12) : null = défaut d'org, 0 = figé.
  const [timeFlexMinutes, setTimeFlexMinutes] = useState(null);

  if (!item) return null;

  const isSAV = item.intervention_type === 'sav';
  const name = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim() || 'Sans nom';
  const contractAmount = Number(item.contract_amount) || 0;
  const devisAmount = Number(item.devis_amount) || 0;
  const totalAmount = isSAV && includesEntretien ? devisAmount + contractAmount : devisAmount;

  const sideExtra = (
    <div className="space-y-3">
      {/* Souplesse du RDV : jusqu'où son heure peut glisser pour la tournée. */}
      <div className="rounded-lg border border-secondary-200 p-3 space-y-2">
        <p className="text-xs font-medium text-secondary-600">Souplesse du rendez-vous</p>
        <SouplesseSelect value={timeFlexMinutes} onChange={setTimeFlexMinutes} defaut={souplesseDefaut} compact />
      </div>
      {isSAV && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
          <button
            type="button"
            onClick={() => setIncludesEntretien((prev) => !prev)}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-all w-full justify-center ${
              includesEntretien
                ? 'text-blue-700 bg-blue-100 border-blue-300'
                : 'text-blue-700 bg-white border-blue-200 hover:bg-blue-50'
            }`}
          >
            {includesEntretien ? <Check className="w-4 h-4" /> : <ClipboardCheck className="w-4 h-4" />}
            {includesEntretien ? 'Entretien inclus' : 'Ajouter l’entretien'}
          </button>
          {includesEntretien && contractAmount > 0 && (
            <div className="flex items-center justify-between text-xs text-blue-700">
              <span>Montant total (devis + entretien)</span>
              <span className="font-bold">{formatEuro(totalAmount)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return createPortal(
    <EventModal
      isOpen
      mode="create"
      prefillClient={{
        id: item.client_id || null,
        display_name: name,
        last_name: item.client_last_name || item.client_name || '',
        first_name: item.client_first_name || '',
        phone: item.client_phone || '',
        email: item.client_email || '',
        address: item.client_address || '',
        postal_code: item.client_postal_code || '',
        city: item.client_city || '',
      }}
      members={teamMembers || []}
      orgId={orgId}
      userId={user?.id}
      attachContext={{
        interventionId: item.id,
        lockedType: isSAV ? 'service' : 'maintenance',
        subjectLabel: isSAV ? (includesEntretien ? 'SAV + Entretien' : 'SAV') : 'Entretien',
        multi: true,
        defaultDuration: isSAV && item.estimated_time ? Math.round(Number(item.estimated_time) * 60) : null,
        sideExtra,
        submitSlots: (slots) => onConfirm(slots, includesEntretien, { timeFlexMinutes }),
      }}
      onClose={onCancel}
      onSave={async () => false}
      onDelete={async () => {}}
      onCancel={async () => {}}
    />,
    document.body,
  );
}

export default SchedulingTransitionModal;
