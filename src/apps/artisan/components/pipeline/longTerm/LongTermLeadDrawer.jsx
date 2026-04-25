/**
 * LongTermLeadDrawer.jsx - Majord'home Artisan
 * ============================================================================
 * Drawer dédié au suivi d'un lead Projet MT-LT.
 *
 * Sections :
 *  - Bandeau identité (nom, montant, source, ville, contact)
 *  - Notes contextuelles (éditable, save sur blur)
 *  - Timeline d'interactions + bouton ajouter
 *  - Footer actions : Gagné / Perdu / Réactiver
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Phone,
  Mail,
  MapPin,
  Hourglass,
  Trophy,
  XCircle,
  RotateCcw,
  Plus,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatEuro } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import {
  useLeadInteractions,
  useLeadInteractionMutations,
  useLongTermMutations,
} from '@hooks/useLeadInteractions';
import { useLeadStatuses, useLeadMutations } from '@hooks/useLeads';
import { leadsService } from '@services/leads.service';
import { LOST_REASONS } from '../LeadStatusConfig';
import { AddInteractionModal } from './AddInteractionModal';
import { InteractionTimeline } from './InteractionTimeline';
import { computeFreshness, formatShortDate } from './longTermUtils';

function NotesEditor({ leadId, initialNotes, onSaved }) {
  const [value, setValue] = useState(initialNotes || '');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setValue(initialNotes || '');
  }, [leadId, initialNotes]);

  const handleSave = async () => {
    if ((value || '') === (initialNotes || '')) return;
    setSaving(true);
    try {
      await leadsService.updateLead(leadId, { long_term_notes: value });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      onSaved?.();
    } catch (err) {
      console.error('[NotesEditor] save error:', err);
      toast.error('Erreur sauvegarde des notes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">Notes contextuelles</label>
        <span className="text-xs text-gray-400">
          {saving && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />sauvegarde…</span>}
          {savedFlash && !saving && <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" />sauvegardé</span>}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSave}
        placeholder="Ex: client doit boucler son financement, attente fin de chantier voisin, décision en famille…"
        rows={4}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none resize-none"
      />
    </div>
  );
}

export function LongTermLeadDrawer({
  lead,
  isOpen,
  onClose,
  onLeadUpdated,
}) {
  const { user } = useAuth();
  const userId = user?.id;
  const leadId = lead?.id;

  const { interactions, isLoading: loadingInteractions, refresh: refreshInteractions } = useLeadInteractions(leadId);
  const { createInteraction, deleteInteraction, isCreating, isDeleting } = useLeadInteractionMutations();
  const { reactivateFromLongTerm, isReactivating } = useLongTermMutations();
  const { updateLeadStatus, isChangingStatus } = useLeadMutations();
  const { statuses } = useLeadStatuses();

  const [addOpen, setAddOpen] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // Modale Perdu (motif requis)
  const [pendingLost, setPendingLost] = useState(false);
  const [lostReasonSelect, setLostReasonSelect] = useState('');
  const [lostReasonCustom, setLostReasonCustom] = useState('');

  // Reset des states internes au changement de lead
  useEffect(() => {
    if (!isOpen) {
      setAddOpen(false);
      setPendingLost(false);
      setLostReasonSelect('');
      setLostReasonCustom('');
    }
  }, [isOpen, leadId]);

  const wonStatusId = useMemo(
    () => statuses?.find((s) => s.label === 'Gagné')?.id,
    [statuses],
  );
  const lostStatusId = useMemo(
    () => statuses?.find((s) => s.label === 'Perdu')?.id,
    [statuses],
  );

  if (!isOpen || !lead) return null;

  const name = `${lead.last_name || ''} ${lead.first_name || ''}`.trim() || 'Sans nom';
  const amount = lead.order_amount_ht || lead.estimated_revenue || 0;
  const freshness = computeFreshness(lead.last_interaction_at, lead.long_term_started_at);

  const handleAddInteraction = async (input) => {
    await createInteraction({ leadId, ...input });
    refreshInteractions();
    onLeadUpdated?.();
    toast.success('Interaction ajoutée');
  };

  const handleDeleteInteraction = async (interactionId) => {
    setDeletingId(interactionId);
    try {
      await deleteInteraction({ interactionId, leadId });
      refreshInteractions();
      onLeadUpdated?.();
      toast.success('Interaction supprimée');
    } catch (err) {
      console.error('[Drawer] delete error:', err);
      toast.error('Erreur suppression');
    } finally {
      setDeletingId(null);
    }
  };

  const handleReactivate = async () => {
    try {
      await reactivateFromLongTerm({ leadId });
      toast.success('Lead réactivé dans le pipeline');
      onLeadUpdated?.();
      onClose();
    } catch (err) {
      console.error('[Drawer] reactivate error:', err);
      toast.error('Erreur lors de la réactivation');
    }
  };

  const handleWon = async () => {
    if (!wonStatusId) {
      toast.error('Statut "Gagné" introuvable');
      return;
    }
    try {
      // 1) Clear flag MT-LT
      await reactivateFromLongTerm({ leadId });
      // 2) Transition vers Gagné (gère aussi chantier_status, lock visit, etc.)
      await updateLeadStatus(leadId, wonStatusId, userId, {});
      toast.success('Lead passé en Gagné');
      onLeadUpdated?.();
      onClose();
    } catch (err) {
      console.error('[Drawer] won error:', err);
      toast.error('Erreur lors du passage en Gagné');
    }
  };

  const handleConfirmLost = async () => {
    const reason = lostReasonSelect === 'Autre' ? lostReasonCustom.trim() : lostReasonSelect;
    if (!reason) {
      toast.error('Veuillez sélectionner un motif');
      return;
    }
    if (!lostStatusId) {
      toast.error('Statut "Perdu" introuvable');
      return;
    }
    try {
      await reactivateFromLongTerm({ leadId });
      await updateLeadStatus(leadId, lostStatusId, userId, { lostReason: reason });
      toast.success('Lead marqué comme perdu');
      onLeadUpdated?.();
      onClose();
    } catch (err) {
      console.error('[Drawer] lost error:', err);
      toast.error('Erreur lors du passage en Perdu');
    }
  };

  const isBusy = isReactivating || isChangingStatus;

  return (
    <div className="fixed inset-0 z-40">
      {/* Overlay */}
      <button
        type="button"
        aria-label="Fermer"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-white shadow-xl overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Hourglass className="h-4 w-4 text-purple-600 shrink-0" />
                <span className="text-xs uppercase tracking-wide text-purple-700 font-semibold">Projet MT-LT</span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${freshness.classes}`}
                  title={`Fraîcheur du suivi (basée sur la dernière interaction)`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${freshness.dot}`} />
                  {freshness.label}
                </span>
              </div>
              <h2 className="text-xl font-bold text-gray-900 truncate">{name}</h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
                <span className={`font-semibold ${amount > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                  {formatEuro(amount)}
                </span>
                {lead.source_name && (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: lead.source_color || '#9ca3af' }} />
                    {lead.source_name}
                  </span>
                )}
                {lead.long_term_started_at && (
                  <span className="text-xs">
                    En MT-LT depuis {formatShortDate(lead.long_term_started_at)}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors shrink-0"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Contacts en ligne */}
          {(lead.phone || lead.email || lead.city) && (
            <div className="flex flex-wrap gap-3 mt-3 text-xs text-gray-600">
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 hover:text-blue-600">
                  <Phone className="h-3 w-3" />
                  {lead.phone}
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 hover:text-blue-600 truncate max-w-[180px]">
                  <Mail className="h-3 w-3" />
                  {lead.email}
                </a>
              )}
              {lead.city && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {lead.city}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 px-6 py-5 space-y-6">
          {/* Notes contextuelles */}
          <NotesEditor
            leadId={leadId}
            initialNotes={lead.long_term_notes}
            onSaved={onLeadUpdated}
          />

          {/* Timeline interactions */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">
                Interactions ({interactions.length})
              </h3>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter une interaction
              </button>
            </div>

            <InteractionTimeline
              interactions={interactions}
              isLoading={loadingInteractions}
              onDelete={handleDeleteInteraction}
              isDeletingId={deletingId}
            />
          </div>
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-3">
          <div className="flex flex-wrap gap-2 justify-between">
            <button
              type="button"
              onClick={() => setPendingLost(true)}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              Perdu
            </button>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleReactivate}
                disabled={isBusy}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                title="Remettre en Devis envoyé dans le pipeline"
              >
                <RotateCcw className="h-4 w-4" />
                Réactiver
              </button>
              <button
                type="button"
                onClick={handleWon}
                disabled={isBusy}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
                Gagné
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modale ajout interaction */}
      <AddInteractionModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onConfirm={handleAddInteraction}
        loading={isCreating}
      />

      {/* Modale motif Perdu */}
      {pendingLost && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Motif de perte</h3>
              <button
                onClick={() => setPendingLost(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <select
                value={lostReasonSelect}
                onChange={(e) => setLostReasonSelect(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                autoFocus
              >
                <option value="">Sélectionner un motif…</option>
                {LOST_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
                <option value="Autre">Autre (préciser)</option>
              </select>

              {lostReasonSelect === 'Autre' && (
                <input
                  type="text"
                  value={lostReasonCustom}
                  onChange={(e) => setLostReasonCustom(e.target.value)}
                  placeholder="Précisez le motif…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  autoFocus
                />
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setPendingLost(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleConfirmLost}
                disabled={isBusy || !lostReasonSelect || (lostReasonSelect === 'Autre' && !lostReasonCustom.trim())}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LongTermLeadDrawer;
