/**
 * ChantierModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale orchestrateur pour un chantier.
 * Contient : infos client, commandes, intervention, notes, transitions.
 *
 * @version 1.0.0 - Sprint 6 Chantiers
 * ============================================================================
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Loader2, ArrowLeft, ArrowRight, User, MapPin, FileText, Car, Layers, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { formatEuroCeil } from '@/lib/utils';
import { getDrivingFromAddress } from '@/lib/zoneDetection';
import { getOrgHeadquarters } from '@/lib/territoire-config';
import {
  CHANTIER_TRANSITIONS,
  getChantierStatusConfig,
  getChantierAmount,
} from '@services/chantiers.service';
import { useChantierMutations } from '@hooks/useChantiers';
import { useCanAccess } from '@hooks/usePermissions';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { AdresseItineraire } from '@/apps/artisan/components/shared/AdresseItineraire';
import { formaterAdresse } from '@/lib/itineraire';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useTeamMembers, useChantierAppointments } from '@hooks/useAppointments';
import { appointmentsService } from '@services/appointments.service';
import { appointmentKeys } from '@hooks/cacheKeys';
import { useQueryClient } from '@tanstack/react-query';
import { FormField, TextInput, TextArea } from '@apps/artisan/components/FormFields';
import { poseProvisoire } from '@/lib/installOrder';
import { enApresVente } from '@/lib/chantierApresVente';
import { ChantierApresVenteSection } from './ChantierApresVenteSection';
import { ChantierPvSection } from './ChantierPvSection';
import { ChantierReceptionSection } from './ChantierReceptionSection';
import { ChantierInterventionSection } from './ChantierInterventionSection';
import { GroupChantiersDialog } from './GroupChantiersDialog';
import { PoserRdvModal } from '@apps/artisan/components/planning/PoserRdvModal';
import { MODAL_PANEL_PHONE, MODAL_FOOTER_PHONE } from '@/lib/modalClasses';
import { logger } from '@lib/logger';
import { MenuActions } from '@/components/ui/menu-actions';

export function ChantierModal({ chantier, onClose, onUpdated, effectiveRole, canEditAll = true }) {
  const { organization, user } = useAuth();
  const navigate = useNavigate();
  const orgId = organization?.id;

  const {
    updateChantierStatus,
    updateChantierNotes,
    updatePlannedOrder,
    updateLabel,
    deleteChantier,
    isUpdatingStatus,
    isDeleting,
  } = useChantierMutations();
  const { can } = useCanAccess();

  const { members } = useTeamMembers(orgId);
  const queryClient = useQueryClient();
  // Jours d'installation = appointments `installation` du chantier (chantier_id)
  const { appointments: installAppointments, refresh: refreshInstallAppointments } =
    useChantierAppointments(orgId, chantier?.id);

  // État local
  const [notes, setNotes] = useState(chantier?.chantier_notes || '');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [label, setLabel] = useState(chantier?.label || '');
  useEffect(() => { setLabel(chantier?.label || ''); }, [chantier?.id, chantier?.label]);

  // Grouper / supprimer ce chantier
  const [showGroup, setShowGroup] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  // Planification installation (assistant créneaux)
  const [showScheduler, setShowScheduler] = useState(false);

  // Commande « personnes × jours » (spec 2026-09-21) : persistée sur le chantier,
  // l'assistant et le badge J i/N en dérivent. Sauvegarde au blur, sans bloquer.
  const plannedOrder = useMemo(
    () => ({ teamSize: chantier?.planned_team_size ?? null, days: chantier?.planned_days ?? null }),
    [chantier?.planned_team_size, chantier?.planned_days],
  );
  const handlePlannedOrderChange = async ({ teamSize, days }) => {
    try {
      await updatePlannedOrder(chantier.id, { teamSize, days });
      onUpdated?.();
    } catch (err) {
      logger.error('[ChantierModal] updatePlannedOrder error:', err);
      toast.error('Impossible d\'enregistrer la commande');
    }
  };


  // Trajet depuis le siège de l'org (P0.19 — paramétré via settings, fallback Mayer/Gaillac
  // tant que territoire_centers n'est pas configuré). Calcul Mapbox idempotent (cache module).
  const { settings: orgSettings } = useOrgSettings();
  const orgHq = useMemo(() => getOrgHeadquarters(orgSettings), [orgSettings]);
  const [drivingInfo, setDrivingInfo] = useState(null);
  const [isLoadingDriving, setIsLoadingDriving] = useState(false);

  useEffect(() => {
    if ((!chantier?.postal_code && !chantier?.city) || !orgHq) {
      setDrivingInfo(null);
      return;
    }
    let cancelled = false;
    setIsLoadingDriving(true);
    getDrivingFromAddress(
      chantier.address || '',
      chantier.postal_code || '',
      chantier.city || '',
      orgHq
    )
      .then((result) => {
        if (cancelled) return;
        setDrivingInfo(result.durationMinutes != null ? result : null);
      })
      .catch(() => {
        if (!cancelled) setDrivingInfo(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDriving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chantier?.id, chantier?.address, chantier?.postal_code, chantier?.city, orgHq]);

  if (!chantier) return null;

  // PV de réception : archivé (signé sur tablette) ou signé en ligne par le client.
  const pvSigne = Boolean(chantier.pv_reception_path || chantier.pv_signed_at);

  const statusConfig = getChantierStatusConfig(chantier.chantier_status);
  const isTechnicien = effectiveRole === 'technicien';
  const isOwner = chantier.assigned_user_id === user?.id;
  const canEditChantier = canEditAll || isOwner;
  // Réceptionné ou facturé : le chantier est terminé (Eric 2026-11-21 : appros et planification n'ont plus de sens).
  const receptionne = enApresVente(chantier);

  // Technicien : seulement planification → réalisé
  const allTransitions = CHANTIER_TRANSITIONS[chantier.chantier_status] || [];
  const allowedTransitions = isTechnicien
    ? allTransitions.filter(
        (t) => chantier.chantier_status === 'planification' && t === 'realise',
      )
    : canEditChantier
      ? allTransitions
      : [];
  // Grouper (≥ 2 chantiers sur le lead) / supprimer (chantier vide : ni devis validé, ni RDV, ni PV)
  const canGroup = can('chantiers', 'edit') && Number(chantier.lead_chantiers_count) >= 2;
  const canDelete = can('chantiers', 'edit') && Number(chantier.validated_quotes_count) === 0
    && !installAppointments.length && !pvSigne;
  const name = `${chantier.last_name || ''} ${chantier.first_name || ''}`.trim() || 'Sans nom';
  const amount = getChantierAmount(chantier);

  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    try {
      await updateChantierNotes(chantier.id, notes);
      toast.success('Notes sauvegardées');
      onUpdated?.();
    } catch {
      toast.error('Erreur de sauvegarde');
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleSaveLabel = async () => {
    if ((label || '').trim() === (chantier.label || '')) return;
    try {
      await updateLabel(chantier.id, label);
      onUpdated?.();
    } catch {
      toast.error('Impossible d\'enregistrer le libellé');
    }
  };

  const handleSignPv = () => {
    onClose();
    navigate(`/chantiers/${chantier.id}/pv-reception`);
  };

  const handleTransition = async (newStatus) => {
    // Bloquer transition vers réceptionné sans PV
    if (newStatus === 'realise' && !pvSigne) {
      toast.error('Le PV de réception doit d\'abord être signé');
      return;
    }
    try {
      await updateChantierStatus(chantier.id, newStatus);
      toast.success(`Statut mis à jour`);
      onUpdated?.();
      onClose();
    } catch (err) {
      // Recul refusé : une pose à venir retient la carte, le service dit laquelle.
      toast.error(err?.code === 'pose_a_venir' ? err.message : 'Erreur de transition');
    }
  };

  // Échappatoire : passer en « Réceptionné » sans PV signé (chantier terminé
  // mais PV non récupéré). Contourne volontairement le garde-fou PV.
  const handleValidateReceptionWithoutPv = async () => {
    if (!window.confirm(
      'Passer ce chantier en « Réceptionné » sans PV de réception signé ?\n\n'
      + 'Le PV pourra toujours être signé plus tard depuis la fiche.'
    )) return;
    try {
      await updateChantierStatus(chantier.id, 'realise');
      toast.success('Chantier réceptionné');
      onUpdated?.();
      onClose();
    } catch {
      toast.error('Erreur de transition');
    }
  };

  // Jours d'installation posés depuis la fenêtre unique « Nouveau RDV » (rattachée au chantier :
  // chantier_id + lead_id ; createAppointment → syncCardStateOnCreate avance le chantier en
  // « planification »). Ici, ce qui est propre à la fiche : sa liste de jours et le kanban.
  const handleInstallationPosee = async () => {
    setShowScheduler(false);
    refreshInstallAppointments();
    queryClient.invalidateQueries({ queryKey: appointmentKeys.lists(orgId) });
    onUpdated?.();
  };

  // Supprimer un jour d'installation (throw en cas d'erreur → la section catch + toast).
  const handleDeleteInstallAppointment = async (appointmentId) => {
    const { error } = await appointmentsService.deleteAppointment(appointmentId);
    if (error) throw error;
    refreshInstallAppointments();
    queryClient.invalidateQueries({ queryKey: appointmentKeys.lists(orgId) });
    onUpdated?.();
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Contenu */}
      <div className={`relative bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[calc(100vh-4rem)] flex flex-col ${MODAL_PANEL_PHONE}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: statusConfig.color }}
            />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-secondary-900 truncate">{name}</h2>
              <p className="text-xs text-secondary-500">{statusConfig.label}</p>
              {chantier.label && <p className="text-xs text-secondary-500 truncate">{chantier.label}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-secondary-400 hover:text-secondary-600 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Mode planification : seul l'assistant à l'écran (Eric 2026-11-03 : le haut de
              la fiche prenait la place de la grille et cachait le bouton de validation). */}
          {!showScheduler && (<>
          {/* Infos client */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-secondary-700">
              <User className="w-4 h-4 text-secondary-400" />
              <span>{name}</span>
              {amount > 0 && (
                <span className="ml-auto text-sm font-semibold text-emerald-700">
                  {formatEuroCeil(amount)}
                </span>
              )}
            </div>
            {(chantier.address || chantier.postal_code || chantier.city) && (
              <div className="flex items-start gap-2 text-sm text-secondary-500">
                <MapPin className="w-4 h-4 text-secondary-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <AdresseItineraire
                    sansIcone
                    adresse={formaterAdresse({ address: chantier.address, postalCode: chantier.postal_code, city: chantier.city })}
                    className="text-sm text-secondary-500"
                  />
                  {isLoadingDriving && (
                    <div className="text-xs text-secondary-400 mt-0.5 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Calcul du trajet…
                    </div>
                  )}
                  {!isLoadingDriving && drivingInfo && (
                    <div className="text-xs text-secondary-400 mt-0.5 flex items-center gap-1">
                      <Car className="w-3 h-3" />
                      {drivingInfo.durationMinutes} min · {drivingInfo.distanceKm} km{orgHq?.label ? ` depuis ${orgHq.label}` : ''}
                    </div>
                  )}
                </div>
              </div>
            )}
            {chantier.equipment_type_label && (
              <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                {chantier.equipment_type_label}
              </span>
            )}
            {!isTechnicien && (
              <FormField label="Libellé du chantier">
                <TextInput
                  value={label}
                  onChange={setLabel}
                  onBlur={handleSaveLabel}
                  placeholder="Ex. Installation d'une pompe à chaleur"
                  disabled={!canEditChantier}
                />
              </FormField>
            )}
          </div>

          {/* Section réception marchandise (devis Pennylane ligne par ligne).
              Chantier réceptionné : plus rien à commander ni à recevoir, la section disparaît. */}
          {!isTechnicien && !receptionne && (
            <>
              <ChantierReceptionSection
                chantier={chantier}
                onUpdated={onUpdated}
                disabled={!canEditChantier}
                appointments={installAppointments}
              />

            </>
          )}
          </>)}

          {/* Section installation (Bloc B stage 4 : jours = appointments `installation`).
              Chantier réceptionné : on ne planifie plus ; les jours de pose restent lisibles, sans geste. */}
          {(!receptionne || installAppointments.length > 0) && (
            <ChantierInterventionSection
              appointments={installAppointments}
              plannedOrder={plannedOrder}
              onSchedule={() => setShowScheduler(true)}
              onDeleteAppointment={handleDeleteInstallAppointment}
              provisoire={poseProvisoire(chantier)}
              disabled={!canEditChantier || receptionne}
            />
          )}

          {/* PV de réception — visible dès que la pose est planifiée */}
          {['planification', 'realise', 'facture'].includes(chantier.chantier_status) && (
            <ChantierPvSection
              chantier={chantier}
              canEdit={canEditChantier}
              isUpdatingStatus={isUpdatingStatus}
              onSignerSurPlace={handleSignPv}
              onValiderSansPv={handleValidateReceptionWithoutPv}
              onUpdated={onUpdated}
            />
          )}

          {/* Après-vente (avis, contrat, facturation) — chantier réceptionné, hors technicien */}
          {enApresVente(chantier) && !isTechnicien && (
            <ChantierApresVenteSection chantier={chantier} onUpdated={onUpdated} peutAgir={canEditChantier} />
          )}

          {/* Notes */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Notes
            </h3>
            <FormField>
              <TextArea
                value={notes}
                onChange={canEditChantier ? setNotes : undefined}
                placeholder="Notes sur le chantier..."
                rows={3}
                disabled={!canEditChantier}
              />
            </FormField>
            {canEditChantier && notes !== (chantier.chantier_notes || '') && (
              <button
                type="button"
                onClick={handleSaveNotes}
                disabled={isSavingNotes}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50 transition-colors"
              >
                {isSavingNotes ? 'Sauvegarde...' : 'Sauvegarder les notes'}
              </button>
            )}
          </div>
        </div>

        {/* Footer : transitions */}
        {!showScheduler && (allowedTransitions.length > 0 || canGroup || canDelete) && (() => {
          const currentOrder = statusConfig.display_order;
          const backTransitions = allowedTransitions.filter((t) => {
            const cfg = getChantierStatusConfig(t);
            return cfg.display_order < currentOrder;
          });
          const forwardTransitions = allowedTransitions.filter((t) => {
            const cfg = getChantierStatusConfig(t);
            return cfg.display_order > currentOrder;
          });

          return (
            <div className={`px-5 py-3 border-t bg-secondary-50 rounded-b-xl flex items-center gap-2 flex-wrap ${MODAL_FOOTER_PHONE}`}>
              {/* Retour arrière à gauche */}
              {backTransitions.map((targetStatus) => {
                const config = getChantierStatusConfig(targetStatus);
                return (
                  <button
                    key={targetStatus}
                    type="button"
                    onClick={() => handleTransition(targetStatus)}
                    disabled={isUpdatingStatus}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-secondary-300 text-secondary-500 bg-white transition-colors hover:shadow-sm hover:bg-secondary-100 disabled:opacity-50"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Revenir à « {config.label} »
                  </button>
                );
              })}

              {canGroup && (
                <button type="button" onClick={() => setShowGroup(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-secondary-300 text-secondary-600 bg-white hover:bg-secondary-100">
                  <Layers className="w-3.5 h-3.5" /> Grouper avec…
                </button>
              )}
              {/* Supprimer : menu « … », jamais à côté des boutons de statut (brief UX, règle 2) */}
              {canDelete && (
                <MenuActions
                  libelle="Autres actions sur le chantier"
                  align="start"
                  actions={[{ label: 'Supprimer ce chantier', icon: Trash2, danger: true, onClick: () => setShowDelete(true) }]}
                />
              )}

              <div className="flex-1" />

              {/* Avancer à droite */}
              {forwardTransitions.map((targetStatus) => {
                const config = getChantierStatusConfig(targetStatus);
                const needsPv = targetStatus === 'realise' && !pvSigne;
                return (
                  <button
                    key={targetStatus}
                    type="button"
                    onClick={() => handleTransition(targetStatus)}
                    disabled={isUpdatingStatus || needsPv}
                    title={needsPv ? 'PV de réception requis' : undefined}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      borderColor: config.color,
                      color: config.color,
                      backgroundColor: `${config.color}08`,
                    }}
                  >
                    Passer à « {config.label} »
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>

    {showGroup && <GroupChantiersDialog chantier={chantier} onClose={() => setShowGroup(false)} onGrouped={onUpdated} />}
    <ConfirmDialog
      open={showDelete}
      onOpenChange={setShowDelete}
      title="Supprimer ce chantier ?"
      description="Le chantier disparaît du kanban. Les devis non validés restent attachés au lead. Aucun devis validé, RDV ni PV ne sera perdu (la suppression est refusée s'il en reste)."
      confirmLabel={isDeleting ? 'Suppression…' : 'Supprimer'}
      cancelLabel="Annuler"
      variant="destructive"
      loading={isDeleting}
      onConfirm={async () => {
        try {
          await deleteChantier(chantier.id);
          toast.success('Chantier supprimé');
          onUpdated?.();
          onClose();
        } catch (err) {
          toast.error(err?.message || 'Suppression refusée');
        }
      }}
    />

    {/* Planifier l'installation = la fenêtre unique « Nouveau RDV », rattachée au chantier */}
    {showScheduler && (
      <PoserRdvModal
        client={{
          id: chantier.client_id || null,
          last_name: chantier.last_name || '',
          first_name: chantier.first_name || '',
          phone: chantier.phone || '',
          email: chantier.email || '',
          address: chantier.address || '',
          postal_code: chantier.postal_code || '',
          city: chantier.city || '',
        }}
        members={members}
        orgId={orgId}
        attachContext={{
          leadId: chantier.lead_id,
          chantierId: chantier.id,
          lockedType: 'installation',
          multi: true,
          mergeOverlapping: true,
          fullDayClick: true,
          defaultDuration: 480,
          plannedOrder: {
            teamSize: plannedOrder.teamSize, days: plannedOrder.days, onChange: handlePlannedOrderChange,
          },
        }}
        onCreated={handleInstallationPosee}
        onClose={() => setShowScheduler(false)}
      />
    )}
    </>
  );
}

export default ChantierModal;
