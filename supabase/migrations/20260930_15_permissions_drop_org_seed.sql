-- 20260930_15_permissions_drop_org_seed.sql
-- Droits app-level, phase 6 (étape 5) : fin du gabarit Mayer.
-- public.org_seed_permissions(p_org_id) copiait les 138 surcharges de Mayer sur une nouvelle
-- org (c'est ainsi que Cimaj a hérité des choix de Mayer). Depuis 20260930_12/14, une org
-- sans surcharge tombe sur les défauts app (majordhome.app_role_permissions) : le seed n'a
-- plus de raison d'être. Aucun appelant : ni fonction DB, ni cron, ni code (Majord'home,
-- Baikal, site vitrine) — vérifié le 2026-09-30.
DROP FUNCTION IF EXISTS public.org_seed_permissions(uuid);
