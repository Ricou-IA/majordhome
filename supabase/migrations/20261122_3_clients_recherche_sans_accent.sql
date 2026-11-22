-- ============================================================================
-- 20261122_3 — Recherche de clients sans accent
-- ============================================================================
-- La recherche de clients (liste des clients, fenêtre de RDV, recherche globale) filtrait
-- `display_name` et `city` par `ilike` : « helene » ne trouvait pas « Hélène » (19 clients
-- trouvés sur 23 chez Mayer, 134 clients avec un accent dans leur nom, mesuré le 2026-11-22).
-- La recherche de leads, elle, passe déjà par `unaccent` (`lead_search`).
--
-- Même convention que `majordhome_pieces_catalogue.recherche` : une colonne `recherche` =
-- lower(unaccent(...)) dans la vue, que le service interroge avec un terme normalisé de la
-- même façon (`normaliser` de src/lib/catalogue/recherchePieces.js).
--
-- La vue est reprise telle qu'en production (20261121_13), `recherche` ajoutée EN FIN de
-- liste (CREATE OR REPLACE VIEW n'accepte un ajout qu'en fin). Elle reste un miroir
-- modifiable : une colonne calculée ne retire rien à l'écriture des autres. Rien d'autre ne
-- change : ni les droits (conservés par CREATE OR REPLACE), ni `majordhome_clients_all`.
--
-- Additive : l'ancien code du site continue de fonctionner après cette migration.
-- ============================================================================

CREATE OR REPLACE VIEW public.majordhome_clients WITH (security_invoker = true) AS
 SELECT id, project_id, org_id, first_name, last_name, display_name, company_name, email, phone, phone_secondary,
    address, address_complement, postal_code, city, country, housing_type, surface, floor_count, construction_year,
    dpe_number, dpe_rating, access_instructions, lead_source, tags, is_reliable, import_source, notes, internal_notes,
    created_by, created_at, updated_at, is_archived, archived_at, client_category, client_number, siren, latitude,
    longitude, geocoded_at, is_web_draft, owner_client_id, mail_optin, sms_optin, email_unsubscribed_at,
    email_unsubscribe_reason, auth_user_id, pennylane_account_number,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM majordhome.contracts ct
              WHERE ct.client_id = c.id AND ct.status = 'active'::majordhome.contract_status)) THEN true
            ELSE false
        END AS has_active_contract,
    external_ref,
    lower(public.unaccent(concat_ws(' ', display_name, city))) AS recherche
   FROM majordhome.clients c
  WHERE is_web_draft IS NOT TRUE;

-- Une vue de `public` reçoit l'ACL par défaut du schéma à sa création seulement ; rappel
-- sans effet ici, tenu par la charte (aucun droit pour anon sur une vue majordhome_*).
REVOKE ALL ON public.majordhome_clients FROM PUBLIC, anon;
