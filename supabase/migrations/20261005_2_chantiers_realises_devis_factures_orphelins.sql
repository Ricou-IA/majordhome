-- Reprise : 6 devis déjà facturés, rattachés en août 2026 (avant le trigger
-- chantier_ensure_for_quote du 2026-10-01), restaient sans carte chantier.
-- Décision Eric 2026-10-05 : ce sont des chantiers réalisés → une carte
-- « Réalisé » par devis (même règle que le trigger : 1 devis validé = 1 carte).
-- Périmètre figé par numéro de devis ; idempotent (chantier_id IS NULL).
DO $$
DECLARE
  r     record;
  v_id  uuid;
  n     int := 0;
BEGIN
  FOR r IN
    SELECT q.id, q.org_id, q.lead_id, q.quote_label, q.quote_date, q.pennylane_quote_id,
           l.client_id, l.equipment_type_id,
           (SELECT NULLIF(trim(pq.pdf_invoice_subject), '')
              FROM majordhome.pennylane_quotes pq
             WHERE pq.org_id = q.org_id AND pq.pennylane_quote_id = q.pennylane_quote_id) AS label
      FROM majordhome.lead_pennylane_quotes q
      JOIN majordhome.leads l ON l.id = q.lead_id AND COALESCE(l.is_deleted, false) = false
     WHERE q.org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
       AND q.quote_label IN ('D-2026-06259', 'D-2026-07336', 'D-2026-06244',
                             'D-2026-06243', 'D-2026-0320', 'D-2026-06109')
       AND q.ejected_at IS NULL
       AND q.chantier_id IS NULL
       AND q.quote_status = 'invoiced'
  LOOP
    INSERT INTO majordhome.chantiers (org_id, lead_id, client_id, label, chantier_status, won_date, equipment_type_id)
    VALUES (r.org_id, r.lead_id, r.client_id, r.label, 'realise',
            COALESCE(r.quote_date, current_date), r.equipment_type_id)
    RETURNING id INTO v_id;

    UPDATE majordhome.lead_pennylane_quotes SET chantier_id = v_id WHERE id = r.id;

    INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
    VALUES (r.lead_id, NULL, 'chantier_created',
            'Chantier réalisé créé pour le devis ' || r.quote_label || ' (reprise des devis facturés sans carte)',
            jsonb_build_object('chantier_id', v_id, 'lead_quote_id', r.id,
                               'pennylane_quote_id', r.pennylane_quote_id, 'backfill', '20261005_2'),
            r.org_id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'chantiers réalisés créés : %', n;
END $$;
