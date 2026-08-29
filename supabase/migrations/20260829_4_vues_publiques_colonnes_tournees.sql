-- 20260829_4_vues_publiques_colonnes_tournees.sql
-- Expose les 5 colonnes ajoutées par 20260829_1 dans les deux vues publiques.
--
-- POURQUOI CETTE MIGRATION EXISTE : PostgreSQL fige la liste de colonnes d'une vue
-- à sa création — un `SELECT *` est expansé au CREATE. Ajouter une colonne à la
-- table ne l'expose donc PAS via la vue, et tout le module lit par PostgREST,
-- c'est-à-dire par les vues. Sans ce correctif :
--   - l'onglet Tournées ne charge jamais (42703 sur daily_work_minutes /
--     include_in_routing / duration_base_minutes / unfavorable_months) ;
--   - RÉGRESSION sur l'existant : /settings/pricing refuse toute création ou
--     modification de type d'équipement, puisque pricing.service.js envoie
--     désormais les 3 colonnes de durée à chaque écriture.
-- Le gotcha est documenté dans CLAUDE.md (précédent : appointments.grand_secteur,
-- migration 20260617_4).
--
-- Les colonnes sont ajoutées EN FIN DE LISTE : `CREATE OR REPLACE VIEW` n'autorise
-- que cela, sinon « cannot change name of view column ».
-- Les deux vues restent des miroirs simples (donc auto-updatables : pricing.service.js
-- écrit à travers celle des types) et conservent security_invoker=true.
-- CREATE OR REPLACE préserve les GRANT existants.

CREATE OR REPLACE VIEW public.majordhome_pricing_equipment_types
  WITH (security_invoker = true) AS
  SELECT id,
    org_id,
    code,
    label,
    category,
    equipment_category,
    has_unit_pricing,
    unit_label,
    included_units,
    sort_order,
    is_active,
    created_at,
    updated_at,
    -- Ajouts 20260829_1 (optimisation des tournées)
    duration_base_minutes,
    duration_per_extra_unit_minutes,
    unfavorable_months
  FROM majordhome.pricing_equipment_types;

CREATE OR REPLACE VIEW public.majordhome_team_members
  WITH (security_invoker = true) AS
  SELECT id,
    org_id,
    first_name,
    last_name,
    display_name,
    email,
    phone,
    role,
    specialties,
    calendar_color,
    google_calendar_id,
    google_calendar_email,
    default_availability,
    default_zone,
    slack_user_id,
    is_active,
    created_at,
    updated_at,
    user_id,
    -- Ajouts 20260829_1 (optimisation des tournées)
    daily_work_minutes,
    include_in_routing
  FROM majordhome.team_members;

-- Le cache de trajets est lu ET écrit par le frontend authentifié à travers sa vue
-- security_invoker : les privilèges vérifiés sont ceux de l'appelant sur la TABLE
-- de base, pas sur la vue. Sans ce GRANT, l'écriture du cache échoue — et comme
-- l'échec est volontairement absorbé (le calcul continue), le cache ne se
-- remplirait jamais, en silence, alors qu'il conditionne le respect du quota Mapbox.
GRANT SELECT, INSERT, UPDATE ON majordhome.travel_cache TO authenticated;
