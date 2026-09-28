-- Retrait du réglage « Journal des factures Majordhome » (settings.pennylane.invoice.journal_id / journal_code).
-- Pennylane refuse (422) de déplacer l'écriture d'une facture vers un autre journal par l'API :
-- décision Eric 2026-09-22 = journal de ventes par défaut (VT). Le réglage (VA, posé pour les tests)
-- déclenchait encore une tentative et un avertissement à chaque « Facturer » ; le code est retiré.
UPDATE core.organizations
SET settings = jsonb_set(
  settings,
  '{pennylane,invoice}',
  (settings->'pennylane'->'invoice') - 'journal_id' - 'journal_code'
)
WHERE settings->'pennylane'->'invoice' ?| ARRAY['journal_id', 'journal_code'];
