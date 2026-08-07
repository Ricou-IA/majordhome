-- 20260807_4_upsert_batch_resolve_customer_name.sql
-- Le nom du client vient du cache `pennylane_customer_lookup` quand la LISTE
-- /quotes ne le fournit pas — ce qui est TOUJOURS le cas.
--
-- Gotcha déjà documenté dans CLAUDE.md et oublié en écrivant le balayage :
-- l'endpoint LISTE `/quotes` de Pennylane V2 n'embarque que `customer.id`,
-- jamais le nom (seul le GET unitaire `/quotes/{id}` le porte). Résultat après
-- la bascule de l'explorateur sur la table jumelle : les 250 cartes affichaient
-- « Client inconnu » et la recherche par nom ne matchait plus rien.
--
-- Ce COALESCE récupère 203 des 250 noms sans un seul appel API. Les 47 restants
-- correspondent à 44 clients jamais fetchés, donc absents du cache : leur
-- résolution demande un appel `/customers/{id}` et vit côté balayage.
--
-- Seule la colonne `customer_name` de l'INSERT change. Signature identique,
-- CREATE OR REPLACE suffit.

CREATE OR REPLACE FUNCTION public.pennylane_quotes_upsert_batch(p_org_id uuid, p_rows jsonb)
 RETURNS TABLE(quote_pl_id bigint, target_deadline date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public'
AS $function$
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
    COALESCE(
      NULLIF(r->>'customer_name',''),
      (SELECT COALESCE(
                NULLIF(l.name,''),
                NULLIF(trim(concat_ws(' ', l.first_name, l.last_name)),'')
              )
         FROM majordhome.pennylane_customer_lookup l
        WHERE l.org_id = p_org_id
          AND l.pennylane_id = NULLIF(r->>'customer_id','')::bigint)
    ),
    r->>'pdf_invoice_subject',
    NULLIF(r->>'archived_at','')::timestamptz,
    NULLIF(r->>'pl_created_at','')::timestamptz,
    NULLIF(r->>'pl_updated_at','')::timestamptz,
    NULL,
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
    -- EXTENSION UNIQUEMENT (garde posée en 20260807_1d)
    AND (q.deadline IS NULL
         OR majordhome.pl_quote_target_deadline(q.quote_date) > q.deadline);
END;
$function$;
