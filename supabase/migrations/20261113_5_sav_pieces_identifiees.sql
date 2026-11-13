-- 20261113_5_sav_pieces_identifiees.sql — pièces détachées identifiées et enregistrées sur une carte SAV (base)
-- Plan : « Mode atelier et pièces enregistrées sur la fiche SAV », tâche 1.
-- Une ligne = une pièce retenue pour un équipement d'une carte SAV (majordhome.interventions). Les colonnes de photo
-- (nom, repère, prix public) servent à l'AFFICHAGE et à la survie de la liste quand le relevé Invicta est ré-importé
-- (la nomenclature `equipment_model_parts` peut changer) : le prix du devis, lui, reste celui de l'article au catalogue.
-- equipment_model_id / part_line_id / supplier_product_id : volontairement sans FK (un ré-import ne doit ni bloquer ni
-- effacer la sélection). Écriture sous role_can(clients, edit), org = org CORE dérivée du projet de la carte.
-- Répétée sur scripts/migration-rehearsal/ (assert-sav-pieces-identifiees.sql).

CREATE TABLE IF NOT EXISTS majordhome.sav_part_selections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  intervention_id     uuid NOT NULL REFERENCES majordhome.interventions(id) ON DELETE CASCADE,
  equipment_id        uuid NOT NULL REFERENCES majordhome.equipments(id) ON DELETE CASCADE,
  equipment_model_id  uuid,
  part_line_id        uuid,
  piece_reference     text NOT NULL CHECK (btrim(piece_reference) <> ''),
  piece_name          text,
  repere              text NOT NULL DEFAULT '',
  supplier_product_id uuid,
  public_price_ht     numeric,
  quantity            numeric NOT NULL CHECK (quantity > 0),
  added_by            uuid NOT NULL DEFAULT auth.uid(),
  added_at            timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sav_part_selections_cle_unique UNIQUE (intervention_id, equipment_id, piece_reference, repere)
);

CREATE INDEX IF NOT EXISTS sav_part_selections_intervention_idx ON majordhome.sav_part_selections (intervention_id);

COMMENT ON TABLE majordhome.sav_part_selections IS 'Pièces détachées identifiées et enregistrées sur une carte SAV, par équipement. Le prix de vente d''une ligne de devis vient de l''article du catalogue, pas d''ici.';
COMMENT ON COLUMN majordhome.sav_part_selections.org_id IS 'Org CORE (majordhome.project_org_id du projet de la carte), pas l''org majordhome.';
COMMENT ON COLUMN majordhome.sav_part_selections.equipment_model_id IS 'Modèle fabricant au moment du choix. Sans FK : un ré-import du relevé ne doit pas toucher la sélection.';
COMMENT ON COLUMN majordhome.sav_part_selections.part_line_id IS 'Ligne de nomenclature d''origine. Sans FK : la nomenclature est remplacée à chaque relevé Invicta.';
COMMENT ON COLUMN majordhome.sav_part_selections.piece_name IS 'Photo du libellé au moment du choix : affichage et survie au ré-import du relevé, pas le prix du devis.';
COMMENT ON COLUMN majordhome.sav_part_selections.repere IS 'Photo du repère sur la vue éclatée (affichage) ; fait partie de la clé, '''' si la pièce n''a pas de repère.';
COMMENT ON COLUMN majordhome.sav_part_selections.supplier_product_id IS 'Ligne fournisseur (article) au moment du choix, NULL si la pièce n''a pas d''article. Sans FK.';
COMMENT ON COLUMN majordhome.sav_part_selections.public_price_ht IS 'Photo du prix public HT sur CET appareil, pour l''affichage : n''est pas le prix de vente du devis.';

DROP TRIGGER IF EXISTS trg_sav_part_selections_updated_at ON majordhome.sav_part_selections;
CREATE TRIGGER trg_sav_part_selections_updated_at BEFORE UPDATE ON majordhome.sav_part_selections
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE majordhome.sav_part_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sav_part_selections_select ON majordhome.sav_part_selections;
CREATE POLICY sav_part_selections_select ON majordhome.sav_part_selections FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

-- L'org écrite doit être celle de la carte : un org_id forgé ou une carte d'une autre org échoue (sous-requête NULL).
DROP POLICY IF EXISTS sav_part_selections_insert ON majordhome.sav_part_selections;
CREATE POLICY sav_part_selections_insert ON majordhome.sav_part_selections FOR INSERT
  WITH CHECK (
    majordhome.role_can(org_id, 'clients', 'edit')
    AND org_id = majordhome.project_org_id((SELECT i.project_id FROM majordhome.interventions i WHERE i.id = intervention_id))
  );

DROP POLICY IF EXISTS sav_part_selections_update ON majordhome.sav_part_selections;
CREATE POLICY sav_part_selections_update ON majordhome.sav_part_selections FOR UPDATE
  USING (
    majordhome.role_can(org_id, 'clients', 'edit')
    AND org_id = majordhome.project_org_id((SELECT i.project_id FROM majordhome.interventions i WHERE i.id = intervention_id))
  )
  WITH CHECK (
    majordhome.role_can(org_id, 'clients', 'edit')
    AND org_id = majordhome.project_org_id((SELECT i.project_id FROM majordhome.interventions i WHERE i.id = intervention_id))
  );

DROP POLICY IF EXISTS sav_part_selections_delete ON majordhome.sav_part_selections;
CREATE POLICY sav_part_selections_delete ON majordhome.sav_part_selections FOR DELETE
  USING (majordhome.role_can(org_id, 'clients', 'edit'));

-- ── Privilèges table ───────────────────────────────────────────────────────────────────────────────────────
-- Vue security_invoker : authenticated doit avoir les privilèges de table (RLS fait le tri). anon : rien.
REVOKE ALL ON majordhome.sav_part_selections FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.sav_part_selections TO authenticated;
GRANT SELECT ON majordhome.sav_part_selections TO service_role;

-- ── Vue publique (miroir simple, donc updatable) ───────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.majordhome_sav_part_selections WITH (security_invoker = true) AS
SELECT id, org_id, intervention_id, equipment_id, equipment_model_id, part_line_id, piece_reference, piece_name,
       repere, supplier_product_id, public_price_ht, quantity, added_by, added_at, updated_at
FROM majordhome.sav_part_selections;

REVOKE ALL ON public.majordhome_sav_part_selections FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_sav_part_selections TO authenticated;
GRANT SELECT ON public.majordhome_sav_part_selections TO service_role;

COMMENT ON VIEW public.majordhome_sav_part_selections IS 'Miroir simple (updatable) de majordhome.sav_part_selections. Ne JAMAIS y ajouter de jointure ou d''agrégat : la vue perdrait l''écriture.';
