-- Devis natifs rattachés sans identifiant client Pennylane (useDevis ne le transmettait pas, depuis le 2026-10-25) :
-- le cron pennylane-sync-quote-status saute ces lignes, l'identité Pennylane n'atteignait donc jamais leurs leads
-- (vécu : lead REVEL resté sur une adresse e-mail erronée corrigée dans Pennylane).
-- Donnée seule, rejouable. Les triggers de la table ne portent pas sur cette colonne.
-- Effet attendu au passage suivant du cron : e-mail complété sur ROUFFIAC et BRUN, téléphone au format Pennylane.
UPDATE majordhome.lead_pennylane_quotes q
SET pennylane_customer_id = m.customer_id
FROM majordhome.pennylane_quotes m
WHERE m.pennylane_quote_id = q.pennylane_quote_id
  AND m.org_id = q.org_id
  AND m.customer_id IS NOT NULL
  AND q.pennylane_customer_id IS NULL
  AND q.ejected_at IS NULL;
