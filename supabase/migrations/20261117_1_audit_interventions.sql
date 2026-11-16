-- ============================================================================
-- 20261117_1 — Mouchard : les cartes Entretien / SAV entrent au journal d'audit
-- ============================================================================
-- Suite de 20261116_5 (fiche client au journal). Eric, 2026-11-17 : les cartes
-- Entretien / SAV doivent aussi être tracées dans la Timeline du client — qui a
-- ouvert la demande, qui l'a passée en « Réalisé », qui a changé l'urgence, le
-- devis, la date.
--
-- Un seul trigger : la fonction générique `majordhome.audit_row_change()` sait
-- déjà rattacher la ligne à sa fiche. Mesuré en prod le 2026-11-17 sur 1 108
-- interventions : 707 portent `client_id`, les 401 autres se rattachent par
-- `project_id` (clients.project_id), aucune ne reste sans client. `org_id`
-- n'existe pas sur la table : il est dérivé de la fiche client.
--
-- Colonne écartée : `updated_at` (seule colonne purement technique ; la ligne la
-- plus lourde pèse 623 octets, rien à écarter pour le volume).
--
-- Les lignes enfants (un certificat par équipement, `parent_id` renseigné) sont
-- tracées comme les autres : la base enregistre tout. C'est la Timeline qui
-- choisit de ne pas afficher leur création et leur purge, mécaniques (posées
-- à la planification, retirées à la déplanification).
--
-- Invariants inchangés : journal append-only, fail-safe (WARNING, jamais un
-- refus de l'écriture métier), UPDATE sans champ utile → aucune ligne.
-- Pas de rétroactif.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_audit_interventions ON majordhome.interventions;
CREATE TRIGGER trg_audit_interventions
  AFTER INSERT OR UPDATE OR DELETE ON majordhome.interventions
  FOR EACH ROW EXECUTE FUNCTION majordhome.audit_row_change('updated_at');

-- ----------------------------------------------------------------------------
-- Vérification post-apply (à exécuter, ne pas se fier au texte) :
--   SELECT tgenabled FROM pg_trigger
--    WHERE tgrelid = 'majordhome.interventions'::regclass AND tgname = 'trg_audit_interventions';  -- O
--   puis une écriture depuis l'app (état d'une carte SAV) →
--   SELECT * FROM majordhome.audit_log WHERE table_name = 'interventions' ORDER BY id DESC LIMIT 1;
--   (client_id et org_id doivent être renseignés)
-- ----------------------------------------------------------------------------
