/**
 * LeadModalFrame.jsx — en-tête et pied du slide-over LeadModal (présentation seule).
 */
import { X, Save, Loader2, ArrowLeft, Trash2, Link2, GitMerge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MenuActions } from '@/components/ui/menu-actions';

/**
 * En-tête : titre, statut courant, retour depuis le mode planification RDV.
 * `onBack` est fourni seulement en mode planification (sinon la croix ferme la modale).
 */
export function LeadModalHeader({ isEditing, currentStatus, pennylaneActive, onAttachQuotes, scheduling, contactName, onBack, onClose }) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b bg-white sticky top-0 z-10">
      <div className="flex items-center gap-3">
        {scheduling && (
          <button
            onClick={onBack}
            className="p-1.5 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div>
          <h2 className="text-lg font-semibold text-secondary-900">
            {scheduling
              ? 'Planifier le RDV'
              : isEditing ? 'Modifier le lead' : 'Nouveau lead'
            }
          </h2>
          {!scheduling && isEditing && currentStatus && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <Badge
                className="text-xs text-white"
                style={{ backgroundColor: currentStatus.color }}
              >
                {currentStatus.label}
              </Badge>
              {/* TEMP backfill — point d'entrée QuoteCandidatesModal sur les leads
                  déjà en "Devis envoyé" (pour rattacher leurs devis PL existants).
                  À revert une fois le backfill manuel terminé. */}
              {pennylaneActive && currentStatus.label === 'Devis envoyé' && (
                <button
                  type="button"
                  onClick={onAttachQuotes}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors"
                  title="Rattacher des devis Pennylane à ce lead (temporaire — backfill)"
                >
                  <Link2 className="w-3 h-3" />
                  Rattacher devis PL
                </button>
              )}
            </div>
          )}
          {scheduling && (
            <p className="text-sm text-secondary-500 mt-0.5">{contactName}</p>
          )}
        </div>
      </div>
      <button
        onClick={scheduling ? onBack : onClose}
        className="p-2 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg transition-colors"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

/**
 * Pied : Fermer (Annuler pour une demande pas encore créée) et Enregistrer. Fusionner et
 * Supprimer (org_admin) sont dans le menu « … » à gauche, jamais à côté d'Enregistrer ;
 * la suppression se confirme en retapant le nom (LeadHardDeleteDialog).
 */
export function LeadModalFooter({ isEditing, isAdmin, isSaving, isHardDeleting, onCancel, onMerge, onHardDelete, onSave }) {
  const actions = isEditing && isAdmin ? [
    { label: 'Fusionner avec un doublon', icon: GitMerge, onClick: onMerge },
    { separateur: true },
    { label: 'Supprimer définitivement', icon: Trash2, danger: true, disabled: isHardDeleting, onClick: onHardDelete },
  ] : [];
  return (
    <div className="border-t bg-white px-6 py-4 flex items-center justify-between gap-3 sticky bottom-0">
      <div className="flex items-center">
        <MenuActions libelle="Autres actions sur la demande" actions={actions} align="start" className="min-h-[44px] min-w-[44px]" />
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={onCancel} className="min-h-[44px]">
          {isEditing ? 'Fermer' : 'Annuler'}
        </Button>
        <Button
          onClick={onSave}
          disabled={isSaving}
          className="gap-2 min-h-[44px] bg-primary-600 hover:bg-primary-700"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {isEditing ? 'Enregistrer' : 'Créer le lead'}
        </Button>
      </div>
    </div>
  );
}
