/**
 * mailCampaigns.service.js — CRUD sur majordhome.mail_campaigns
 * ============================================================================
 * Gestion des templates de mailing paramétrables (carte d'identité + contenu).
 * ============================================================================
 */

import supabase from '@lib/supabaseClient';
import { champsDeCopie } from '@/lib/mailPage';

const sansOrganisation = () => ({ data: null, error: new Error('[mailCampaigns] orgId requis') });

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

  /** Toute écriture filtre aussi par organisation (défense en profondeur) : sans `orgId`, rien n'est écrit. */
  async update(id, patch, orgId) {
    if (!orgId) return sansOrganisation();
    const { data, error } = await supabase
      .from('majordhome_mail_campaigns')
      .update(patch)
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single();
    return { data, error };
  },

  async archive(id, orgId) {
    return this.update(id, { is_archived: true }, orgId);
  },

  async unarchive(id, orgId) {
    return this.update(id, { is_archived: false }, orgId);
  },

  async remove(id, orgId) {
    if (!orgId) return sansOrganisation();
    const { error } = await supabase
      .from('majordhome_mail_campaigns')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);
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

  /**
   * Rédaction assistée d'un e-mail (edge `mailing-rediger`). Rien n'est écrit : la page décide d'appliquer ou non
   * la proposition. Le nom, le site et les adresses de l'entreprise sont relus côté serveur, jamais envoyés d'ici.
   * @param {string} orgId
   * @param {{ consigne: string, intention?: string, objet?: string, corps?: string, nature?: string, variables?: string[] }} demande
   * @returns {Promise<{ data: { objet: string, objets: string[], corps: string } | null, error: { code: string } | null }>}
   */
  async rediger(orgId, demande) {
    try {
      const { data, error } = await supabase.functions.invoke('mailing-rediger', { body: { org_id: orgId, ...demande } });
      if (error) return { data: null, error: { code: 'service_indisponible' } };
      if (data?.error) return { data: null, error: { code: data.error } };
      return { data: data?.data ?? null, error: null };
    } catch {
      return { data: null, error: { code: 'service_indisponible' } };
    }
  },

  /**
   * Nombre d'envois au journal pour une campagne (même organisation, `campaign_name` = son nom) : tant qu'il est
   * nul, le nom du mail peut changer. `data` nul sur une erreur — l'appelant le lit comme « inconnu ».
   * @param {string} orgId
   * @param {string} libelle
   * @returns {Promise<{ data: number | null, error: any }>}
   */
  async compterEnvois(orgId, libelle) {
    const { count, error } = await supabase
      .from('majordhome_mailing_logs')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('campaign_name', libelle);
    if (error) return { data: null, error };
    return { data: typeof count === 'number' ? count : null, error: count === null ? new Error('compte_inconnu') : null };
  },

  /**
   * Copie d'une campagne : clé et nom fournis par l'appelant (`cleDeCopie`, `libelleDeCopie`), colonnes par
   * `champsDeCopie` — une copie naît campagne manuelle et n'envoie rien d'elle-même.
   */
  async duplicate(campaign, newKey, newLabel, orgId) {
    if (!orgId) return sansOrganisation();
    return this.create({ ...champsDeCopie(campaign, newKey, newLabel), org_id: orgId });
  },
};
