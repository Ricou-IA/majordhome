-- ═══════════════════════════════════════════════════════════════════════════
-- Migration : majordhome.certificats
-- Module Certificat d'Entretien & Ramonage
-- À exécuter dans la console Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1. Séquence auto-incrémentale pour la référence
-- ─────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS majordhome.certificat_number_seq START 1;

-- ─────────────────────────────────────────────────────────────────
-- 2. Table principale
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE majordhome.certificats (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Liaisons
  intervention_id       UUID NOT NULL REFERENCES majordhome.interventions(id) ON DELETE CASCADE,
  client_id             UUID NOT NULL REFERENCES majordhome.clients(id),
  equipment_id          UUID REFERENCES majordhome.equipments(id),
  contract_id           UUID REFERENCES majordhome.contracts(id),
  org_id                UUID NOT NULL,

  -- Méta
  reference             TEXT UNIQUE NOT NULL
    DEFAULT ('CERT-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('majordhome.certificat_number_seq')::TEXT, 5, '0')),
  type_document         TEXT NOT NULL DEFAULT 'entretien'
    CHECK (type_document IN ('entretien', 'ramonage', 'entretien_ramonage')),

  -- Snapshot équipement (au moment de l'intervention)
  equipement_type       TEXT NOT NULL,
  equipement_marque     TEXT,
  equipement_modele     TEXT,
  equipement_numero_serie TEXT,
  equipement_annee      INTEGER,
  equipement_puissance_kw NUMERIC(6,2),
  equipement_fluide     TEXT,
  equipement_charge_kg  NUMERIC(6,3),
  combustible           TEXT,

  -- Données formulaire structurées
  donnees_entretien     JSONB NOT NULL DEFAULT '{}',
  donnees_ramonage      JSONB DEFAULT NULL,
  mesures               JSONB NOT NULL DEFAULT '{}',
  pieces_remplacees     JSONB NOT NULL DEFAULT '[]',

  -- Bilan réglementaire
  bilan_conformite      TEXT NOT NULL DEFAULT 'conforme'
    CHECK (bilan_conformite IN ('conforme', 'anomalie', 'arret_urgence')),
  anomalies_detail      TEXT,
  action_corrective     TEXT,
  recommandations       TEXT,
  prochaine_intervention DATE,

  -- TVA applicable
  tva_taux              NUMERIC(4,2) NOT NULL DEFAULT 5.50,

  -- Technicien (snapshot)
  technicien_id         UUID REFERENCES majordhome.team_members(id),
  technicien_nom        TEXT NOT NULL,
  technicien_certifications TEXT[],
  technicien_num_fgaz   TEXT,

  -- Signature
  signature_client_base64 TEXT,
  signature_client_nom    TEXT,
  signed_at               TIMESTAMPTZ,

  -- PDF généré
  pdf_storage_path      TEXT,
  pdf_generated_at      TIMESTAMPTZ,
  pdf_url               TEXT,

  -- Statut du document
  statut                TEXT NOT NULL DEFAULT 'brouillon'
    CHECK (statut IN ('brouillon', 'signe', 'envoye')),

  -- Dates
  date_intervention     DATE NOT NULL,
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────
-- 3. Index
-- ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_certificats_client_id ON majordhome.certificats(client_id);
CREATE INDEX idx_certificats_intervention_id ON majordhome.certificats(intervention_id);
CREATE INDEX idx_certificats_statut ON majordhome.certificats(statut);
CREATE INDEX idx_certificats_date ON majordhome.certificats(date_intervention DESC);
CREATE INDEX idx_certificats_org_id ON majordhome.certificats(org_id);

-- Unicité : un seul certificat par intervention
CREATE UNIQUE INDEX idx_certificats_intervention_unique ON majordhome.certificats(intervention_id);

-- ─────────────────────────────────────────────────────────────────
-- 4. Trigger updated_at
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION majordhome.update_certificats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER certificats_updated_at
  BEFORE UPDATE ON majordhome.certificats
  FOR EACH ROW EXECUTE FUNCTION majordhome.update_certificats_updated_at();

-- ─────────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE majordhome.certificats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage certificats"
  ON majordhome.certificats
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────
-- 6. Trigger activité client
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION majordhome.log_certificat_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.statut <> NEW.statut AND NEW.statut = 'signe') THEN
    INSERT INTO majordhome.client_activities (
      client_id, org_id, activity_type, title, description,
      reference_type, reference_id, is_system
    )
    VALUES (
      NEW.client_id,
      NEW.org_id,
      'document_added',
      'Certificat d''entretien généré — ' || NEW.reference,
      'Type : ' || NEW.type_document || ' | Équipement : ' || COALESCE(NEW.equipement_marque, '') || ' ' || COALESCE(NEW.equipement_modele, ''),
      'certificat',
      NEW.id,
      true
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_certificat_on_sign
  AFTER INSERT OR UPDATE ON majordhome.certificats
  FOR EACH ROW EXECUTE FUNCTION majordhome.log_certificat_activity();

-- ─────────────────────────────────────────────────────────────────
-- 7. Bucket Supabase Storage
-- ─────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'certificats',
  'certificats',
  false,
  10485760,
  ARRAY['application/pdf', 'image/png', 'image/jpeg']
);

CREATE POLICY "Authenticated users access certificats bucket"
  ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'certificats')
  WITH CHECK (bucket_id = 'certificats');
