// src/shared/services/fumisterie.service.js
// Données du module Fumisterie (vues majordhome_fum_*, security_invoker + filtre org explicite).
// Le moteur (src/lib/fumisterie) ne lit rien lui-même : ce service charge tout d'un coup.
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { logger } from '@lib/logger';

// Fabricant historique, lu PAR SON NOM seulement quand la vue des fabricants n'existe pas encore (migration
// 20261128_1 pas encore appliquée) : partout ailleurs, est fabricant tout fournisseur qui a des attributs.
const NOM_FOURNISSEUR = 'MODINOX / ALTEMA';
/** Vue ou colonne absente de la base (migration pas encore appliquée), à distinguer de toute autre erreur. */
const objetAbsent = (error) => ['PGRST205', '42P01', 'PGRST204', '42703'].includes(error?.code);

export const fumisterieService = {
  getConfigurations: (orgId) => withErrorHandling(async () => {
    if (!orgId) throw new Error('[fumisterieService] orgId requis');
    const { data, error } = await supabase.from('majordhome_fum_configurations').select('*')
      .eq('org_id', orgId).eq('actif', true).order('code');
    if (error) throw error;
    return data || [];
  }, 'fumisterie.getConfigurations'),

  /** Tout ce que le moteur attend pour UNE configuration (hors articles). */
  getBundle: (orgId, configurationId) => withErrorHandling(async () => {
    if (!orgId || !configurationId) throw new Error('[fumisterieService] orgId et configurationId requis');
    const { data: configuration, error: e1 } = await supabase.from('majordhome_fum_configurations').select('*')
      .eq('org_id', orgId).eq('id', configurationId).single();
    if (e1) throw e1;
    const [gab, comps, regleLinks] = await Promise.all([
      configuration.gabarit_id
        ? supabase.from('majordhome_fum_gabarits').select('*').eq('org_id', orgId).eq('id', configuration.gabarit_id).single()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('majordhome_fum_config_composants').select('*').eq('org_id', orgId).eq('configuration_id', configurationId).order('ordre'),
      supabase.from('majordhome_fum_config_regles').select('regle_id').eq('org_id', orgId).eq('configuration_id', configurationId),
    ]);
    if (gab.error) throw gab.error;
    if (comps.error) throw comps.error;
    if (regleLinks.error) throw regleLinks.error;
    const composants = comps.data || [];
    // PostgREST ne peut pas détecter de FK entre deux VUES (majordhome_fum_config_regles →
    // majordhome_fum_regles) : embedded select impossible. Deux requêtes à la place.
    const regleIds = [...new Set((regleLinks.data || []).map((r) => r.regle_id).filter(Boolean))];
    const { data: regles, error: e5 } = regleIds.length
      ? await supabase.from('majordhome_fum_regles').select('*').eq('org_id', orgId).in('id', regleIds)
      : { data: [], error: null };
    if (e5) throw e5;
    return {
      configuration: { ...configuration, gabarit_code: gab.data?.code || null },
      gabarit: gab.data,
      composants,
      regles: regles || [],
    };
  }, 'fumisterie.getBundle'),

  /**
   * Fabricants de fumisterie de l'organisation (fournisseurs qui ont des articles avec attributs).
   * `avecVue: false` = base sans la migration 20261128_1 : seul le fabricant historique est connu, et le
   * fabricant retenu n'est pas enregistré sur le métré (colonne absente).
   */
  getFabricants: (orgId) => withErrorHandling(async () => {
    if (!orgId) throw new Error('[fumisterieService] orgId requis');
    const { data, error } = await supabase.from('majordhome_fum_fabricants').select('id, name').eq('org_id', orgId).order('name');
    if (!error) return { fabricants: data || [], avecVue: true };
    if (!objetAbsent(error)) throw error;
    logger.warn('[fumisterieService] vue des fabricants absente (migration 20261128_1 non appliquée) : fabricant historique seul');
    const { data: legacy, error: e2 } = await supabase.from('majordhome_suppliers').select('id, name').eq('org_id', orgId).eq('name', NOM_FOURNISSEUR).maybeSingle();
    if (e2) throw e2;
    return { fabricants: legacy ? [legacy] : [], avecVue: false };
  }, 'fumisterie.getFabricants'),

  /** Mapping des composants d'une configuration chez UN fabricant (jamais mélangé avec un autre). */
  getMapping: (orgId, supplierId, composantCodes) => withErrorHandling(async () => {
    if (!orgId || !supplierId || !composantCodes?.length) return [];
    const { data, error } = await supabase.from('majordhome_fum_composant_mapping').select('*').eq('org_id', orgId).eq('supplier_id', supplierId).in('composant_code', composantCodes);
    if (error) throw error;
    return data || [];
  }, 'fumisterie.getMapping'),

  /** Équivalences de gamme d'une configuration, tous fabricants. Table absente (migration non appliquée) ⇒ aucune. */
  getEquivalences: (orgId, configurationCode) => withErrorHandling(async () => {
    if (!orgId || !configurationCode) return [];
    const { data, error } = await supabase.from('majordhome_fum_gamme_equivalences').select('*').eq('org_id', orgId).eq('configuration_code', configurationCode);
    if (!error) return data || [];
    if (objetAbsent(error)) return [];
    throw error;
  }, 'fumisterie.getEquivalences'),

  /**
   * Articles candidats : toutes les gammes tarif du mapping, au diamètre du relevé — plus, entières,
   * les gammes dont le mapping ne dépend pas du Ø (`gammesSansDiametre`, ex. kit d'entrée d'air Ø100
   * posé sur un conduit Ø80). Deux requêtes plutôt qu'un `.or()` : les noms de gammes portent
   * parenthèses et virgules, qui casseraient la syntaxe PostgREST.
   */
  getArticles: (orgId, supplierId, { gammesTarif, diametre, gammesSansDiametre = [] }) => withErrorHandling(async () => {
    if (!orgId || !supplierId || !diametre || !gammesTarif?.length) return [];
    const base = () => supabase.from('majordhome_fum_articles').select('*').eq('org_id', orgId).eq('supplier_id', supplierId).eq('is_active', true);
    // Ø du relevé + articles sans Ø parsé (plaque de propreté MFI « MFI 130 » sans « D ») : le motif tranche.
    const { data, error } = await base().in('gamme_tarif', gammesTarif).or(`diametre_int.eq.${Number(diametre)},diametre_int.is.null`);
    if (error) throw error;
    if (!gammesSansDiametre.length) return data || [];
    const { data: sansD, error: e2 } = await base().in('gamme_tarif', gammesSansDiametre).not('diametre_int', 'is', null).neq('diametre_int', diametre);
    if (e2) throw e2;
    return [...(data || []), ...(sansD || [])];
  }, 'fumisterie.getArticles'),

  saveMetre: ({ orgId, quoteId = null, leadId = null, configurationId, gabaritCode, diametre, finition, releve, resultat, engineVersion, createdBy, supplierId = null }) =>
    withErrorHandling(async () => {
      if (!orgId || !configurationId) throw new Error('[fumisterieService] orgId et configurationId requis');
      const champs = {
        lead_id: leadId, configuration_id: configurationId, gabarit_code: gabaritCode,
        diametre, finition, releve, resultat, engine_version: engineVersion, supplier_id: supplierId || null,
      };
      // Un devis = un métré : refaire le métré d'un devis REMPLACE celui qui est enregistré (même ligne, celle que
      // lit getMetreByQuote). Avant, chaque enregistrement en ajoutait un (un devis en portait deux en prod).
      if (quoteId) {
        const { data: existant, error: eLecture } = await supabase.from('majordhome_fum_metres').select('id')
          .eq('org_id', orgId).eq('quote_id', quoteId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (eLecture) throw eLecture;
        if (existant) {
          const { data, error } = await supabase.from('majordhome_fum_metres').update({ ...champs, updated_at: new Date().toISOString() })
            .eq('id', existant.id).eq('org_id', orgId).select().single();
          if (error) throw error;
          return data;
        }
      }
      const { data, error } = await supabase.from('majordhome_fum_metres').insert({
        ...champs, org_id: orgId, quote_id: quoteId, created_by: createdBy || null,
      }).select().single();
      if (error) throw error;
      return data;
    }, 'fumisterie.saveMetre'),

  /** Retire le métré d'un devis (« Retirer le métré » puis enregistrement du devis). Rend le nombre de lignes supprimées. */
  deleteMetre: (orgId, quoteId) => withErrorHandling(async () => {
    if (!orgId || !quoteId) throw new Error('[fumisterieService] orgId et quoteId requis');
    const { data, error } = await supabase.from('majordhome_fum_metres').delete().eq('org_id', orgId).eq('quote_id', quoteId).select('id');
    if (error) throw error;
    return (data || []).length;
  }, 'fumisterie.deleteMetre'),

  getMetreByQuote: (orgId, quoteId) => withErrorHandling(async () => {
    const { data, error } = await supabase.from('majordhome_fum_metres').select('*').eq('org_id', orgId).eq('quote_id', quoteId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  }, 'fumisterie.getMetreByQuote'),

  /**
   * Ce que le plan du conduit lit en plus du métré : configuration et gabarit (relevé saisi), nom du
   * fabricant et de l'auteur du relevé. Fabricant = celui du métré s'il est enregistré, sinon le
   * fournisseur de fumisterie de l'org (métrés antérieurs au choix du fabricant). Un nom d'auteur
   * illisible n'empêche pas le plan : « — » dans le cartouche.
   */
  getPlanContexte: (orgId, metre) => withErrorHandling(async () => {
    if (!orgId || !metre?.configuration_id) throw new Error('[fumisterieService] orgId et métré requis');
    const { data: configuration, error: e1 } = await supabase.from('majordhome_fum_configurations').select('*')
      .eq('org_id', orgId).eq('id', metre.configuration_id).single();
    if (e1) throw e1;
    const { data: gabarit, error: e2 } = configuration.gabarit_id
      ? await supabase.from('majordhome_fum_gabarits').select('*').eq('org_id', orgId).eq('id', configuration.gabarit_id).maybeSingle()
      : { data: null, error: null };
    if (e2) throw e2;
    const fournisseur = metre.supplier_id
      ? await supabase.from('majordhome_suppliers').select('id, name').eq('org_id', orgId).eq('id', metre.supplier_id).maybeSingle()
      : await supabase.from('majordhome_suppliers').select('id, name').eq('org_id', orgId).eq('name', NOM_FOURNISSEUR).maybeSingle();
    if (fournisseur.error) throw fournisseur.error;
    let auteurNom = null;
    if (metre.created_by) {
      const { data: profil, error: e3 } = await supabase.from('profiles').select('full_name').eq('id', metre.created_by).maybeSingle();
      if (e3) logger.warn('[fumisterieService] auteur du métré illisible', e3);
      auteurNom = profil?.full_name || null;
    }
    return { configuration, gabarit: gabarit || null, fournisseurNom: fournisseur.data?.name || null, auteurNom };
  }, 'fumisterie.getPlanContexte'),
};
