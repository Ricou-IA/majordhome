-- Helper one-shot pour backfiller campaign_id/adset_id/ad_id dans external_data
-- d'un lead meta_ads (clé = leads.external_id = id du lead Meta). Les colonnes
-- générées meta_campaign_id/meta_adset_id/meta_ad_id recomputent depuis
-- external_data. Appelé par le workflow N8N de backfill (re-fetch Meta par lead).
-- service_role only. Merge-only : ne vide jamais une clé existante ; une réponse
-- Meta sans champ campagne est un no-op (sert aussi de check du token ads_read).
CREATE OR REPLACE FUNCTION public.meta_ads_backfill_lead_attribution(
  p_external_id   text,
  p_campaign_id   text DEFAULT NULL,
  p_adset_id      text DEFAULT NULL,
  p_ad_id         text DEFAULT NULL,
  p_campaign_name text DEFAULT NULL,
  p_adset_name    text DEFAULT NULL,
  p_ad_name       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_patch jsonb;
  v_rows  int;
BEGIN
  v_patch := jsonb_strip_nulls(jsonb_build_object(
    'campaign_id',   NULLIF(p_campaign_id, ''),
    'adset_id',      NULLIF(p_adset_id, ''),
    'ad_id',         NULLIF(p_ad_id, ''),
    'campaign_name', NULLIF(p_campaign_name, ''),
    'adset_name',    NULLIF(p_adset_name, ''),
    'ad_name',       NULLIF(p_ad_name, '')
  ));

  IF v_patch = '{}'::jsonb THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'no_campaign_fields_returned', 'external_id', p_external_id);
  END IF;

  UPDATE majordhome.leads
     SET external_data = COALESCE(external_data, '{}'::jsonb) || v_patch
   WHERE external_id = p_external_id
     AND external_source = 'meta_ads';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_rows > 0, 'rows', v_rows, 'patch', v_patch, 'external_id', p_external_id);
END;
$$;

REVOKE ALL ON FUNCTION public.meta_ads_backfill_lead_attribution(text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meta_ads_backfill_lead_attribution(text,text,text,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.meta_ads_backfill_lead_attribution(text,text,text,text,text,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ads_backfill_lead_attribution(text,text,text,text,text,text,text) TO service_role;
