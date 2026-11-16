-- ============================================================================
-- 20261116_1 — Certificat « Conforme » allégé, posé par le bureau.
-- Spec : docs/superpowers/specs/2026-11-16-certificat-conforme-allege-design.md
--
-- Quand le technicien n'a pas rempli le certificat sur place, le bureau marquait la ligne
-- « Néant » pour pouvoir facturer : aucun certificat, donc aucun document ni attestation de
-- ramonage pour le client. Le certificat allégé (« on est passé, rien d'anormal ») est une
-- ligne `certificats` comme les autres, distinguée par `mode` : toute la suite (Facturer,
-- attestation, e-mail) la trouve sans rien apprendre de nouveau.
--
-- 1. certificats.mode : 'complet' (saisi par le technicien, signé par le client) | 'allege'
-- 2. vue miroir majordhome_certificats (CREATE OR REPLACE : colonne EN FIN, reste updatable)
-- Répétée sur scripts/migration-rehearsal/ (assert-certificats-mode.sql).
-- ============================================================================

-- ── 1. Colonne ─────────────────────────────────────────────────────────────
ALTER TABLE majordhome.certificats
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'complet';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'majordhome.certificats'::regclass AND conname = 'certificats_mode_check'
  ) THEN
    ALTER TABLE majordhome.certificats
      ADD CONSTRAINT certificats_mode_check CHECK (mode IN ('complet', 'allege'));
  END IF;
END $$;

COMMENT ON COLUMN majordhome.certificats.mode IS
  '''complet'' = certificat saisi sur place et signé par le client ; ''allege'' = certificat de conformité posé par le bureau (bilan conforme, sans mesures ni signature du client).';

-- ── 2. Vue miroir (liste explicite : ajout EN FIN, sinon « cannot change name of view column ») ──
CREATE OR REPLACE VIEW public.majordhome_certificats WITH (security_invoker = true) AS
 SELECT id, intervention_id, client_id, equipment_id, contract_id, org_id, reference, type_document,
    equipement_type, equipement_marque, equipement_modele, equipement_numero_serie, equipement_annee,
    equipement_puissance_kw, equipement_fluide, equipement_charge_kg, combustible,
    donnees_entretien, donnees_ramonage, mesures, pieces_remplacees,
    bilan_conformite, anomalies_detail, action_corrective, recommandations, prochaine_intervention, tva_taux,
    technicien_id, technicien_nom, technicien_certifications, technicien_num_fgaz,
    signature_client_base64, signature_client_nom, signed_at,
    pdf_storage_path, pdf_generated_at, pdf_url, statut, date_intervention, created_by, created_at, updated_at,
    photo_plaque_path, photo_plaque_absence,
    mode
   FROM majordhome.certificats;

-- PostgREST : la vue porte une colonne de plus, le front la sélectionne dès le déploiement.
NOTIFY pgrst, 'reload schema';
