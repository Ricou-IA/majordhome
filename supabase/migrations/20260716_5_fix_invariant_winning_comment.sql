-- supabase/migrations/20260716_5_fix_invariant_winning_comment.sql
-- ============================================================================
-- Correction d'un COMMENTAIRE MENSONGER, zéro changement de comportement.
--
-- La migration 20260716_1 affirmait, sur le Cas 2 : « Le cron réaligne sur PL
-- au passage suivant (auto-correction <= 15 min) ». C'est faux, et c'est le
-- genre de phrase qui envoie le prochain lecteur dans le mur.
--
-- Réalité pour un devis gagnant que PL laisse durablement en 'pending' (état
-- NORMAL : le client a signé, personne n'a encore cliqué « accepté » dans PL) :
--   cron lit 'pending' -> écrit 'pending' -> Cas 2 reforce 'accepted'
--   -> la valeur stockée ne bouge pas -> au passage suivant, statusDiffers est
--      de nouveau vrai (il compare au stocké, sans fenêtre temporelle)
--   -> un UPDATE no-op + un « update réussi » comptés toutes les 15 min, à vie.
-- C'est la signature exacte du bug A, en version bénigne et assumée : le statut
-- stocké diverge VOLONTAIREMENT de PL tant que PL n'a pas tranché. Seul un refus
-- explicite (Cas 1) réaligne réellement.
--
-- Le corps de la fonction est identique à 20260716_1 — seuls les commentaires
-- changent. On repasse par CREATE OR REPLACE pour que la version déployée en
-- base (celle que lit pg_get_functiondef) porte le bon texte, et pas seulement
-- le fichier.
-- ============================================================================

CREATE OR REPLACE FUNCTION majordhome.lead_pennylane_quotes_invariant_winning()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'majordhome', 'public'
AS $function$
BEGIN
  -- Cas 1 — le statut CHANGE vers un refus explicite : c'est Pennylane qui
  -- parle (cron), PL gagne. Le flag gagnant saute.
  -- Discriminant OLD : « la RPC pose winning sur une ligne déjà refusée »
  -- (geste commercial) présente le même NEW mais ne change pas le statut.
  IF TG_OP = 'UPDATE'
     AND NEW.quote_status IS DISTINCT FROM OLD.quote_status
     AND majordhome.quote_status_bucket(NEW.quote_status) = 'refused' THEN
    NEW.is_winning_quote := false;

  -- Cas 2 — on pose/garde winning sur un statut non validé : geste commercial
  -- préservé (PL encore pending/draft/expired, ou pas encore synchro).
  -- Le statut stocké diverge alors VOLONTAIREMENT de PL et ne se réaligne PAS
  -- tout seul : le cron réécrira le statut PL à chaque passage et ce bloc le
  -- reforcera, sans effet (no-op assumé, mais compté comme un update réussi
  -- par le cron). Seul un refus explicite (Cas 1) réaligne.
  ELSIF NEW.is_winning_quote = true
     AND majordhome.quote_status_bucket(NEW.quote_status) <> 'validated' THEN
    NEW.quote_status := 'accepted';
  END IF;

  RETURN NEW;
END;
$function$;
