-- 20260807_1d_upsert_batch_never_shorten.sql
-- La normalisation des échéances n'ALLONGE jamais qu'elle ne RACCOURCIT.
--
-- Constat du premier balayage d'observation (2026-08-07, 250 devis) : 7 devis
-- portaient une échéance PLUS LONGUE que `émission + 3 mois`, tous en `pending`,
-- tous encore vivants, pour 57 000 € HT d'affaires en cours — dont un dossier à
-- 27 039 € qui aurait perdu 76 jours de validité.
--
-- Leurs dates (30/09, 31/08, 31/10 — des fins de mois rondes, sur les plus gros
-- dossiers) montrent une intention commerciale, pas une saisie au hasard :
-- quelqu'un a délibérément accordé une validité plus longue. Normaliser à la
-- baisse reprendrait une parole donnée au client.
--
-- Coût de la garde : 6 devis réels sur 250 expireront un peu plus tard que
-- 3 mois. Le bac « Expiré » reste lisible ; on ne reprend rien à personne.
--
-- Seule la clause finale change. Signature et corps INSERT identiques, donc
-- CREATE OR REPLACE suffit (ni DROP, ni droits à reposer).

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
    -- EXTENSION UNIQUEMENT : on ne repousse que vers l'avant. Une échéance
    -- déjà plus lointaine que la cible est un engagement délibéré, on n'y touche pas.
    AND (q.deadline IS NULL
         OR majordhome.pl_quote_target_deadline(q.quote_date) > q.deadline);
END;
$function$;
