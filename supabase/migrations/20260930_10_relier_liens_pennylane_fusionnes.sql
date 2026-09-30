-- 4 liens client Majord'home → Pennylane pointaient vers des fiches PL supprimées (fusionnées
-- dans PL avec celle du conjoint / du foyer) : 404 « Couldn't find customer » au clic « Facturer ».
-- Audit du 2026-09-28 (943 clients PL comparés aux 959 liens) ; Eric (2026-09-30) confirme que ce
-- sont les mêmes personnes → on relie chaque client à la fiche PL survivante et à son 411.
--   Patrick BRUN            244601197 (mort) → 244601196 NICOLE ET PATRICK BRUN   411000118
--   Lucile CREPEL-REMINARD  244601642 (mort) → 244601262 STEPHANE CREPEL/REMINARD 411000192
--   LILING LEGER            244601493 (mort) → 244601484 NICOLAS LEGER            411000438
--   Maryse VIGUIER          244601751 (mort) → 244601236 ROBERT CHERON            411000163
-- Chaque UPDATE est gardé par l'ancien id : rejouer la migration ne fait rien.
WITH relink(local_id, old_pl, new_pl, new_411) AS (
  VALUES
    ('63f7d9dc-edea-44be-a74e-3bbf5bbcc34d'::uuid, 244601197::bigint, 244601196::bigint, '411000118'),
    ('68e79a08-cb89-4fe5-b4e6-522e25e8f4d3'::uuid, 244601642, 244601262, '411000192'),
    ('c25d225b-def0-4b37-8429-3f4d5cce4e0e'::uuid, 244601493, 244601484, '411000438'),
    ('b8d7a50a-ba13-4ad4-8908-8e482aae8f74'::uuid, 244601751, 244601236, '411000163')
),
upd_sync AS (
  UPDATE majordhome.pennylane_sync s
  SET pennylane_id = r.new_pl,
      pennylane_number = r.new_411,
      last_synced_at = now(),
      metadata = coalesce(s.metadata, '{}'::jsonb)
                 || jsonb_build_object('relinked_from', r.old_pl, 'relinked_at', '2026-09-30', 'relinked_reason', 'fiche PL fusionnée')
  FROM relink r
  WHERE s.org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
    AND s.entity_type = 'client'
    AND s.local_id = r.local_id
    AND s.pennylane_id = r.old_pl
  RETURNING s.local_id
)
UPDATE majordhome.clients c
SET pennylane_account_number = r.new_411
FROM relink r
WHERE c.id = r.local_id
  AND c.org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
  AND c.id IN (SELECT local_id FROM upd_sync);
