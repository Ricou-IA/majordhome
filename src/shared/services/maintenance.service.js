// src/shared/services/maintenance.service.js
// ============================================================================
// Module Maintenance — accès Supabase (spec 2026-09-25-module-maintenance-taches-recurrentes-design.md).
// Lectures/écritures de paramétrage via les vues publiques `majordhome_maint_*`
// (security_invoker, RLS org). Écritures sensibles par RPC uniquement :
//   - PIN d'un opérateur        → maint_set_operator_pin / maint_unlock_operator
//   - réalisation d'une tâche   → maint_record_completion (le journal n'a aucune policy d'écriture)
// Toujours `.eq('org_id', orgId)` explicite (défense en profondeur).
// ============================================================================
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

const UNIT_FIELDS = ['name', 'description', 'sort_order'];
const TASK_FIELDS = [
  'unit_id', 'label', 'instructions', 'frequency_kind', 'weekdays',
  'interval_unit', 'interval_count', 'start_date', 'sort_order',
];
const OPERATOR_FIELDS = ['first_name', 'active', 'sort_order'];

const pick = (obj, fields) => Object.fromEntries(fields.filter((f) => obj[f] !== undefined).map((f) => [f, obj[f]]));

/** Normalise la fréquence : les colonnes de l'autre famille sont remises à NULL (CHECK DB). */
function normaliserFrequence(task) {
  if (task.frequency_kind === 'weekdays') {
    return { ...task, interval_unit: null, interval_count: null };
  }
  return { ...task, weekdays: null };
}

async function upsert(view, orgId, id, payload) {
  if (id) {
    const { data, error } = await supabase.from(view).update(payload)
      .eq('id', id).eq('org_id', orgId).select().maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Enregistrement introuvable ou non autorisé');
    return data;
  }
  const { data, error } = await supabase.from(view).insert({ ...payload, org_id: orgId }).select().single();
  if (error) throw error;
  return data;
}

export const maintenanceService = {
  /** Unités, tâches et opérateurs de l'org (archivés compris : le journal peut les citer). */
  async getReferentiel(orgId) {
    return withErrorHandling(async () => {
      const [units, tasks, operators] = await Promise.all([
        supabase.from('majordhome_maint_units').select('*').eq('org_id', orgId).order('sort_order').order('name'),
        supabase.from('majordhome_maint_tasks').select('*').eq('org_id', orgId).order('sort_order').order('label'),
        supabase.from('majordhome_maint_operators').select('*').eq('org_id', orgId).order('sort_order').order('first_name'),
      ]);
      for (const r of [units, tasks, operators]) if (r.error) throw r.error;
      return { units: units.data || [], tasks: tasks.data || [], operators: operators.data || [] };
    }, 'maintenance.getReferentiel');
  },

  /**
   * Journal entre deux instants ISO (bornes incluses), plus récent d'abord.
   * @param {string} orgId
   * @param {{ depuis?: string, jusqua?: string, unitId?: string, taskId?: string, operatorId?: string, status?: string }} f
   */
  async getLogs(orgId, f = {}) {
    return withErrorHandling(async () => {
      let q = supabase.from('majordhome_maint_task_logs').select('*').eq('org_id', orgId)
        .order('done_at', { ascending: false }).limit(5000);
      if (f.depuis) q = q.gte('done_at', f.depuis);
      if (f.jusqua) q = q.lte('done_at', f.jusqua);
      if (f.unitId) q = q.eq('unit_id', f.unitId);
      if (f.taskId) q = q.eq('task_id', f.taskId);
      if (f.operatorId) q = q.eq('operator_id', f.operatorId);
      if (f.status) q = q.eq('status', f.status);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }, 'maintenance.getLogs');
  },

  /**
   * Dernière réalisation de chaque tâche, quelle que soit son ancienneté (vue DISTINCT ON) :
   * c'est elle qui fixe l'échéance (echeances.js).
   */
  async getDerniersLogs(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.from('majordhome_maint_last_logs').select('*').eq('org_id', orgId);
      if (error) throw error;
      return data || [];
    }, 'maintenance.getDerniersLogs');
  },

  async saveUnit(orgId, unit) {
    return withErrorHandling(() => upsert('majordhome_maint_units', orgId, unit.id, pick(unit, UNIT_FIELDS)), 'maintenance.saveUnit');
  },

  async setUnitArchived(orgId, unitId, archived) {
    return withErrorHandling(() => upsert('majordhome_maint_units', orgId, unitId,
      { archived_at: archived ? new Date().toISOString() : null }), 'maintenance.setUnitArchived');
  },

  async saveTask(orgId, task) {
    return withErrorHandling(() => upsert('majordhome_maint_tasks', orgId, task.id,
      pick(normaliserFrequence(task), TASK_FIELDS)), 'maintenance.saveTask');
  },

  async setTaskArchived(orgId, taskId, archived) {
    return withErrorHandling(() => upsert('majordhome_maint_tasks', orgId, taskId,
      { archived_at: archived ? new Date().toISOString() : null }), 'maintenance.setTaskArchived');
  },

  async saveOperator(orgId, operator) {
    return withErrorHandling(() => upsert('majordhome_maint_operators', orgId, operator.id,
      pick(operator, OPERATOR_FIELDS)), 'maintenance.saveOperator');
  },

  async setOperatorPin(operatorId, pin) {
    return withErrorHandling(async () => {
      const { error } = await supabase.rpc('maint_set_operator_pin', { p_operator_id: operatorId, p_pin: pin });
      if (error) throw error;
      return true;
    }, 'maintenance.setOperatorPin');
  },

  async unlockOperator(operatorId) {
    return withErrorHandling(async () => {
      const { error } = await supabase.rpc('maint_unlock_operator', { p_operator_id: operatorId });
      if (error) throw error;
      return true;
    }, 'maintenance.unlockOperator');
  },

  /**
   * Enregistre une réalisation signée. Résout avec la réponse métier de la RPC :
   * `{ ok: true, log_id, done_at }` ou `{ ok: false, error: 'pin_invalid'|'locked'|'no_pin', remaining?, locked_until? }`
   * (un PIN faux n'est pas une erreur technique : il doit rester lisible par la borne).
   */
  async recordCompletion({ taskId, operatorId, pin, status, comment, dueDate }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('maint_record_completion', {
        p_task_id: taskId,
        p_operator_id: operatorId,
        p_pin: pin,
        p_status: status,
        p_comment: comment || null,
        p_due_date: dueDate,
      });
      if (error) throw error;
      return data;
    }, 'maintenance.recordCompletion');
  },

  /** Nombre de clients de l'org — garde-fou de la création d'un compte borne (spec § 2). */
  async countClients(orgId) {
    return withErrorHandling(async () => {
      const { count, error } = await supabase.from('majordhome_clients')
        .select('id', { count: 'exact', head: true }).eq('org_id', orgId);
      if (error) throw error;
      return count || 0;
    }, 'maintenance.countClients');
  },
};
