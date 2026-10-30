/**
 * LeadModalFrame.jsx — en-tête et pied du slide-over LeadModal (présentation seule).
 */
import { X, Save, Loader2, ArrowLeft, Trash2, Link2, GitMerge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
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
            <p className="text-sm text-gray-500 mt-0.5">{contactName}</p>
          )}
        </div>
      </div>
      <button
        onClick={scheduling ? onBack : onClose}
        className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

/** Pied : Annuler, god mode org_admin (Fusionner / Supprimer), Enregistrer. */
export function LeadModalFooter({ isEditing, isAdmin, isSaving, isHardDeleting, onCancel, onMerge, onHardDelete, onSave }) {
  return (
    <div className="border-t bg-white px-6 py-4 flex items-center justify-between sticky bottom-0">
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onCancel} className="min-h-[44px]">
          Annuler
        </Button>
        {isEditing && isAdmin && (
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={onMerge}
              className="min-h-[44px] text-gray-600 hover:bg-gray-100 hover:text-gray-800 gap-1.5"
              title="God mode — absorber un doublon dans cette carte (org_admin)"
            >
              <GitMerge className="h-4 w-4" />
              Fusionner
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onHardDelete}
              disabled={isHardDeleting}
              className="min-h-[44px] text-red-600 hover:bg-red-50 hover:text-red-700 gap-1.5"
              title="God mode — supprimer définitivement (org_admin)"
            >
              <Trash2 className="h-4 w-4" />
              Supprimer
            </Button>
          </>
        )}
      </div>
      <Button
        onClick={onSave}
        disabled={isSaving}
        className="gap-2 min-h-[44px] bg-blue-600 hover:bg-blue-700"
      >
        {isSaving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        {isEditing ? 'Enregistrer' : 'Créer le lead'}
      </Button>
    </div>
  );
}
