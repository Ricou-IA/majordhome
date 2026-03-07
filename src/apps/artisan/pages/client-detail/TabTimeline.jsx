import { useState } from 'react';
import { toast } from 'sonner';
import {
  MessageSquarePlus, Phone, Mail, FileText, User, Settings, Tag,
  Calendar, Wrench, Zap, ChevronRight, Clock, Pin, History,
  Loader2, Save,
} from 'lucide-react';
import { useClientActivities } from '@/shared/hooks/useClients';
import { formatDateTimeFR } from '@/lib/utils';

const ACTIVITY_ICONS = {
  note: MessageSquarePlus,
  comment: MessageSquarePlus,
  phone_call: Phone,
  email_sent: Mail,
  email_received: Mail,
  document_added: FileText,
  client_created: User,
  client_updated: Settings,
  status_changed: Tag,
  appointment_created: Calendar,
  appointment_completed: Calendar,
  intervention_scheduled: Wrench,
  intervention_completed: Wrench,
  equipment_added: Zap,
  equipment_updated: Zap,
  contract_created: FileText,
  contract_renewed: FileText,
  lead_converted: ChevronRight,
};

const ACTIVITY_COLORS = {
  note: 'bg-blue-100 text-blue-600',
  comment: 'bg-blue-100 text-blue-600',
  phone_call: 'bg-green-100 text-green-600',
  email_sent: 'bg-purple-100 text-purple-600',
  email_received: 'bg-purple-100 text-purple-600',
  client_created: 'bg-secondary-100 text-secondary-600',
  intervention_completed: 'bg-green-100 text-green-600',
  equipment_added: 'bg-amber-100 text-amber-600',
};

const ActivityItem = ({ activity }) => {
  const Icon = ACTIVITY_ICONS[activity.activity_type] || Clock;
  const colorClass = ACTIVITY_COLORS[activity.activity_type] || 'bg-secondary-100 text-secondary-600';

  return (
    <div className="flex gap-3">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${colorClass}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-secondary-900">{activity.title}</span>
          {activity.is_pinned && <Pin className="w-3 h-3 text-amber-500" />}
          {activity.is_system && <span className="text-xs text-secondary-400">auto</span>}
        </div>
        {activity.description && <p className="text-sm text-secondary-600 mt-0.5 line-clamp-2">{activity.description}</p>}
        <p className="text-xs text-secondary-400 mt-1">{formatDateTimeFR(activity.created_at)}</p>
      </div>
    </div>
  );
};

export const TabTimeline = ({ clientId, orgId, userId }) => {
  const { activities, isLoading, addNote, isAddingNote } = useClientActivities(clientId);
  const [showForm, setShowForm] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteDescription, setNoteDescription] = useState('');

  const handleAddNote = async () => {
    if (!noteTitle.trim()) return;
    try {
      await addNote({
        orgId,
        title: noteTitle.trim(),
        description: noteDescription.trim() || null,
        activityType: 'note',
        createdBy: userId,
      });
      setNoteTitle('');
      setNoteDescription('');
      setShowForm(false);
      toast.success('Note ajoutée');
    } catch {
      toast.error("Erreur lors de l'ajout de la note");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
          <MessageSquarePlus className="w-4 h-4" />
          Ajouter une note
        </button>
      ) : (
        <div className="p-4 bg-primary-50 border border-primary-200 rounded-lg space-y-3">
          <input
            type="text"
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
            placeholder="Titre de la note..."
            className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            autoFocus
          />
          <textarea
            value={noteDescription}
            onChange={(e) => setNoteDescription(e.target.value)}
            placeholder="Détails (optionnel)..."
            rows={2}
            className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddNote}
              disabled={!noteTitle.trim() || isAddingNote}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {isAddingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Ajouter
            </button>
            <button
              onClick={() => { setShowForm(false); setNoteTitle(''); setNoteDescription(''); }}
              className="px-3 py-1.5 text-sm text-secondary-600 hover:bg-secondary-100 rounded-lg transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {activities.length === 0 ? (
        <div className="text-center py-12">
          <History className="w-12 h-12 text-secondary-300 mx-auto" />
          <p className="mt-4 text-secondary-700 font-medium">Aucune activité</p>
          <p className="mt-1 text-sm text-secondary-500">L'historique des actions apparaîtra ici.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activities.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
        </div>
      )}
    </div>
  );
};
