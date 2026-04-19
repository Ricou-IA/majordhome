/**
 * segments.js — Définition des segments de ciblage mailing
 * ============================================================================
 * Chaque segment = une requête SQL qui liste les destinataires potentiels.
 * Le placeholder {{CAMPAIGN_NAME}} est substitué à l'exécution par le label
 * de la campagne courante (évite le re-envoi multiple d'une même campagne).
 *
 * Les segments restent en code (constantes techniques) ; les campagnes (templates)
 * sont en base (majordhome.mail_campaigns) et paramétrables via l'Éditeur.
 * ============================================================================
 */

export const SEGMENTS = {
  clients_contrat: {
    label: 'Clients avec contrat actif',
    family: 'Clients',
    sql: `SELECT DISTINCT c.id, c.first_name, c.last_name, c.display_name, c.email
FROM majordhome.clients c
INNER JOIN majordhome.contracts co ON co.client_id = c.id
WHERE co.status = 'active'
  AND c.is_archived = false
  AND c.mail_optin = true
  AND c.email_unsubscribed_at IS NULL
  AND c.email IS NOT NULL AND c.email != ''
  AND c.id NOT IN (SELECT client_id FROM majordhome.mailing_logs WHERE client_id IS NOT NULL AND campaign_name = '{{CAMPAIGN_NAME}}')
ORDER BY c.last_name`,
  },
  clients_contrat_clos: {
    label: 'Clients contrat clos',
    family: 'Clients',
    sql: `SELECT DISTINCT c.id, c.first_name, c.last_name, c.display_name, c.email
FROM majordhome.clients c
INNER JOIN majordhome.contracts co ON co.client_id = c.id
WHERE co.status IN ('cancelled', 'archived')
  AND c.is_archived = false
  AND c.mail_optin = true
  AND c.email_unsubscribed_at IS NULL
  AND c.email IS NOT NULL AND c.email != ''
  AND c.id NOT IN (SELECT client_id FROM majordhome.mailing_logs WHERE client_id IS NOT NULL AND campaign_name = '{{CAMPAIGN_NAME}}')
  AND c.id NOT IN (
    SELECT DISTINCT client_id FROM majordhome.contracts WHERE status = 'active'
  )
ORDER BY c.last_name`,
  },
  clients_sans_contrat: {
    label: 'Clients sans contrat (jamais eu)',
    family: 'Clients',
    sql: `SELECT c.id, c.first_name, c.last_name, c.display_name, c.email
FROM majordhome.clients c
WHERE c.is_archived = false
  AND c.mail_optin = true
  AND c.email_unsubscribed_at IS NULL
  AND c.email IS NOT NULL AND c.email != ''
  AND c.id NOT IN (SELECT client_id FROM majordhome.mailing_logs WHERE client_id IS NOT NULL AND campaign_name = '{{CAMPAIGN_NAME}}')
  AND c.id NOT IN (
    SELECT DISTINCT client_id FROM majordhome.contracts
  )
ORDER BY c.last_name`,
  },
  clients_tous: {
    label: 'Tous les clients',
    family: 'Clients',
    sql: `SELECT c.id, c.first_name, c.last_name, c.display_name, c.email
FROM majordhome.clients c
WHERE c.is_archived = false
  AND c.mail_optin = true
  AND c.email_unsubscribed_at IS NULL
  AND c.email IS NOT NULL AND c.email != ''
  AND c.id NOT IN (SELECT client_id FROM majordhome.mailing_logs WHERE client_id IS NOT NULL AND campaign_name = '{{CAMPAIGN_NAME}}')
ORDER BY c.last_name`,
  },
  leads_contacte: {
    label: 'Leads — Contacté',
    family: 'Leads',
    sql: `SELECT l.id, l.first_name, l.last_name, l.first_name AS display_name, l.email
FROM majordhome.leads l
WHERE l.status_id = '4b1b967d-1c70-4510-8095-60a27e20e244'
  AND l.email_unsubscribed_at IS NULL
  AND l.email IS NOT NULL AND l.email != ''
  AND l.id NOT IN (SELECT lead_id FROM majordhome.mailing_logs WHERE lead_id IS NOT NULL AND campaign_name ILIKE '%Contacté%')
ORDER BY l.last_name`,
  },
  leads_devis: {
    label: 'Leads — Devis envoyé',
    family: 'Leads',
    sql: `SELECT l.id, l.first_name, l.last_name, l.first_name AS display_name, l.email
FROM majordhome.leads l
WHERE l.status_id = '47937391-5ffa-4804-9b5d-72f3fec6f4fe'
  AND l.email_unsubscribed_at IS NULL
  AND l.email IS NOT NULL AND l.email != ''
  AND l.id NOT IN (SELECT lead_id FROM majordhome.mailing_logs WHERE lead_id IS NOT NULL AND campaign_name ILIKE '%Devis%')
ORDER BY l.last_name`,
  },
  leads_perdu: {
    label: 'Leads — Perdu',
    family: 'Leads',
    sql: `SELECT l.id, l.first_name, l.last_name, l.first_name AS display_name, l.email
FROM majordhome.leads l
WHERE l.status_id = 'e0419cea-d0fe-4be5-aba4-56197b2fd4fb'
  AND l.email_unsubscribed_at IS NULL
  AND l.email IS NOT NULL AND l.email != ''
  AND l.id NOT IN (SELECT lead_id FROM majordhome.mailing_logs WHERE lead_id IS NOT NULL AND campaign_name ILIKE '%Perdu%')
ORDER BY l.last_name`,
  },
  // Segment spécifique à la campagne Offre Combustible TotalEnergies (Mail H).
  // Retourne la colonne lien_pellets pour substitution {{lien_pellets}}
  // dans le nœud "Personnaliser HTML" du workflow N8N "Mayer - Mailing".
  clients_offre_combustible: {
    label: 'Clients — Offre Combustible TotalEnergies',
    family: 'Clients',
    sql: `SELECT c.id, c.first_name, c.last_name, c.display_name, c.email,
       'https://www.mayer-energie.fr/offre-pellets?token=' || c.pellets_total_token AS lien_pellets
FROM majordhome.clients c
WHERE c.is_archived = false
  AND c.mail_optin = true
  AND c.email_unsubscribed_at IS NULL
  AND c.email IS NOT NULL AND c.email != ''
  AND c.pellets_total_token IS NOT NULL
  AND c.id NOT IN (
    SELECT client_id FROM majordhome.mailing_logs
    WHERE client_id IS NOT NULL
      AND campaign_name ILIKE '%Offre Combustible%'
  )
ORDER BY c.last_name`,
  },
};
