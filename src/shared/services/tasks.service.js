import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

export const tasksService = {
  async getTasks({ orgId }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_tasks')
        .select('*')
        .eq('org_id', orgId)
        .in('status', ['active', 'done'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }, 'tasks.getTasks');
  },

  async getArchivedTasks({ orgId, limit = 100 }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_tasks')
        .select('*')
        .eq('org_id', orgId)
        .eq('status', 'archived')
        .order('archived_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    }, 'tasks.getArchivedTasks');
  },

  async createTask({ orgId, title, description, isImportant, isUrgent, color, assignedTo }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('create_majordhome_task', {
        p_data: {
          org_id: orgId,
          title,
          description: description || null,
          is_important: isImportant,
          is_urgent: isUrgent,
          color: color || 'yellow',
          assigned_to: assignedTo || null,
        },
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    }, 'tasks.createTask');
  },

  async updateTask(taskId, updates) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('update_majordhome_task', {
        p_task_id: taskId,
        p_updates: { ...updates, updated_at: new Date().toISOString() },
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    }, 'tasks.updateTask');
  },

  async markAsDone(taskId) {
    return this.updateTask(taskId, { status: 'done' });
  },

  async archiveTask(taskId) {
    return this.updateTask(taskId, { status: 'archived' });
  },

  async deleteTask(taskId) {
    return withErrorHandling(async () => {
      const { error } = await supabase.rpc('delete_majordhome_task', {
        p_task_id: taskId,
      });
      if (error) throw error;
      return true;
    }, 'tasks.deleteTask');
  },

  // --- Notes ---

  async getNotes(taskId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_task_notes')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    }, 'tasks.getNotes');
  },

  async addNote(taskId, content) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('create_majordhome_task_note', {
        p_task_id: taskId,
        p_content: content,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    }, 'tasks.addNote');
  },

  async deleteNote(noteId) {
    return withErrorHandling(async () => {
      const { error } = await supabase.rpc('delete_majordhome_task_note', {
        p_note_id: noteId,
      });
      if (error) throw error;
      return true;
    }, 'tasks.deleteNote');
  },
};
