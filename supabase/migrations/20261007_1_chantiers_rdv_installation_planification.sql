-- Règle Eric 2026-10-07 : tout chantier qui a un RDV d'installation posé
-- (non annulé) est en « Planification », appros reçues ou non — sinon le
-- kanban est illisible (poses datées éparpillées en Gagné / Commande à faire /
-- À planifier). La pose provisoire (appros non closes) ne garde que sa puce
-- hachurée. Côté app : `syncCardStateOnCreate` n'exige plus `!poseProvisoire`.
-- Reprise des chantiers déjà datés restés en amont (6 chez Mayer). Idempotent.
UPDATE majordhome.chantiers c
   SET chantier_status    = 'planification',
       planification_date = COALESCE(c.planification_date, current_date),
       updated_at         = now()
 WHERE c.chantier_status IN ('gagne', 'commande_a_faire', 'commande_recue')
   AND EXISTS (
         SELECT 1 FROM majordhome.appointments a
          WHERE a.chantier_id = c.id
            AND a.appointment_type = 'installation'
            AND a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text])
       );
