-- 20260807_1c_fix_upsert_batch_ambiguous.sql
-- Fix 42702 : « column reference "pennylane_quote_id" is ambiguous »
--
-- CAUSE. `RETURNS TABLE (pennylane_quote_id bigint, ...)` déclare une variable
-- PL/pgSQL portant le nom d'une colonne de majordhome.pennylane_quotes. Dans
-- `ON CONFLICT (org_id, pennylane_quote_id)`, Postgres ne sait plus si le nom
-- désigne la colonne ou la variable, et refuse.
--
-- POURQUOI RENOMMER LA SORTIE. La clause ON CONFLICT est une *inférence
-- d'index* : elle n'accepte pas de qualification par table (`q.pennylane_quote_id`
-- y est une erreur de syntaxe). L'ambiguïté n'est donc pas levable au point de
-- référence — il faut supprimer la collision à la source. Le nom distinct
-- `quote_pl_id` se voit à la lecture.
--
-- ALTERNATIVE ÉCARTÉE : `#variable_conflict use_column`, pragma global qui
-- résoudrait AUSSI toutes les collisions futures en silence. La prochaine
-- colonne ajoutée avec un nom de variable homonyme passerait inaperçue.
--
-- `target_deadline` n'est pas renommé : aucune colonne ne porte ce nom.
--
-- POURQUOI UN DROP. `CREATE OR REPLACE FUNCTION` ne peut pas renommer une
-- colonne de `RETURNS TABLE` (« cannot change name of input parameter »).
-- Le DROP porte sur un objet créé le 2026-08-07 par ce même chantier, jamais
-- appelé en production (table jumelle à 0 ligne, balayage jamais exécuté).
-- ⚠️ Un DROP emporte les privilèges : les REVOKE/GRANT sont reposés plus bas.

DROP FUNCTION IF EXISTS public.pennylane_quotes_upsert_batch(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.pennylane_quotes_upsert_batch(
  p_org_id uuid,
  p_rows   jsonb
)
RETURNS TABLE (quote_pl_id bigint, target_deadline date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
BEGIN
  INSERT INTO majordhome.pennylane_quotes AS q (
    org_id, pennylane_quote_id, quote_number, label, status, quote_date, deadline,
    amount_ht, amount_ttc, pdf_url, customer_id, customer_name, pdf_invoice_subject,
    archived_at, pl_created_at, pl_updated_at, missing_since, synced_at
  )
  SELECT
    p_org_id,
    (r->>'id')::bigint,
    r->>'quote_number',
    r->>'label',
    r->>'status',
    NULLIF(r->>'date','')::date,
    NULLIF(r->>'deadline','')::date,
    NULLIF(r->>'amount_ht','')::numeric,
    NULLIF(r->>'amount_ttc','')::numeric,
    r->>'pdf_url',
    NULLIF(r->>'customer_id','')::bigint,
    r->>'customer_name',
    r->>'pdf_invoice_subject',
    NULLIF(r->>'archived_at','')::timestamptz,
    NULLIF(r->>'pl_created_at','')::timestamptz,
    NULLIF(r->>'pl_updated_at','')::timestamptz,
    NULL,          -- vu dans ce balayage => plus manquant
    now()
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (org_id, pennylane_quote_id) DO UPDATE SET
    quote_number = EXCLUDED.quote_number,
    label = EXCLUDED.label,
    status = EXCLUDED.status,
    quote_date = EXCLUDED.quote_date,
    deadline = EXCLUDED.deadline,
    amount_ht = EXCLUDED.amount_ht,
    amount_ttc = EXCLUDED.amount_ttc,
    pdf_url = COALESCE(EXCLUDED.pdf_url, q.pdf_url),
    customer_id = EXCLUDED.customer_id,
    customer_name = COALESCE(EXCLUDED.customer_name, q.customer_name),
    pdf_invoice_subject = EXCLUDED.pdf_invoice_subject,
    archived_at = EXCLUDED.archived_at,
    pl_created_at = EXCLUDED.pl_created_at,
    pl_updated_at = EXCLUDED.pl_updated_at,
    missing_since = NULL,
    synced_at = now();

  RETURN QUERY
  SELECT q.pennylane_quote_id AS quote_pl_id,
         majordhome.pl_quote_target_deadline(q.quote_date)
  FROM majordhome.pennylane_quotes q
  WHERE q.org_id = p_org_id
    AND q.pennylane_quote_id IN (
      SELECT (r->>'id')::bigint FROM jsonb_array_elements(p_rows) AS r
    )
    AND q.status IN ('pending','expired')
    AND q.quote_date IS NOT NULL
    AND q.deadline IS DISTINCT FROM majordhome.pl_quote_target_deadline(q.quote_date);
END;
$$;

-- Payload contient org_id sans le dériver d'auth.uid() => service_role UNIQUEMENT
-- (règle CLAUDE.md, cf. record_voice_memo_extraction). Reposés après le DROP.
REVOKE ALL ON FUNCTION public.pennylane_quotes_upsert_batch(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_quotes_upsert_batch(uuid, jsonb) TO service_role;
