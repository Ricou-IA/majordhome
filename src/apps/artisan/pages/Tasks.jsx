import { useState, useCallback, useMemo } from 'react';
import { ListTodo, Plus, Archive, RefreshCw, Loader2, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useTasks, useArchivedTasks, useTaskMutations } from '@hooks/useTasks';
import { useOrgMembers } from '@hooks/usePermissions';
import TaskMatrix from '../components/tasks/TaskMatrix';
import TaskCreateModal from '../components/tasks/TaskCreateModal';
import TaskModal from '../components/tasks/TaskModal';
import TaskArchiveDrawer from '../components/tasks/TaskArchiveDrawer';

export default function Tasks() {
  const { organization, user, isOrgAdmin } = useAuth();
  const orgId = organization?.id;
  const userId = user?.id;

  const { tasks, isLoading, refresh } = useTasks(orgId);
  const { createTask, updateTask, markAsDone, archiveTask, deleteTask } = useTaskMutations();
  const { members } = useOrgMembers(orgId);

  // Filter
  const [filterUser, setFilterUser] = useState('all'); // 'all' | 'mine' | userId

  const filteredTasks = useMemo(() => {
    if (filterUser === 'all') return tasks;
    if (filterUser === 'mine') return tasks.filter((t) => t.assigned_to === userId || t.created_by === userId);
    return tasks.filter((t) => t.assigned_to === filterUser || t.created_by === filterUser);
  }, [tasks, filterUser, userId]);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [createDefaults, setCreateDefaults] = useState({ important: false, urgent: false });
  const [selectedTask, setSelectedTask] = useState(null);
  const [showArchives, setShowArchives] = useState(false);

  const { tasks: archivedTasks, isLoading: archivesLoading } = useArchivedTasks(orgId, showArchives);

  // Handlers
  const handleCreateInQuadrant = useCallback((important, urgent) => {
    setCreateDefaults({ important, urgent });
    setShowCreate(true);
  }, []);

  const handleCreate = useCallback(
    async (data) => {
      const result = await createTask({ orgId, ...data });
      if (result?.error) throw result.error;
    },
    [createTask, orgId]
  );

  const handleMarkDone = useCallback(
    async (taskId) => {
      try {
        const result = await markAsDone(taskId);
        if (result?.error) throw result.error;
        toast.success('Tâche marquée comme réalisée');
      } catch {
        toast.error('Erreur');
      }
    },
    [markAsDone]
  );

  const handleArchive = useCallback(
    async (taskId) => {
      try {
        const result = await archiveTask(taskId);
        if (result?.error) throw result.error;
        toast.success('Tâche archivée');
      } catch {
        toast.error('Erreur');
      }
    },
    [archiveTask]
  );

  const handleMoveQuadrant = useCallback(
    async (taskId, { is_important, is_urgent, status }) => {
      try {
        const updates = { is_important, is_urgent };
        if (status) updates.status = status;
        const result = await updateTask(taskId, updates);
        if (result?.error) throw result.error;
      } catch {
        toast.error('Erreur de déplacement');
      }
    },
    [updateTask]
  );

  // Members list for dropdowns — normalize from organization_members + profile
  const membersList = (members || []).map((m) => ({
    user_id: m.user_id,
    full_name: m.profile?.full_name || m.full_name || m.display_name || m.email || '—',
    email: m.profile?.email || m.email,
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white shrink-0">
        <div className="flex items-center gap-3">
          <ListTodo className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Tâches</h1>
            <p className="text-sm text-gray-500">
              {filteredTasks.length} tâche{filteredTasks.length > 1 ? 's' : ''} en cours
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* User filter */}
          <div className="flex items-center gap-1.5 mr-1">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">Tout le monde</option>
              <option value="mine">Mes tâches</option>
              {membersList.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={refresh}
            disabled={isLoading}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            title="Actualiser"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </button>

          <button
            onClick={() => setShowArchives(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600
              bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <Archive className="w-4 h-4" />
            Archives
          </button>

          <button
            onClick={() => {
              setCreateDefaults({ important: false, urgent: false });
              setShowCreate(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white
              bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nouvelle tâche
          </button>
        </div>
      </div>

      {/* Matrix */}
      <div className="flex-1 p-4 min-h-0">
        {isLoading && filteredTasks.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : (
          <TaskMatrix
            tasks={filteredTasks}
            userId={userId}
            isOrgAdmin={isOrgAdmin}
            onCreateInQuadrant={handleCreateInQuadrant}
            onCardClick={setSelectedTask}
            onMarkDone={handleMarkDone}
            onArchive={handleArchive}
            onMoveQuadrant={handleMoveQuadrant}
          />
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <TaskCreateModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          members={membersList}
          defaultImportant={createDefaults.important}
          defaultUrgent={createDefaults.urgent}
        />
      )}

      {/* Detail modal */}
      {selectedTask && (
        <TaskModal
          task={selectedTask}
          userId={userId}
          isOrgAdmin={isOrgAdmin}
          members={membersList}
          onClose={() => setSelectedTask(null)}
          onUpdate={updateTask}
          onMarkDone={markAsDone}
          onArchive={archiveTask}
          onDelete={deleteTask}
        />
      )}

      {/* Archive drawer */}
      {showArchives && (
        <TaskArchiveDrawer
          tasks={archivedTasks}
          isLoading={archivesLoading}
          onClose={() => setShowArchives(false)}
        />
      )}
    </div>
  );
}
