/**
 * CertificatsEntretienModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale d'orchestration des certificats d'entretien multi-équipements.
 *
 * Affiche la liste des équipements du contrat, chacun avec son statut
 * (à faire / rempli / néant) et les actions associées.
 *
 * Création lazy : au premier ouverture, crée automatiquement les
 * interventions enfants (1 par équipement) si elles n'existent pas.
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2, CheckCircle2, ClipboardCheck, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@contexts/AuthContext';
import { contractsService } from '@services/contracts.service';
import { useCertificatChildren, useCertificatEntretienMutations } from '@hooks/useCertificatEntretien';
import { CertificatEquipmentRow } from './CertificatEquipmentRow';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function CertificatsEntretienModal({ item, onClose, onUpdated }) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  // --- State ---
  const [equipments, setEquipments] = useState([]);
  const [equipmentsLoading, setEquipmentsLoading] = useState(true);
  const [parentNotes, setParentNotes] = useState(item?.report_notes || '');
  const [clientComment, setClientComment] = useState(item?.client_comment || '');
  const [mutatingChildId, setMutatingChildId] = useState(null);
  const [sendingMail, setSendingMail] = useState(false);
  const creatingRef = useRef(false);

  // --- Hooks ---
  const { children, isLoading: childrenLoading, refetch } = useCertificatChildren(item?.id);
  const {
    createChildren,
    markNeant,
    unmarkNeant,
    completeParent,
    isCreating,
    isCompleting,
  } = useCertificatEntretienMutations();

  // --- Load contract equipments ---
  useEffect(() => {
    if (!item?.contract_id) {
      setEquipmentsLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data } = await contractsService.getContractEquipments(item.contract_id);
      if (!cancelled) {
        setEquipments(data || []);
        setEquipmentsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [item?.contract_id]);

  // --- Lazy creation of children ---
  useEffect(() => {
    if (
      creatingRef.current ||
      childrenLoading ||
      equipmentsLoading ||
      children.length > 0 ||
      equipments.length === 0 ||
      !item
    ) return;

    creatingRef.current = true;
    createChildren(item.id, equipments, {
      projectId: item.project_id || item.client_project_id,
      clientId: item.client_id,
      contractId: item.contract_id,
    }).then(() => {
      refetch();
    }).catch((err) => {
      console.error('[CertificatsEntretienModal] createChildren error:', err);
      toast.error('Erreur lors de la création des certificats');
    });
  }, [childrenLoading, equipmentsLoading, children.length, equipments.length, item, createChildren, refetch]);

  // --- Handlers ---
  const handleMarkNeant = useCallback(async (childId) => {
    setMutatingChildId(childId);
    try {
      await markNeant(childId, item.id);
    } finally {
      setMutatingChildId(null);
    }
  }, [markNeant, item?.id]);

  const handleUnmarkNeant = useCallback(async (childId) => {
    setMutatingChildId(childId);
    try {
      await unmarkNeant(childId, item.id);
    } finally {
      setMutatingChildId(null);
    }
  }, [unmarkNeant, item?.id]);

  const handleComplete = useCallback(async () => {
    if (!orgId) return;
    // Save client_comment alongside completion
    if (clientComment) {
      await supabase
        .from('majordhome_interventions')
        .update({ client_comment: clientComment })
        .eq('id', item.id);
    }
    const result = await completeParent(item.id, orgId, parentNotes);
    if (result?.data?.allDone) {
      onUpdated?.();
      onClose();
    } else if (!result?.error) {
      toast.error('Tous les certificats doivent être remplis ou marqués néant');
    }
  }, [completeParent, item?.id, orgId, parentNotes, clientComment, onUpdated, onClose]);

  // --- Send mail ---
  const handleSendMail = useCallback(async () => {
    if (!item?.client_email) {
      toast.error('Pas d\'email client renseigné');
      return;
    }
    setSendingMail(true);
    try {
      // Save client_comment before sending
      await supabase
        .from('majordhome_interventions')
        .update({ client_comment: clientComment || null })
        .eq('id', item.id);

      // TODO: Webhook N8N pour envoi mail avec PDFs certificats
      // Pour l'instant on affiche un message
      toast.info('Envoi par mail — fonctionnalité à connecter avec N8N');
    } catch (err) {
      console.error('[CertificatsEntretienModal] sendMail error:', err);
      toast.error('Erreur lors de l\'envoi');
    } finally {
      setSendingMail(false);
    }
  }, [item?.id, item?.client_email, clientComment]);

  // --- Save notes (post-clôture) ---
  const [savingNotes, setSavingNotes] = useState(false);
  const handleSaveNotes = useCallback(async () => {
    setSavingNotes(true);
    try {
      await supabase
        .from('majordhome_interventions')
        .update({
          report_notes: parentNotes || null,
          client_comment: clientComment || null,
        })
        .eq('id', item.id);
      toast.success('Notes enregistrées');
    } catch (err) {
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSavingNotes(false);
    }
  }, [item?.id, parentNotes, clientComment]);

  // --- Progress ---
  const totalCount = children.length;
  const doneCount = children.filter(
    (c) => c.workflow_status === 'realise',
  ).length;
  const allDone = totalCount > 0 && doneCount === totalCount;
  const isParentRealise = item?.workflow_status === 'realise';

  // Map children by equipment_id for matching
  const childByEquipmentId = Object.fromEntries(
    children.map((c) => [c.equipment_id, c]),
  );

  // --- Loading state ---
  const loading = childrenLoading || equipmentsLoading || isCreating;

  // --- Nom client ---
  const clientName = item?.client_name ||
    [item?.client_last_name, item?.client_first_name].filter(Boolean).join(' ') ||
    'Client';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-blue-600" />
              Certificats d'entretien
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {clientName}
              {item?.contract_number && ` — ${item.contract_number}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span className="ml-2 text-sm text-gray-500">Chargement des équipements...</span>
            </div>
          ) : equipments.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-sm">Aucun équipement lié à ce contrat.</p>
            </div>
          ) : (
            <>
              {/* Barre de progression */}
              <div className="flex items-center gap-3 mb-1">
                <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      allDone ? 'bg-green-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-gray-600 whitespace-nowrap">
                  {doneCount}/{totalCount} traités
                </span>
              </div>

              {/* Liste des équipements */}
              {equipments.map((eq) => (
                <CertificatEquipmentRow
                  key={eq.id}
                  equipment={eq}
                  childIntervention={childByEquipmentId[eq.id] || null}
                  onMarkNeant={handleMarkNeant}
                  onUnmarkNeant={handleUnmarkNeant}
                  isLoading={mutatingChildId === childByEquipmentId[eq.id]?.id}
                  onCloseModal={onClose}
                />
              ))}
            </>
          )}

          {/* Commentaires */}
          {!loading && equipments.length > 0 && (
            <div className="pt-3 border-t border-gray-100 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message pour le client
                </label>
                <textarea
                  value={clientComment}
                  onChange={(e) => setClientComment(e.target.value)}
                  placeholder="Ce message sera inclus dans le mail d'envoi des certificats..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Commentaire interne
                </label>
                <textarea
                  value={parentNotes}
                  onChange={(e) => setParentNotes(e.target.value)}
                  placeholder="Notes internes, observations, facturation SAV annexe..."
                  rows={2}
                  disabled={false}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && equipments.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Fermer
            </button>

            <div className="flex items-center gap-2">
              {isParentRealise && (
                <button
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  {savingNotes ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Enregistrer
                </button>
              )}

              {isParentRealise && item?.client_email && (
                <button
                  onClick={handleSendMail}
                  disabled={sendingMail}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
                >
                  {sendingMail ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Envoyer par mail
                </button>
              )}

              {!isParentRealise && (
                <button
                  onClick={handleComplete}
                  disabled={!allDone || isCompleting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCompleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Valider et clôturer
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
