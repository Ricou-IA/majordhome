-- MAURIES Ginette (Montfa) : lien pennylane_sync vers le client PL 244601548, qui n'existe plus
-- (404 « Couldn't find customer » au clic « Facturer », vérifié par GET le 2026-09-28).
-- Eric (2026-09-30) : Ginette n'est PAS Robert MAURIES (244601547) → pas de re-rattachement.
-- On retire le lien mort et le 411 associé ; le prochain « Facturer » crée sa fiche PL
-- (getOrCreateCustomer → POST /customers) et repose le mapping + le nouveau 411.
DELETE FROM majordhome.pennylane_sync
WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
  AND entity_type = 'client'
  AND local_id = 'a8c39061-cb78-4e27-a2aa-7ae5d0e446a1'
  AND pennylane_id = 244601548;

UPDATE majordhome.clients
SET pennylane_account_number = NULL
WHERE id = 'a8c39061-cb78-4e27-a2aa-7ae5d0e446a1'
  AND org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
  AND pennylane_account_number = '411000509';
