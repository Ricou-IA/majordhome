// src/shared/services/fumisterie.service.js
// Données du module Fumisterie (vues majordhome_fum_*, security_invoker + filtre org explicite).
// Le moteur (src/lib/fumisterie) ne lit rien lui-même : ce service charge tout d'un coup.
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

const NOM_FOURNISSEUR = 'MODINOX / ALTEMA';

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
    const codes = [...new Set(composants.map((c) => c.composant_code))];
    // Le mapping est propre à UN fournisseur (motifs de références) : ne jamais mélanger ceux
    // d'un autre fournisseur de l'org. Fournisseur absent → aucun mapping (l'écran bloque déjà).
    const { data: supplier, error: eSup } = await supabase.from('majordhome_suppliers').select('id')
      .eq('org_id', orgId).eq('name', NOM_FOURNISSEUR).maybeSingle();
    if (eSup) throw eSup;
    const { data: mapping, error: e4 } = codes.length && supplier
      ? await supabase.from('majordhome_fum_composant_mapping').select('*').eq('org_id', orgId).eq('supplier_id', supplier.id).in('composant_code', codes)
      : { data: [], error: null };
    if (e4) throw e4;
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
      mapping: mapping || [],
      regles: regles || [],
    };
  }, 'fumisterie.getBundle'),

  getSupplier: (orgId) => withErrorHandling(async () => {
    const { data, error } = await supabase.from('majordhome_suppliers').select('id, name').eq('org_id', orgId).eq('name', NOM_FOURNISSEUR).maybeSingle();
    if (error) throw error;
    return data;
  }, 'fumisterie.getSupplier'),

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

  saveMetre: ({ orgId, quoteId = null, leadId = null, configurationId, gabaritCode, diametre, finition, releve, resultat, engineVersion, createdBy }) =>
    withErrorHandling(async () => {
      if (!orgId || !configurationId) throw new Error('[fumisterieService] orgId et configurationId requis');
      const { data, error } = await supabase.from('majordhome_fum_metres').insert({
        org_id: orgId, quote_id: quoteId, lead_id: leadId, configuration_id: configurationId, gabarit_code: gabaritCode,
        diametre, finition, releve, resultat, engine_version: engineVersion, created_by: createdBy || null,
      }).select().single();
      if (error) throw error;
      return data;
    }, 'fumisterie.saveMetre'),

  getMetreByQuote: (orgId, quoteId) => withErrorHandling(async () => {
    const { data, error } = await supabase.from('majordhome_fum_metres').select('*').eq('org_id', orgId).eq('quote_id', quoteId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  }, 'fumisterie.getMetreByQuote'),
};
