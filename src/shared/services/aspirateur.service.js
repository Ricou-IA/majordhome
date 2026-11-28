/**
 * aspirateur.service.js — Aspirateur de sites fournisseurs (écran de la fiche fournisseur)
 * ============================================================================
 * Lecture : état de la recette du site (RPC aspiration_recette_etat, qui ne dit rien des autres entreprises), dernier
 * travail du fournisseur (vue majordhome_aspirations), propositions à valider (vue majordhome_catalogue_propositions,
 * lue en entier). Écriture : edge fournisseur-aspirer (lancer, confirmer, rejeter, appliquer), RPC
 * catalogue_propositions_decider (écarter), réglages de la fiche (connector_config.aspirateur, fusionnés).
 * Une erreur de l'edge est un CODE (src/lib/aspirateur/codes.js), traduit par messageAspirateur.
 * Spec docs/superpowers/specs/2026-11-28-aspirateur-sites-fournisseurs-recettes-communes-design.md.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { fetchAllPages } from '@/lib/postgrestUtils';
import { messageAspirateur } from '@/lib/aspirateur/codes';
import { configAvecAspirateur } from '@/lib/aspirateur/ecran';
import { normaliserDomaine } from '@/lib/aspirateur/domaine';
import { suppliersService } from '@services/suppliers.service';

/** Appel de l'edge ; une réponse { error: code } devient une erreur portant ce code et son message. */
async function appelEdge(action, corps) {
  const { data, error } = await supabase.functions.invoke('fournisseur-aspirer', { body: { action, ...corps } });
  if (error) throw new Error(messageAspirateur('service_indisponible'));
  if (data?.error) {
    const e = new Error(messageAspirateur(data.error));
    e.code = data.error;
    throw e;
  }
  return data?.data ?? null;
}

export const aspirateurService = {
  /** { connue, en_cours } pour le site de la fiche ; null si le site n'est pas une adresse https. */
  async getEtat(orgId, siteUrl) {
    return withErrorHandling(async () => {
      const domaine = normaliserDomaine(siteUrl);
      if (!orgId || !domaine) return null;
      const { data, error } = await supabase.rpc('aspiration_recette_etat', { p_org_id: orgId, p_domaine: domaine });
      if (error) throw error;
      return data;
    }, 'aspirateur.getEtat');
  },

  /** Dernier travail (apprentissage ou aspiration) de ce fournisseur, null s'il n'y en a pas. */
  async getDernierTravail(orgId, supplierId) {
    return withErrorHandling(async () => {
      if (!orgId || !supplierId) throw new Error('[aspirateurService] orgId et supplierId requis');
      const { data, error } = await supabase.from('majordhome_aspirations').select('*')
        .eq('org_id', orgId).eq('supplier_id', supplierId).order('lance_le', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    }, 'aspirateur.getDernierTravail');
  },

  /** Propositions à valider du fournisseur, lues en entier. */
  async getPropositions(orgId, supplierId) {
    return withErrorHandling(async () => {
      if (!orgId || !supplierId) throw new Error('[aspirateurService] orgId et supplierId requis');
      return fetchAllPages((from, to) => supabase.from('majordhome_catalogue_propositions').select('*')
        .eq('org_id', orgId).eq('supplier_id', supplierId).eq('statut', 'a_valider')
        .order('cree_le', { ascending: true }).order('id', { ascending: true }).range(from, to));
    }, 'aspirateur.getPropositions');
  },

  async lancer(orgId, supplierId, champs) {
    return withErrorHandling(() => appelEdge('lancer', { org_id: orgId, supplier_id: supplierId, champs }), 'aspirateur.lancer');
  },

  async confirmerRecette(orgId, aspirationId, champs) {
    return withErrorHandling(() => appelEdge('confirmer_recette', { org_id: orgId, aspiration_id: aspirationId, champs }), 'aspirateur.confirmerRecette');
  },

  async rejeterRecette(orgId, aspirationId) {
    return withErrorHandling(() => appelEdge('rejeter_recette', { org_id: orgId, aspiration_id: aspirationId }), 'aspirateur.rejeterRecette');
  },

  /** Applique des propositions (100 au plus par appel, l'écran découpe). */
  async appliquer(orgId, supplierId, ids) {
    return withErrorHandling(() => appelEdge('appliquer', { org_id: orgId, supplier_id: supplierId, ids }), 'aspirateur.appliquer');
  },

  async ecarter(orgId, ids) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('catalogue_propositions_decider', { p_org_id: orgId, p_ids: ids, p_statut: 'ecartee' });
      if (error) throw error;
      return data;
    }, 'aspirateur.ecarter');
  },

  /** Nature des prix et marques, fusionnées dans la configuration existante du fournisseur. */
  async enregistrerReglages(supplier, reglages) {
    return suppliersService.updateSupplier(supplier.id, { connectorConfig: configAvecAspirateur(supplier.connector_config, reglages) });
  },
};
