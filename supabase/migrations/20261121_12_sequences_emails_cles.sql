-- Séquences d'e-mails prêtes à activer (src/lib/sequencesEmails.js, 2026-11-21) : les quatre campagnes
-- qu'une entreprise avait montées à la main dans le Mailing prennent la clé du modèle, pour que
-- Réglages → E-mails & SMS les reconnaisse (allumées, délai, texte) au lieu d'en créer des doubles.
-- Seule la clé change : nom (c'est lui que porte le journal des envois), texte, segment et cadence
-- restent ceux de l'entreprise. Données : NE PAS REJOUER.
UPDATE majordhome.mail_campaigns c
   SET key = m.nouvelle, updated_at = now()
  FROM (VALUES
    ('lead_bienvenue', 'sequence_accueil_lead'),
    ('mail_e',         'sequence_relance_contact'),
    ('mail_f',         'sequence_relance_devis'),
    ('mail_g',         'sequence_remerciement_perdu')
  ) AS m(ancienne, nouvelle)
 WHERE c.key = m.ancienne
   AND NOT EXISTS (SELECT 1 FROM majordhome.mail_campaigns d WHERE d.org_id = c.org_id AND d.key = m.nouvelle);
