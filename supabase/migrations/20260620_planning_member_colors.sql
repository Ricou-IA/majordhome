-- 20260620_planning_member_colors.sql
-- Seed one-time des couleurs planning par personne (Mayer). Source unique =
-- majordhome.team_members.calendar_color (résolu via profile_key pour les humains
-- présents aussi comme commerciaux : Philippe, Michel). Violet #6D28D9 RÉSERVÉ au
-- "facturé" → aucune personne ne doit l'avoir. Couleurs ensuite éditables via
-- Settings → Équipe (Phase 2). Idempotent (UPDATE par id).
UPDATE majordhome.team_members SET calendar_color = '#EF4444' WHERE id = '87ba1ecb-0913-4cc0-8755-62c43c153693'; -- Ludovic Robert  (rouge)
UPDATE majordhome.team_members SET calendar_color = '#F97316' WHERE id = '15a68690-1ac5-409e-8c00-c7ba19b40ff3'; -- Antoine Verloo  (orange)
UPDATE majordhome.team_members SET calendar_color = '#3B82F6' WHERE id = 'e375271d-e126-466d-93ca-e5c92d041d27'; -- Philippe Mazel  (bleu)
UPDATE majordhome.team_members SET calendar_color = '#0D9488' WHERE id = '06dc4781-7b60-4bc0-a668-a9755db75099'; -- Michel Rieutord (teal)
UPDATE majordhome.team_members SET calendar_color = '#10B981' WHERE id = '2db6765f-99ce-48e8-b797-25660d3b8685'; -- Eric Pudebat    (vert)
