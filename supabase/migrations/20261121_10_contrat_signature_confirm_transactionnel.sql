-- ============================================================================
-- contrat_signature_confirm : e-mail individuel, pas une campagne
-- Date : 2026-11-21
--
-- La confirmation de signature d'un contrat d'entretien est envoyée à UN client
-- par l'edge contract-signed-notify. Sa ligne (créée à la main chez Mayer avant
-- que `is_transactional` existe) est restée `is_transactional = false` : elle
-- apparaît parmi les campagnes diffusables de l'onglet Envoi du Mailing.
-- Le registre des e-mails automatiques (src/lib/emailsAutomatiques.js) la range
-- désormais avec les autres e-mails individuels.
--
-- Donnée seulement, idempotent, toutes organisations.
-- ============================================================================

UPDATE majordhome.mail_campaigns
   SET is_transactional = true
 WHERE key = 'contrat_signature_confirm'
   AND is_transactional IS DISTINCT FROM true;

DO $$
DECLARE
  v_restant int;
BEGIN
  SELECT count(*) INTO v_restant
    FROM majordhome.mail_campaigns
   WHERE key = 'contrat_signature_confirm' AND is_transactional IS DISTINCT FROM true;
  IF v_restant > 0 THEN
    RAISE EXCEPTION 'contrat_signature_confirm encore diffusable sur % ligne(s)', v_restant;
  END IF;
END $$;
