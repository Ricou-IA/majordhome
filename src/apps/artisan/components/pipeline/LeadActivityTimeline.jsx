/**
 * LeadActivityTimeline.jsx - Majord'home Artisan
 * ============================================================================
 * Timeline des activités d'un lead + formulaire d'ajout de note.
 *
 * @version 1.0.0 - Sprint 4 Pipeline Commercial
 * ============================================================================
 */

import { useState } from 'react';
import {
  Plus,
  ArrowRight,
  MessageSquare,
  UserPlus,
  CheckCircle,
  Phone,
  Mail,
  MailOpen,
  Loader2,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ACTIVITY_CONFIG } from '@/shared/services/leads.service';

// Map des icônes (Lucide)
const ICON_MAP = {
  Plus,
  ArrowRight,
  MessageSquare,
  UserPlus,
  CheckCircle,
  Phone,
  Mail,
  MailOpen,
};

/**
 * @param {Object} props
 * @param {Array} props.activities - Liste des activités
 * @param {boolean} props.isLoading - Chargement
 * @param {Function} props.onAddNote - (description: string) => Promise
 * @param {boolean} props.isAddingNote - Loading ajout note
 * @param {boolean} props.disabled - Désactiver le formulaire
 */
export function LeadActivityTimeline({
  activities = [],
  isLoading = false,
  onAddNote,
  isAddingNote = false,
  disabled = false,
}) {
  const [noteText, setNoteText] = useState('');
  const [showNoteForm, setShowNoteForm] = useState(false);

  const handleSubmitNote = async () => {
    if (!noteText.trim() || !onAddNote) return;
    try {
      await onAddNote(noteText.trim());
      setNoteText('');
      setShowNoteForm(false);
    } catch (err) {
      console.error('[LeadActivityTimeline] Erreur ajout note:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bouton / formulaire ajout note */}
      {!disabled && (
        <div>
          {showNoteForm ? (
            <div className="space-y-2">
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Ajouter une note..."
                rows={3}
                className="text-base"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSubmitNote}
                  disabled={!noteText.trim() || isAddingNote}
                  className="min-h-[40px] gap-1"
                >
                  {isAddingNote ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Ajouter
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setShowNoteForm(false); setNoteText(''); }}
                  className="min-h-[40px]"
                >
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowNoteForm(true)}
              className="min-h-[40px] gap-1"
            >
              <MessageSquare className="h-4 w-4" />
              Ajouter une note
            </Button>
          )}
        </div>
      )}

      {/* Liste des activités */}
      {activities.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-4 text-center">
          Aucune activité enregistrée
        </p>
      ) : (
        <div className="relative">
          {/* Ligne verticale */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200" />

          <div className="space-y-4">
            {activities.map((activity) => {
              const config = ACTIVITY_CONFIG[activity.activity_type] || ACTIVITY_CONFIG.note;
              const IconComponent = ICON_MAP[config.icon] || MessageSquare;

              return (
                <div key={activity.id} className="relative flex gap-3 pl-1">
                  {/* Point sur la timeline */}
                  <div
                    className={`relative z-10 flex items-center justify-center h-8 w-8 rounded-full shrink-0 ${config.color}`}
                  >
                    <IconComponent className="h-4 w-4" />
                  </div>

                  {/* Contenu */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-sm text-gray-800">
                      {activity.description}
                    </p>

                    {/* Badges ancien/nouveau statut pour les changements */}
                    {activity.activity_type === 'status_changed' && activity.old_status && activity.new_status && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded text-white"
                          style={{ backgroundColor: activity.old_status.color }}
                        >
                          {activity.old_status.label}
                        </span>
                        <ArrowRight className="h-3 w-3 text-gray-400" />
                        <span
                          className="text-xs px-1.5 py-0.5 rounded text-white"
                          style={{ backgroundColor: activity.new_status.color }}
                        >
                          {activity.new_status.label}
                        </span>
                      </div>
                    )}

                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(activity.created_at).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {activity.user_full_name && (
                        <span className="ml-1.5 text-gray-300">— {activity.user_full_name}</span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default LeadActivityTimeline;
