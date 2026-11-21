-- 20261121_2 — Sources de lead : une source peut appartenir à une organisation.
--
-- `majordhome.sources` était une liste unique pour toutes les organisations : une 2ᵉ entité voyait dans sa fiche lead
-- « Offre Bricafeu », « CBM », « Tesla », « Boutique en ligne »… propres à Mayer Énergie.
--
-- `org_id` NULL = source commune (Site Web, Bouche-à-oreille…), proposée à tous.
-- `org_id` renseigné = source propre à cette organisation, invisible des autres (RLS).
-- Mesuré le 2026-11-21 : aucun lead hors Mayer ne porte une des sources rattachées ici.
-- Les flux serveur (site vitrine, N8N) retrouvent une source par son nom dans des RPC SECURITY DEFINER : inchangés.
-- La vue `public.majordhome_sources` (security_invoker) n'expose pas `org_id` ; le filtre vient de la RLS.

ALTER TABLE majordhome.sources
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES core.organizations(id) ON DELETE CASCADE;

UPDATE majordhome.sources
   SET org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'  -- Mayer Énergie
 WHERE org_id IS NULL
   AND name IN ('Urgence SAV Site Web', 'Offre Combustible TotalEnergies', 'CBM', 'Offre Bricafeu', 'Bornes IRVE',
                'Web/PAC', 'Tesla', 'Conseil Solaire', 'Web/Clim', 'Boutique en ligne');

DROP POLICY IF EXISTS sources_select_authenticated ON majordhome.sources;
CREATE POLICY sources_select_authenticated ON majordhome.sources
  FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id = core.rls_get_user_org_id(auth.uid()));
