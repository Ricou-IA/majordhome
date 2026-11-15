-- Réparation de donnée (une ligne) : chantier DJAFOUR remis en « Planification ».
--
-- Le 2026-11-02, le bouton de retour de la fiche chantier a remis cette carte de
-- « Planification » en « À planifier » alors qu'une installation restait posée au
-- 1er décembre ; rien ne l'en sortait ensuite (syncCardStateOnCreate ne joue qu'à la
-- création d'un RDV). Le code refuse ce recul depuis le commit 43042a19
-- (refusReculChantier) ; cette migration répare la carte déjà touchée.
--
-- Idempotente et gardée : n'agit que si la carte est encore en « À planifier » ET
-- qu'une pose à venir existe toujours. Sans effet sur une base où la carte est
-- ailleurs (harnais de répétition, rejeu).

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE majordhome.chantiers c
     SET chantier_status = 'planification',
         planification_date = current_date,
         updated_at = now()
   WHERE c.id = 'aef389a0-f2ad-4868-b547-d7006810e424'
     AND c.chantier_status = 'commande_recue'
     AND EXISTS (
       SELECT 1
         FROM majordhome.appointments a
        WHERE a.chantier_id = c.id
          AND a.appointment_type = 'installation'
          AND a.status NOT IN ('cancelled', 'no_show')
          AND a.scheduled_date >= current_date
     );
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'chantier DJAFOUR : % ligne(s) remise(s) en Planification', n;
END $$;
