-- Rattrapage ponctuel (2026-10-04) : RDV d'entretien à venir posés « en bloc »
-- avant la règle « bloc contrat » (R5) — le bloc dessiné ne reflète pas le
-- barème que voit le moteur, et un humain lisant le planning est induit en
-- erreur (vécu : SWIATEK 12/10, bloc 3 h 30 pour un barème de 2 h 42, d'où une
-- proposition auto-RDV jugée « impossible » à l'œil).
--
-- Périmètre : uniquement les RÉDUCTIONS, calculées au barème × gain multi-
-- équipements (10 %) par `dureeContrat` (src/lib/tournee/duree.js). L'heure de
-- début ne bouge pas (pas de reset de client_notified_at). Non traités ici,
-- volontairement : les 2 agrandissements qui chevaucheraient un autre RDV
-- (THUILAND 26/10, BONNIN 02/11) et les 2 contrats à équipement sans durée de
-- type (GOUZOU 07/10, MENAL 12/11) — à arbitrer à la main.
-- Garde : on n'écrit que si le bloc n'a pas bougé depuis le calcul.

UPDATE majordhome.appointments a
SET duration_minutes = v.bareme,
    scheduled_end = (a.scheduled_start + make_interval(mins => v.bareme))::time,
    updated_at = now()
FROM (VALUES
  ('11bcd743-d12f-401c-8755-fd99b5d6c93d'::uuid, 210, 90),   -- HINSCHBERGER 05/10
  ('aa6b9887-4e9b-401c-b559-8813d7c5656b'::uuid, 120, 90),   -- SONTAG 08/10
  ('3535c8cd-57ac-41ba-9220-e847b5bff592'::uuid, 120, 90),   -- GRAHOVAC 08/10
  ('535c7957-f650-4b1a-aa48-14c0069526e5'::uuid, 210, 162),  -- SWIATEK 12/10
  ('ca99f30f-bec3-4f07-a99e-243f25db3884'::uuid, 225, 135),  -- SANTINON 16/10 (figé : début inchangé)
  ('5b78d2aa-72a1-4237-b89c-16b1847844a8'::uuid, 90, 60),    -- GONTIER 19/10
  ('afb83591-a33e-411d-88e8-03dc8522ec0e'::uuid, 195, 135),  -- WAGNER 19/10
  ('9629a8f0-238e-45e5-9bb7-3ca5763df95c'::uuid, 180, 150)   -- AUGISTROU 28/10
) AS v(id, ancien, bareme)
WHERE a.id = v.id
  AND a.duration_minutes = v.ancien
  AND a.status NOT IN ('cancelled', 'no_show', 'completed');
