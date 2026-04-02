import { useState } from 'react';
import { X, Loader2, Check, Archive, Trash2, Send, StickyNote, Trash } from 'lucide-react';
import { toast } from 'sonner';
import { useTaskNotes } from '@hooks/useTasks';

const COLORS = [
  { value: 'yellow', bg: 'bg-yellow-200', ring: 'ring-yellow-400' },
  { value: 'pink', bg: 'bg-pink-200', ring: 'ring-pink-400' },
  { value: 'blue', bg: 'bg-sky-200', ring: 'ring-sky-400' },
  { value: 'green', bg: 'bg-emerald-200', ring: 'ring-emerald-400' },
  { value: 'purple', bg: 'bg-violet-200', ring: 'ring-violet-400' },
  { value: 'orange', bg: 'bg-orange-200', ring: 'ring-orange-400' },
];

const STATUS_LABELS = {
  active: { label: 'Actif', cls: 'bg-blue-100 text-blue-700' },
  done: { label: 'Réalisé', cls: 'bg-emerald-100 text-emerald-700' },
  archived: { label: 'Archivé', cls: 'bg-gray-100 text-gray-600' },
};

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function TaskNotesSection({ taskId, userId }) {
  const { notes, isLoading, addNote, deleteNote, isAdding } = useTaskNotes(taskId);
  const [draft, setDraft] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    try {
      const result = await addNote(draft.trim());
      if (result?.error) throw result.error;
      setDraft('');
    } catch {
      toast.error('Erreur');
    }
  };

  const handleDelete = async (noteId) => {
    try {
      await deleteNote(noteId);
    } catch {
      toast.error('Erreur');
    }
  };

  return (
    <div className="pt-3 border-t">
      <div className="flex items-center gap-1.5 mb-2">
        <StickyNote className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-medium text-gray-700">Notes</span>
        {notes.length > 0 && <span className="text-xs text-gray-400">({notes.length})</span>}
      </div>

      {/* Notes list */}
      {isLoading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="w-4 h-4 text-gray-300 animate-spin" />
        </div>
      ) : notes.length > 0 ? (
        <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
          {notes.map((note) => (
            <div key={note.id} className="flex gap-2 group">
              <span
                className="w-5 h-5 rounded-full bg-gray-500 text-white text-[8px] font-medium flex items-center justify-center shrink-0 mt-0.5"
                title={note.author_name}
              >
                {getInitials(note.author_name)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{note.content}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {note.author_name} · {new Date(note.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              {note.author_id === userId && (
                <button
                  onClick={() => handleDelete(note.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-300 hover:text-red-400 shrink-0"
                  title="Supprimer"
                >
                  <Trash className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-300 mb-3">Aucune note</p>
      )}

      {/* Add note form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ajouter une note..."
          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={!draft.trim() || isAdding}
          className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700
            disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
        >
          {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}

export default function TaskModal({
  task,
  userId,
  isOrgAdmin = false,
  members = [],
  onClose,
  onUpdate,
  onMarkDone,
  onArchive,
  onDelete,
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [isImportant, setIsImportant] = useState(task.is_important);
  const [isUrgent, setIsUrgent] = useState(task.is_urgent);
  const [assignedTo, setAssignedTo] = useState(task.assigned_to || '');
  const [color, setColor] = useState(task.color);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isCreator = task.created_by === userId;
  const isAssignee = task.assigned_to === userId;
  const canEdit = (isCreator || isOrgAdmin) && task.status === 'active';
  const canArchive = (isCreator || isOrgAdmin) && task.status === 'done';
  const statusInfo = STATUS_LABELS[task.status] || STATUS_LABELS.active;

  const hasChanges =
    title !== task.title ||
    description !== (task.description || '') ||
    isImportant !== task.is_important ||
    isUrgent !== task.is_urgent ||
    assignedTo !== (task.assigned_to || '') ||
    color !== task.color;

  const handleSave = async () => {
    if (!title.trim()) return;
    setIsSaving(true);
    try {
      const updates = {};
      if (title !== task.title) updates.title = title.trim();
      if (description !== (task.description || '')) updates.description = description.trim() || null;
      if (isImportant !== task.is_important) updates.is_important = isImportant;
      if (isUrgent !== task.is_urgent) updates.is_urgent = isUrgent;
      if (assignedTo !== (task.assigned_to || '')) updates.assigned_to = assignedTo || null;
      if (color !== task.color) updates.color = color;

      await onUpdate(task.id, updates);
      toast.success('Tâche modifiée');
      onClose();
    } catch {
      toast.error('Erreur de sauvegarde');
    } finally {
      setIsSaving(false);
    }
  };

  const handleMarkDone = async () => {
    try {
      await onMarkDone(task.id);
      toast.success('Tâche marquée comme réalisée');
      onClose();
    } catch {
      toast.error('Erreur');
    }
  };

  const handleArchive = async () => {
    try {
      await onArchive(task.id);
      toast.success('Tâche archivée');
      onClose();
    } catch {
      toast.error('Erreur');
    }
  };

  const handleDelete = async () => {
    try {
      await onDelete(task.id);
      toast.success('Tâche supprimée');
      onClose();
    } catch {
      toast.error('Erreur de suppression');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Détail tâche</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.cls}`}>
              {statusInfo.label}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Titre</label>
            {canEdit ? (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            ) : (
              <p className="text-sm text-gray-800">{task.title}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            {canEdit ? (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            ) : (
              <p className="text-sm text-gray-600 whitespace-pre-wrap">
                {task.description || 'Aucune description'}
              </p>
            )}
          </div>

          {/* Priority toggles */}
          {canEdit && (
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isImportant}
                  onChange={(e) => setIsImportant(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-red-500 focus:ring-red-500"
                />
                <span className="text-sm text-gray-700">Important</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isUrgent}
                  onChange={(e) => setIsUrgent(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                />
                <span className="text-sm text-gray-700">Urgent</span>
              </label>
            </div>
          )}

          {/* Assignee */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assigné à</label>
            {canEdit ? (
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">— Non assigné —</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name || m.display_name || m.email}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-gray-800">{task.assigned_to_name || 'Non assigné'}</p>
            )}
          </div>

          {/* Color */}
          {canEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Couleur</label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={`w-7 h-7 rounded-full ${c.bg} border-2 transition-all
                      ${color === c.value ? `ring-2 ${c.ring} border-white scale-110` : 'border-transparent hover:scale-105'}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="text-xs text-gray-500 space-y-1 pt-2 border-t">
            <p>Créé par : <span className="font-medium text-gray-700">{task.created_by_name}</span></p>
            <p>Créé le : {new Date(task.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
            {task.done_at && <p>Réalisé le : {new Date(task.done_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
          </div>

          {/* Notes */}
          <TaskNotesSection taskId={task.id} userId={userId} />
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t bg-gray-50 rounded-b-xl flex items-center gap-2 shrink-0">
          {/* Delete */}
          {isCreator && task.status !== 'archived' && (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600">Confirmer ?</span>
                <button
                  onClick={handleDelete}
                  className="px-2 py-1 text-xs font-medium text-white bg-red-500 rounded hover:bg-red-600"
                >
                  Oui
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-200 rounded hover:bg-gray-300"
                >
                  Non
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                title="Supprimer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )
          )}

          <div className="flex-1" />

          {/* Action buttons */}
          {isAssignee && task.status === 'active' && (
            <button
              onClick={handleMarkDone}
              className="px-3 py-1.5 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Réalisé
            </button>
          )}

          {canArchive && (
            <button
              onClick={handleArchive}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 flex items-center gap-1.5"
            >
              <Archive className="w-4 h-4" />
              Archiver
            </button>
          )}

          {canEdit && hasChanges && (
            <button
              onClick={handleSave}
              disabled={!title.trim() || isSaving}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg
                hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              Enregistrer
            </button>
          )}

          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
