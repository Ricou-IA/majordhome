/**
 * mailCampaigns.service.js — CRUD sur majordhome.mail_campaigns
 * ============================================================================
 * Gestion des templates de mailing paramétrables (carte d'identité + contenu).
 * ============================================================================
 */

import supabase from '@lib/supabaseClient';

export const mailCampaignsService = {
  async list(orgId, { includeArchived = false } = {}) {
    let query = supabase
      .from('majordhome_mail_campaigns')
      .select('*')
      .eq('org_id', orgId)
      .order('key', { ascending: true });

    if (!includeArchived) query = query.eq('is_archived', false);

    const { data, error } = await query;
    return { data: data || [], error };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('majordhome_mail_campaigns')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return { data, error };
  },

  async getByKey(orgId, key) {
    const { data, error } = await supabase
      .from('majordhome_mail_campaigns')
      .select('*')
      .eq('org_id', orgId)
      .eq('key', key)
      .eq('is_archived', false)
      .maybeSingle();
    return { data, error };
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('majordhome_mail_campaigns')
      .insert(payload)
      .select()
      .single();
    return { data, error };
  },

  async update(id, patch) {
    const { data, error } = await supabase
      .from('majordhome_mail_campaigns')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    return { data, error };
  },

  async archive(id) {
    return this.update(id, { is_archived: true });
  },

  async unarchive(id) {
    return this.update(id, { is_archived: false });
  },

  async remove(id) {
    const { error } = await supabase
      .from('majordhome_mail_campaigns')
      .delete()
      .eq('id', id);
    return { error };
  },

  /**
   * « Envoyer un essai » d'un e-mail automatique : l'edge `email-essai` l'envoie à l'adresse de
   * réponse de l'entreprise, avec des valeurs d'exemple. `error.code` = code de `ESSAI_CODES`, `error.detail` =
   * précision du service d'envoi.
   * @returns {Promise<{ data: { envoye_a: string, source: 'entreprise'|'defaut' } | null, error: { code: string, detail: string|null } | null }>}
   */
  async envoyerEssai(orgId, cle) {
    const { data, error } = await supabase.functions.invoke('email-essai', { body: { org_id: orgId, cle } });
    if (error) return { data: null, error: { code: 'appel_echoue', detail: null } };
    if (data?.error) return { data: null, error: { code: data.error, detail: data.detail ?? null } };
    return { data: data?.data ?? null, error: null };
  },

  async duplicate(campaign, newKey) {
    const {
      id: _id,
      created_at: _ca,
      updated_at: _ua,
      created_by: _cb,
      ...rest
    } = campaign;
    return this.create({ ...rest, key: newKey, label: `${rest.label} (copie)` });
  },
};
