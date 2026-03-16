/**
 * ProspectDrawer.jsx — Slide-over droit pour voir/éditer un prospect
 * Pattern identique à LeadModal (backdrop + fixed right panel).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Save,
  Trash2,
  Building2,
  UserCircle,
  TrendingUp,
  ArrowRightLeft,
  Clock,
  Plus,
  UserCheck,
  FileText,
  Phone,
  Mail,
  Loader2,
} from 'lucide-react';
import {
  FormField,
  TextInput,
  SelectInput,
  TextArea,
  SectionTitle,
} from '@apps/artisan/components/FormFields';
import { useProspect, useProspectInteractions, useProspectMutations } from '@hooks/useProspects';
import { useAuth } from '@contexts/AuthContext';
import { formatEuro, formatDateShortFR } from '@/lib/utils';
import { toast } from 'sonner';

// ============================================================================
// INTERACTION TYPE LABELS
// ============================================================================

const INTERACTION_LABELS = {
  status_changed: { label: 'Changement statut', icon: ArrowRightLeft, color: 'text-blue-500' },
  note: { label: 'Note', icon: FileText, color: 'text-secondary-500' },
  phone_call: { label: 'Appel', icon: Phone, color: 'text-emerald-500' },
  email_sent: { label: 'Email', icon: Mail, color: 'text-violet-500' },
  document_added: { label: 'Document', icon: FileText, color: 'text-amber-500' },
  converted: { label: 'Converti en client', icon: UserCheck, color: 'text-emerald-600' },
  score_updated: { label: 'Score modifié', icon: TrendingUp, color: 'text-[#2196F3]' },
  contact_added: { label: 'Contact ajouté', icon: Plus, color: 'text-[#F5C542]' },
};

// ============================================================================
// DRAWER
// ============================================================================

export default function ProspectDrawer({
  prospectId,
  isOpen,
  onClose,
  module,
  statuses = [],
  transitions = {},
  onDeleted,
  onConverted,
}) {
  const { user } = useAuth();
  const { prospect, isLoading, updateProspect, isUpdating } = useProspect(prospectId);
  const { interactions, isLoading: loadingInteractions, addInteraction } = useProspectInteractions(prospectId);
  const { updateStatus, deleteProspect, convertToClient, isConverting, isDeleting } =
    useProspectMutations();
  const { organization } = useAuth();
  const orgId = organization?.id;

  // Form state local
  const [form, setForm] = useState({});
  const [newNote, setNewNote] = useState('');

  // Sync prospect → form
  useEffect(() => {
    if (prospect) {
      setForm({
        score: prospect.score ?? 0,
        priorite: prospect.priorite || '',
        valorisation_estimee: prospect.valorisation_estimee || '',
        contact_telephone: prospect.contact_telephone || '',
        contact_email: prospect.contact_email || '',
        notes: prospect.notes || '',
      });
    }
  }, [prospect]);

  const setField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ========== HANDLERS ==========

  const handleSave = async () => {
    const updates = {};
    if (form.score !== prospect.score) updates.score = parseInt(form.score, 10) || 0;
    if (form.priorite !== (prospect.priorite || '')) updates.priorite = form.priorite || null;
    if (module === 'cedants') {
      if (form.valorisation_estimee !== (prospect.valorisation_estimee || ''))
        updates.valorisation_estimee = parseInt(form.valorisation_estimee, 10) || null;
    }
    if (module === 'commercial') {
      if (form.contact_telephone !== (prospect.contact_telephone || ''))
        updates.contact_telephone = form.contact_telephone;
      if (form.contact_email !== (prospect.contact_email || ''))
        updates.contact_email = form.contact_email;
    }
    if (form.notes !== (prospect.notes || '')) updates.notes = form.notes;

    if (Object.keys(updates).length === 0) {
      toast.info('Aucune modification');
      return;
    }

    const { error } = await updateProspect(updates);
    if (error) {
      toast.error('Erreur lors de la sauvegarde');
    } else {
      toast.success('Prospect mis à jour');
    }
  };

  const handleStatusChange = async (newStatus) => {
    if (!prospect || newStatus === prospect.statut) return;
    const { error } = await updateStatus(prospect.id, newStatus, user?.id);
    if (error) {
      toast.error('Erreur lors du changement de statut');
    } else {
      toast.success('Statut mis à jour');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Supprimer ce prospect ?')) return;
    const { error } = await deleteProspect(prospect.id);
    if (error) {
      toast.error('Erreur lors de la suppression');
    } else {
      toast.success('Prospect supprimé');
      onDeleted?.();
      onClose();
    }
  };

  const handleConvert = async () => {
    if (!confirm('Convertir ce prospect en client ?')) return;
    const result = await convertToClient(prospect.id, orgId, user?.id);
    if (result?.error) {
      toast.error(result.error.message || 'Erreur lors de la conversion');
    } else {
      toast.success('Prospect converti en client !');
      onConverted?.(result?.data?.client);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    try {
      await addInteraction({
        type: 'note',
        contenu: newNote.trim(),
        userId: user?.id,
      });
      setNewNote('');
      toast.success('Note ajoutée');
    } catch {
      toast.error('Erreur lors de l\'ajout de la note');
    }
  };

  // ========== RENDER ==========

  if (!isOpen) return null;

  const allowedStatuses = prospect
    ? (transitions[prospect.statut] || []).map((key) => statuses.find((s) => s.key === key)).filter(Boolean)
    : [];

  const currentStatus = statuses.find((s) => s.key === prospect?.statut);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-white sticky top-0 z-10">
          <div className="min-w-0 flex-1">
            {isLoading ? (
              <div className="h-6 w-48 bg-secondary-200 rounded animate-pulse" />
            ) : (
              <>
                <h2 className="text-lg font-semibold text-secondary-900 truncate">
                  {prospect?.raison_sociale}
                </h2>
                <p className="text-xs text-secondary-400">{prospect?.siren}</p>
              </>
            )}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-secondary-100 rounded-lg ml-2">
            <X className="h-5 w-5 text-secondary-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-[#2196F3]" />
            </div>
          ) : prospect ? (
            <>
              {/* ── Statut & Score ── */}
              <div className="flex items-center gap-3 mb-4">
                {currentStatus && (
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium"
                    style={{ backgroundColor: `${currentStatus.color}20`, color: currentStatus.color }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentStatus.color }} />
                    {currentStatus.label}
                  </span>
                )}
                <span className="text-sm text-secondary-500">
                  Score : <strong className="text-secondary-900">{prospect.score}</strong>/100
                </span>
              </div>

              {/* ── Entreprise ── */}
              <SectionTitle>Entreprise</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <InfoField label="NAF" value={prospect.naf} />
                <InfoField label="Forme juridique" value={prospect.forme_juridique} />
                <InfoField label="Effectif" value={prospect.tranche_effectif_salarie} />
                <InfoField label="Création" value={prospect.date_creation} />
                <InfoField label="Commune" value={prospect.commune} className="col-span-2" />
                <InfoField label="Adresse" value={prospect.adresse} className="col-span-2" />
              </div>

              {/* ── Dirigeant ── */}
              {prospect.dirigeant_nom && (
                <>
                  <SectionTitle>Dirigeant</SectionTitle>
                  <div className="grid grid-cols-2 gap-3">
                    <InfoField label="Nom" value={`${prospect.dirigeant_prenoms || ''} ${prospect.dirigeant_nom}`.trim()} />
                    <InfoField label="Qualité" value={prospect.dirigeant_qualite} />
                    <InfoField label="Année naissance" value={prospect.dirigeant_annee_naissance} />
                  </div>
                </>
              )}

              {/* ── Financier ── */}
              {(prospect.ca_annuel || prospect.resultat_net) && (
                <>
                  <SectionTitle>Données financières</SectionTitle>
                  <div className="grid grid-cols-2 gap-3">
                    <InfoField label="CA annuel" value={prospect.ca_annuel ? formatEuro(prospect.ca_annuel) : null} />
                    <InfoField label="Résultat net" value={prospect.resultat_net ? formatEuro(prospect.resultat_net) : null} />
                    <InfoField label="Année bilan" value={prospect.annee_bilan} />
                  </div>
                </>
              )}

              {/* ── Pipeline (éditable) ── */}
              <SectionTitle>Pipeline</SectionTitle>
              <div className="space-y-3">
                {allowedStatuses.length > 0 && (
                  <FormField label="Changer le statut">
                    <div className="flex flex-wrap gap-2">
                      {allowedStatuses.map((s) => (
                        <button
                          key={s.key}
                          type="button"
                          onClick={() => handleStatusChange(s.key)}
                          className="px-3 py-1.5 text-sm rounded-lg border transition-colors hover:shadow-sm"
                          style={{
                            borderColor: s.color,
                            color: s.color,
                            backgroundColor: `${s.color}10`,
                          }}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </FormField>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Score">
                    <TextInput
                      type="number"
                      value={form.score}
                      onChange={(v) => setField('score', v)}
                      min={0}
                      max={100}
                    />
                  </FormField>
                  {module === 'cedants' && (
                    <FormField label="Priorité">
                      <SelectInput
                        value={form.priorite}
                        onChange={(v) => setField('priorite', v)}
                        placeholder="Aucune"
                        options={[
                          { value: 'A', label: '★ Priorité A' },
                          { value: 'B', label: 'Priorité B' },
                        ]}
                      />
                    </FormField>
                  )}
                </div>
              </div>

              {/* ── Cédants specific ── */}
              {module === 'cedants' && (
                <>
                  <SectionTitle>Acquisition</SectionTitle>
                  <FormField label="Valorisation estimée (€)">
                    <TextInput
                      type="number"
                      value={form.valorisation_estimee}
                      onChange={(v) => setField('valorisation_estimee', v)}
                      placeholder="Ex: 500000"
                    />
                  </FormField>
                  {/* contacts_conseils et documents JSONB — édition simplifiée via notes */}
                </>
              )}

              {/* ── Commercial specific ── */}
              {module === 'commercial' && (
                <>
                  <SectionTitle>Contact direct</SectionTitle>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Téléphone">
                      <TextInput
                        value={form.contact_telephone}
                        onChange={(v) => setField('contact_telephone', v)}
                        placeholder="06 12 34 56 78"
                      />
                    </FormField>
                    <FormField label="Email">
                      <TextInput
                        type="email"
                        value={form.contact_email}
                        onChange={(v) => setField('contact_email', v)}
                        placeholder="contact@entreprise.fr"
                      />
                    </FormField>
                  </div>
                </>
              )}

              {/* ── Notes ── */}
              <SectionTitle>Notes</SectionTitle>
              <TextArea
                value={form.notes}
                onChange={(v) => setField('notes', v)}
                placeholder="Notes libres..."
                rows={3}
              />

              {/* ── Conversion (Commercial) ── */}
              {module === 'commercial' && prospect.statut !== 'converti' && (
                <>
                  <SectionTitle>Conversion</SectionTitle>
                  <button
                    type="button"
                    onClick={handleConvert}
                    disabled={isConverting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 text-sm font-medium"
                  >
                    {isConverting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <UserCheck className="w-4 h-4" />
                    )}
                    Convertir en client
                  </button>
                </>
              )}

              {prospect.converted_client_id && (
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
                  <UserCheck className="w-4 h-4" />
                  Converti en client
                </div>
              )}

              {/* ── Timeline ── */}
              <SectionTitle>Historique</SectionTitle>
              <div className="space-y-2 mb-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Ajouter une note..."
                    className="flex-1 px-3 py-1.5 border border-secondary-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#2196F3]"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                  />
                  <button
                    type="button"
                    onClick={handleAddNote}
                    disabled={!newNote.trim()}
                    className="px-3 py-1.5 bg-[#2196F3] text-white rounded-lg text-sm hover:bg-[#1565C0] disabled:opacity-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {loadingInteractions ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-secondary-400" />
                </div>
              ) : interactions.length > 0 ? (
                <div className="space-y-2">
                  {interactions.map((it) => {
                    const config = INTERACTION_LABELS[it.type] || INTERACTION_LABELS.note;
                    const Icon = config.icon;
                    return (
                      <div key={it.id} className="flex items-start gap-2.5 py-2 border-b border-secondary-100 last:border-0">
                        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.color}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-secondary-700">{it.contenu || config.label}</p>
                          <p className="text-xs text-secondary-400 mt-0.5">
                            {it.created_by_name || 'Système'} · {formatDateShortFR(it.created_at)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-secondary-400 text-center py-3">Aucune interaction</p>
              )}
            </>
          ) : (
            <p className="text-center text-secondary-500 py-8">Prospect non trouvé</p>
          )}
        </div>

        {/* Footer */}
        {prospect && (
          <div className="border-t bg-white px-6 py-4 flex items-center justify-between sticky bottom-0">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              Supprimer
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isUpdating}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2196F3] text-white rounded-lg text-sm font-medium hover:bg-[#1565C0] transition-colors disabled:opacity-50"
            >
              {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================================
// SUB-COMPONENT — InfoField (read-only display)
// ============================================================================

function InfoField({ label, value, className = '' }) {
  return (
    <div className={className}>
      <p className="text-xs text-secondary-400">{label}</p>
      <p className="text-sm text-secondary-700">{value || '—'}</p>
    </div>
  );
}
