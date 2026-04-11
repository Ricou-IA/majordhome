import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { Mail, Send, Eye, FlaskConical, Loader2, Copy, ChevronDown, ChevronUp, Users, Filter, Plus } from 'lucide-react';
import { Button } from '@components/ui/button';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useAuth } from '@contexts/AuthContext';
import supabase from '@lib/supabaseClient';

// =============================================================================
// SEGMENTS DE CIBLAGE
// =============================================================================

const SEGMENTS = {
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
  AND c.id NOT IN (SELECT client_id FROM majordhome.mailing_logs WHERE client_id IS NOT NULL)
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
  AND c.id NOT IN (SELECT client_id FROM majordhome.mailing_logs WHERE client_id IS NOT NULL)
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
  AND c.id NOT IN (SELECT client_id FROM majordhome.mailing_logs WHERE client_id IS NOT NULL)
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
  AND c.id NOT IN (SELECT client_id FROM majordhome.mailing_logs WHERE client_id IS NOT NULL)
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
  // Segment pour la campagne Offre Combustible TotalEnergies (Mail H)
  // Retourne la colonne lien_pellets pour substitution dans le template.
  // IMPORTANT : le workflow N8N "Mayer - Mailing" doit remplacer {{lien_pellets}}
  //             par item.json.lien_pellets dans le nœud "Personnaliser HTML"
  //             (tweak documenté dans le commit de la campagne).
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

// =============================================================================
// TEMPLATES CAMPAGNES
// =============================================================================

const TEMPLATES = {
  mail_a: {
    label: 'Mail A — Information (contrats actifs)',
    subject: 'Information — Mayer Energie reprend le suivi de votre contrat d\'entretien',
    tracking_type_value: 'contrat',
    default_segment: 'clients_contrat',
    html_body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background-color:#ffffff;padding:30px 40px 0 40px;text-align:center;">
<img src="https://www.mayer-energie.fr/images/logo-email.png" alt="Mayer Energie" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;" />
</td></tr>
<tr><td style="background-color:#1E4D8C;padding:12px 40px;text-align:center;">
<p style="color:#ffffff;margin:0;font-size:14px;">Votre confort, toute l'ann\u00e9e</p>
</td></tr>
<tr><td style="padding:30px 40px;color:#333333;font-size:15px;line-height:1.7;text-align:justify;">
<p style="margin:0 0 20px 0;">{{SALUTATION}}</p>
<p style="margin:0 0 20px 0;">Nous vous informons que <strong>Mayer Energie</strong> a repris l'activit\u00e9 d'Econhome et prend d\u00e9sormais en charge le suivi de votre contrat d'entretien. Vous serez contact\u00e9 pour faire connaissance et planifier avec vous la date d'intervention \u2014 le tarif restera bien s\u00fbr inchang\u00e9.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\u2705 La m\u00eame \u00e9quipe, la m\u00eame qualit\u00e9 de service</strong></p>
<p style="margin:0 0 20px 0;">Cette reprise a \u00e9t\u00e9 pens\u00e9e pour vous garantir une continuit\u00e9 totale. <strong>Ludovic et Antoine</strong>, nos techniciens que vous connaissez d\u00e9j\u00e0, continuent d'assurer l'entretien, le d\u00e9pannage et le suivi de vos \u00e9quipements. Avec plus de 15 ans d'exp\u00e9rience chacun, ils vous garantissent un service fiable, r\u00e9actif et de qualit\u00e9.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udd27 Un Responsable Technique \u00e0 votre \u00e9coute</strong></p>
<p style="margin:0 0 20px 0;"><strong>Philippe</strong>, notre Responsable Technique, est disponible pour vous recevoir et \u00e9changer avec vous sur vos projets d'installation, de r\u00e9novation \u00e9nerg\u00e9tique ou d'am\u00e9lioration de votre confort thermique et tous travaux d'\u00e9lectricit\u00e9. N'h\u00e9sitez pas \u00e0 le solliciter pour un rendez-vous.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83e\udd1d Un accompagnement personnalis\u00e9 tout au long de cette passation</strong></p>
<p style="margin:0 0 20px 0;"><strong>Michel</strong> est l\u00e0 pour nous accompagner durant cette p\u00e9riode de passation, r\u00e9pondre \u00e0 vos questions et faire le lien entre vos besoins et nos \u00e9quipes.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\u2744\ufe0f Offre sp\u00e9ciale Climatisation \u2014 pr\u00e9parez l'\u00e9t\u00e9 !</strong></p>
<p style="margin:0 0 20px 0;">Pour f\u00eater cette transition, nous avons n\u00e9goci\u00e9 avec nos fournisseurs une <strong>offre exclusive sur la climatisation</strong>. L'\u00e9t\u00e9 arrive vite \u2014 c'est le bon moment pour anticiper ! N'h\u00e9sitez pas \u00e0 nous contacter pour tout projet d'installation : nous vous r\u00e9serverons les meilleures conditions tarifaires.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udcb3 Des solutions de paiement adapt\u00e9es \u00e0 votre budget</strong></p>
<p style="margin:0 0 20px 0;">Nous avons \u00e9galement ouvert, avec notre partenaire financier, des <strong>solutions de paiement en plusieurs fois</strong> pour faciliter le financement de vos projets. Renseignez-vous aupr\u00e8s de nos \u00e9quipes.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:10px 0 25px 0;"><a href="https://www.mayer-energie.fr/contact?utm_source=emailing&utm_campaign=reprise_econhome&utm_medium=email" style="display:inline-block;background-color:#f97316;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:6px;">Nous contacter</a></td></tr></table>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83c\udf10 D\u00e9couvrez Mayer Energie sur notre site web</strong></p>
<p style="margin:0 0 20px 0;">Pour en savoir plus sur nos services \u2014 pompes \u00e0 chaleur, po\u00eales \u00e0 granul\u00e9s, climatisation, photovolta\u00efque \u2014 rendez-vous sur <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;">www.mayer-energie.fr</a></p>
<p style="margin:0 0 20px 0;">Vous y trouverez \u00e9galement notre formulaire SAV, r\u00e9ponse sous 24h.</p>
<p style="margin:0 0 20px 0;">Nous sommes fiers de vous accueillir parmi les clients de Mayer Energie et mettons tout en \u0153uvre pour \u00eatre \u00e0 la hauteur de votre confiance.</p>
<p style="margin:25px 0 5px 0;">\u00c0 tr\u00e8s bient\u00f4t,</p>
<p style="margin:0 0 5px 0;"><strong>Philippe MAZEL</strong> \u2013 Responsable Technique<br/><strong>Michel RIEUTORD</strong> \u2013 Charg\u00e9 de d\u00e9veloppement<br/><strong>L'\u00e9quipe Mayer Energie</strong></p>
</td></tr>
<tr><td style="background-color:#f8f9fa;padding:20px 40px;text-align:center;font-size:13px;color:#666666;border-top:1px solid #e9ecef;">
<p style="margin:0 0 5px 0;">\ud83d\udcde <a href="tel:+33563332314" style="color:#1E4D8C;text-decoration:none;">05 63 33 23 14</a></p>
<p style="margin:0 0 5px 0;">\ud83d\udce7 <a href="mailto:contact@mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">contact@mayer-energie.fr</a></p>
<p style="margin:0 0 5px 0;">\ud83c\udf10 <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">www.mayer-energie.fr</a></p>
<p style="margin:10px 0 0 0;color:#999999;font-size:11px;">26 Route des Pyr\u00e9n\u00e9es \u2013 81600 Gaillac</p>
<p style="margin:12px 0 0 0;color:#bbbbbb;font-size:10px;">Si vous ne souhaitez plus recevoir nos communications, <a href="mailto:contact@mayer-energie.fr?subject=D\u00e9sabonnement" style="color:#bbbbbb;text-decoration:underline;">cliquez ici pour vous d\u00e9sabonner</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  },

  mail_b: {
    label: 'Mail B — Offre Exclusive (sans contrat)',
    subject: 'Offre Exclusive — Mayer Energie reprend le flambeau, profitez-en !',
    tracking_type_value: 'standard',
    default_segment: 'clients_sans_contrat',
    html_body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background-color:#ffffff;padding:30px 40px 0 40px;text-align:center;">
<img src="https://www.mayer-energie.fr/images/logo-email.png" alt="Mayer Energie" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;" />
</td></tr>
<tr><td style="background-color:#1E4D8C;padding:12px 40px;text-align:center;">
<p style="color:#ffffff;margin:0;font-size:14px;">Votre confort, toute l'ann\u00e9e</p>
</td></tr>
<tr><td style="padding:30px 40px;color:#333333;font-size:15px;line-height:1.7;text-align:justify;">
<p style="margin:0 0 20px 0;">{{SALUTATION}}</p>
<p style="margin:0 0 20px 0;">Nous vous informons que <strong>Mayer Energie</strong> a repris l'activit\u00e9 d'Econhome et est d\u00e9sormais \u00e0 votre disposition pour l'entretien, le d\u00e9pannage et le suivi de vos \u00e9quipements.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\u2705 La m\u00eame \u00e9quipe, la m\u00eame qualit\u00e9 de service</strong></p>
<p style="margin:0 0 20px 0;">Cette reprise a \u00e9t\u00e9 pens\u00e9e pour vous garantir une continuit\u00e9 totale. <strong>Ludovic et Antoine</strong>, nos techniciens que vous connaissez d\u00e9j\u00e0, continuent d'assurer l'entretien, le d\u00e9pannage et le suivi de vos \u00e9quipements. Avec plus de 15 ans d'exp\u00e9rience chacun, ils vous garantissent un service fiable, r\u00e9actif et de qualit\u00e9.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udd27 Un Responsable Technique \u00e0 votre \u00e9coute</strong></p>
<p style="margin:0 0 20px 0;"><strong>Philippe</strong>, notre Responsable Technique, est disponible pour vous recevoir et \u00e9changer avec vous sur vos projets d'installation, de r\u00e9novation \u00e9nerg\u00e9tique ou d'am\u00e9lioration de votre confort thermique et tous travaux d'\u00e9lectricit\u00e9. N'h\u00e9sitez pas \u00e0 le solliciter pour un rendez-vous.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83e\udd1d Un accompagnement personnalis\u00e9 tout au long de cette passation</strong></p>
<p style="margin:0 0 20px 0;"><strong>Michel</strong> est l\u00e0 pour nous accompagner durant cette p\u00e9riode de passation, r\u00e9pondre \u00e0 vos questions et faire le lien entre vos besoins et nos \u00e9quipes.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udd25 Et si on prenait soin de votre chauffage avant l'hiver prochain ?</strong></p>
<p style="margin:0 0 20px 0;">La saison de chauffe touche \u00e0 sa fin \u2014 c'est le moment id\u00e9al pour prot\u00e9ger votre installation avec un <strong>contrat d'entretien Mayer Energie</strong>. Un entretien annuel, c'est la garantie d'un \u00e9quipement qui dure, d'une facture \u00e9nerg\u00e9tique ma\u00eetris\u00e9e, et la tranquillit\u00e9 d'esprit pour l'ann\u00e9e enti\u00e8re. Contactez-nous pour en savoir plus \u2014 on s'occupe de tout !</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\u2744\ufe0f Offre sp\u00e9ciale Climatisation \u2014 pr\u00e9parez l'\u00e9t\u00e9 !</strong></p>
<p style="margin:0 0 20px 0;">Pour f\u00eater cette transition, nous avons n\u00e9goci\u00e9 avec nos fournisseurs une <strong>offre exclusive sur la climatisation</strong>. L'\u00e9t\u00e9 arrive vite \u2014 c'est le bon moment pour anticiper ! N'h\u00e9sitez pas \u00e0 nous contacter pour tout projet d'installation : nous vous r\u00e9serverons les meilleures conditions tarifaires.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udcb3 Des solutions de paiement adapt\u00e9es \u00e0 votre budget</strong></p>
<p style="margin:0 0 20px 0;">Nous avons \u00e9galement ouvert, avec notre partenaire financier, des <strong>solutions de paiement en plusieurs fois</strong> pour faciliter le financement de vos projets. Renseignez-vous aupr\u00e8s de nos \u00e9quipes.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:10px 0 25px 0;"><a href="https://www.mayer-energie.fr/contact?utm_source=emailing&utm_campaign=reprise_econhome&utm_medium=email" style="display:inline-block;background-color:#f97316;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:6px;">Nous contacter</a></td></tr></table>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83c\udf10 D\u00e9couvrez Mayer Energie sur notre site web</strong></p>
<p style="margin:0 0 20px 0;">Pour en savoir plus sur nos services \u2014 pompes \u00e0 chaleur, po\u00eales \u00e0 granul\u00e9s, climatisation, photovolta\u00efque \u2014 rendez-vous sur <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;">www.mayer-energie.fr</a></p>
<p style="margin:0 0 20px 0;">Vous y trouverez \u00e9galement notre formulaire SAV, r\u00e9ponse sous 24h.</p>
<p style="margin:0 0 20px 0;">Nous sommes fiers de vous accueillir parmi les clients de Mayer Energie et mettons tout en \u0153uvre pour \u00eatre \u00e0 la hauteur de votre confiance.</p>
<p style="margin:25px 0 5px 0;">\u00c0 tr\u00e8s bient\u00f4t,</p>
<p style="margin:0 0 5px 0;"><strong>Philippe MAZEL</strong> \u2013 Responsable Technique<br/><strong>Michel RIEUTORD</strong> \u2013 Charg\u00e9 de d\u00e9veloppement<br/><strong>L'\u00e9quipe Mayer Energie</strong></p>
</td></tr>
<tr><td style="background-color:#f8f9fa;padding:20px 40px;text-align:center;font-size:13px;color:#666666;border-top:1px solid #e9ecef;">
<p style="margin:0 0 5px 0;">\ud83d\udcde <a href="tel:+33563332314" style="color:#1E4D8C;text-decoration:none;">05 63 33 23 14</a></p>
<p style="margin:0 0 5px 0;">\ud83d\udce7 <a href="mailto:contact@mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">contact@mayer-energie.fr</a></p>
<p style="margin:0 0 5px 0;">\ud83c\udf10 <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">www.mayer-energie.fr</a></p>
<p style="margin:10px 0 0 0;color:#999999;font-size:11px;">26 Route des Pyr\u00e9n\u00e9es \u2013 81600 Gaillac</p>
<p style="margin:12px 0 0 0;color:#bbbbbb;font-size:10px;">Si vous ne souhaitez plus recevoir nos communications, <a href="mailto:contact@mayer-energie.fr?subject=D\u00e9sabonnement" style="color:#bbbbbb;text-decoration:underline;">cliquez ici pour vous d\u00e9sabonner</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  },

  mail_c: {
    label: 'Mail C — Reconquête Info (contrat clos)',
    subject: 'Votre ancien contrat d\'entretien — Mayer Energie prend le relais',
    tracking_type_value: 'reconquete',
    default_segment: 'clients_contrat_clos',
    html_body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background-color:#ffffff;padding:30px 40px 0 40px;text-align:center;">
<img src="https://www.mayer-energie.fr/images/logo-email.png" alt="Mayer Energie" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;" />
</td></tr>
<tr><td style="background-color:#1E4D8C;padding:12px 40px;text-align:center;">
<p style="color:#ffffff;margin:0;font-size:14px;">Votre confort, toute l\u2019ann\u00e9e</p>
</td></tr>
<tr><td style="padding:30px 40px;color:#333333;font-size:15px;line-height:1.7;text-align:justify;">
<p style="margin:0 0 20px 0;">{{SALUTATION}}</p>
<p style="margin:0 0 20px 0;">Vous avez \u00e9t\u00e9 client(e) d\u2019Econhome et nous tenions \u00e0 vous informer personnellement : <strong>Mayer Energie</strong> a repris l\u2019ensemble de l\u2019activit\u00e9 et de la client\u00e8le d\u2019Econhome. M\u00eame si votre contrat d\u2019entretien n\u2019est plus actif aujourd\u2019hui, nous restons \u00e0 votre disposition pour le suivi, l\u2019entretien et le d\u00e9pannage de vos \u00e9quipements.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\u2705 La m\u00eame \u00e9quipe, un nouveau souffle</strong></p>
<p style="margin:0 0 20px 0;"><strong>Ludovic et Antoine</strong>, les techniciens que vous connaissez d\u00e9j\u00e0, continuent d\u2019assurer les interventions terrain. Avec plus de 15 ans d\u2019exp\u00e9rience chacun, ils vous garantissent un service fiable et r\u00e9actif. Rien ne change sur le terrain \u2014 sauf que vous b\u00e9n\u00e9ficiez d\u00e9sormais de la structure et des moyens de Mayer Energie.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udd04 Envie de reprendre un contrat d\u2019entretien ?</strong></p>
<p style="margin:0 0 20px 0;">Un \u00e9quipement bien entretenu, c\u2019est la garantie de performances optimales, d\u2019une dur\u00e9e de vie prolong\u00e9e et d\u2019une facture \u00e9nerg\u00e9tique ma\u00eetris\u00e9e. Nous vous proposons de <strong>reprendre un contrat d\u2019entretien</strong> dans des conditions avantageuses. Contactez-nous pour en discuter \u2014 on s\u2019occupe de tout.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udd27 Un Responsable Technique \u00e0 votre \u00e9coute</strong></p>
<p style="margin:0 0 20px 0;"><strong>Philippe</strong>, notre Responsable Technique, est disponible pour \u00e9changer avec vous sur vos projets d\u2019installation, de r\u00e9novation \u00e9nerg\u00e9tique ou d\u2019am\u00e9lioration de votre confort thermique. N\u2019h\u00e9sitez pas \u00e0 le solliciter pour un rendez-vous.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\u2744\ufe0f Offre sp\u00e9ciale Climatisation \u2014 pr\u00e9parez l\u2019\u00e9t\u00e9 !</strong></p>
<p style="margin:0 0 20px 0;">Nous avons n\u00e9goci\u00e9 avec nos fournisseurs une <strong>offre exclusive sur la climatisation</strong>. L\u2019\u00e9t\u00e9 arrive vite \u2014 c\u2019est le bon moment pour anticiper ! Contactez-nous pour b\u00e9n\u00e9ficier des meilleures conditions.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udcb3 Des solutions de paiement adapt\u00e9es</strong></p>
<p style="margin:0 0 20px 0;">Avec notre partenaire financier, nous proposons des <strong>solutions de paiement en plusieurs fois</strong> pour faciliter le financement de vos projets. Renseignez-vous aupr\u00e8s de nos \u00e9quipes.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:10px 0 25px 0;"><a href="https://www.mayer-energie.fr/contact?utm_source=emailing&utm_campaign=reconquete_contrat_clos&utm_medium=email" style="display:inline-block;background-color:#f97316;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:6px;">Reprendre contact</a></td></tr></table>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83c\udf10 D\u00e9couvrez Mayer Energie</strong></p>
<p style="margin:0 0 20px 0;">Pour en savoir plus sur nos services \u2014 pompes \u00e0 chaleur, po\u00eales \u00e0 granul\u00e9s, climatisation, photovolta\u00efque \u2014 rendez-vous sur <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;">www.mayer-energie.fr</a></p>
<p style="margin:0 0 20px 0;">Nous serions ravis de vous compter \u00e0 nouveau parmi nos clients.</p>
<p style="margin:25px 0 5px 0;">\u00c0 tr\u00e8s bient\u00f4t,</p>
<p style="margin:0 0 5px 0;"><strong>Philippe MAZEL</strong> \u2013 Responsable Technique<br/><strong>Michel RIEUTORD</strong> \u2013 Charg\u00e9 de d\u00e9veloppement<br/><strong>L\u2019\u00e9quipe Mayer Energie</strong></p>
</td></tr>
<tr><td style="background-color:#f8f9fa;padding:20px 40px;text-align:center;font-size:13px;color:#666666;border-top:1px solid #e9ecef;">
<p style="margin:0 0 5px 0;">\ud83d\udcde <a href="tel:+33563332314" style="color:#1E4D8C;text-decoration:none;">05 63 33 23 14</a></p>
<p style="margin:0 0 5px 0;">\ud83d\udce7 <a href="mailto:contact@mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">contact@mayer-energie.fr</a></p>
<p style="margin:0 0 5px 0;">\ud83c\udf10 <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">www.mayer-energie.fr</a></p>
<p style="margin:10px 0 0 0;color:#999999;font-size:11px;">26 Route des Pyr\u00e9n\u00e9es \u2013 81600 Gaillac</p>
<p style="margin:12px 0 0 0;color:#bbbbbb;font-size:10px;">Si vous ne souhaitez plus recevoir nos communications, <a href="mailto:contact@mayer-energie.fr?subject=D\u00e9sabonnement" style="color:#bbbbbb;text-decoration:underline;">cliquez ici pour vous d\u00e9sabonner</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  },

  mail_d: {
    label: 'Mail D — Offre Reconquête (contrat clos)',
    subject: 'On ne vous a pas oublié — Offre spéciale pour votre retour chez Mayer Energie',
    tracking_type_value: 'reconquete',
    default_segment: 'clients_contrat_clos',
    html_body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background-color:#ffffff;padding:30px 40px 0 40px;text-align:center;">
<img src="https://www.mayer-energie.fr/images/logo-email.png" alt="Mayer Energie" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;" />
</td></tr>
<tr><td style="background-color:#1E4D8C;padding:12px 40px;text-align:center;">
<p style="color:#ffffff;margin:0;font-size:14px;">Votre confort, toute l\u2019ann\u00e9e</p>
</td></tr>
<tr><td style="padding:30px 40px;color:#333333;font-size:15px;line-height:1.7;text-align:justify;">
<p style="margin:0 0 20px 0;">{{SALUTATION}}</p>
<p style="margin:0 0 20px 0;">Vous avez \u00e9t\u00e9 client(e) d\u2019Econhome et votre contrat d\u2019entretien a pris fin. Bonne nouvelle : <strong>Mayer Energie</strong> a repris l\u2019activit\u00e9 et nous aimerions vous proposer de <strong>renouer avec un suivi professionnel de vos \u00e9quipements</strong>.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83c\udf81 Offre sp\u00e9ciale \u00ab\u00a0Retour client\u00a0\u00bb</strong></p>
<p style="margin:0 0 20px 0;">Pour c\u00e9l\u00e9brer cette nouvelle \u00e8re et vous remercier de votre confiance pass\u00e9e, nous vous r\u00e9servons des <strong>conditions privil\u00e9gi\u00e9es sur la souscription d\u2019un nouveau contrat d\u2019entretien</strong>. Appelez-nous ou r\u00e9pondez \u00e0 cet email pour en b\u00e9n\u00e9ficier \u2014 cette offre est limit\u00e9e dans le temps.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\u2705 Toujours la m\u00eame \u00e9quipe de confiance</strong></p>
<p style="margin:0 0 20px 0;"><strong>Ludovic et Antoine</strong>, que vous connaissez d\u00e9j\u00e0, assurent toujours les interventions. Avec plus de 15 ans d\u2019exp\u00e9rience, ils vous garantissent un travail soign\u00e9 et r\u00e9actif.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udd25 Pourquoi reprendre un contrat d\u2019entretien ?</strong></p>
<p style="margin:0 0 8px 0;">\u2022 <strong>Performances optimales</strong> : un \u00e9quipement entretenu consomme moins et chauffe mieux</p>
<p style="margin:0 0 8px 0;">\u2022 <strong>Dur\u00e9e de vie prolong\u00e9e</strong> : \u00e9vitez les pannes co\u00fbteuses et les remplacements pr\u00e9matur\u00e9s</p>
<p style="margin:0 0 8px 0;">\u2022 <strong>Priorit\u00e9 d\u00e9pannage</strong> : en cas de panne, nos clients sous contrat passent en premier</p>
<p style="margin:0 0 20px 0;">\u2022 <strong>Tranquillit\u00e9 d\u2019esprit</strong> : on g\u00e8re tout, vous n\u2019avez qu\u2019\u00e0 profiter de votre confort</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\u2744\ufe0f Offre Climatisation \u2014 l\u2019\u00e9t\u00e9 approche !</strong></p>
<p style="margin:0 0 20px 0;">Profitez \u00e9galement de notre <strong>offre exclusive sur la climatisation</strong> n\u00e9goci\u00e9e avec nos fournisseurs. Le bon moment pour anticiper les chaleurs estivales.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udcb3 Facilit\u00e9s de paiement</strong></p>
<p style="margin:0 0 20px 0;">Avec notre partenaire financier, b\u00e9n\u00e9ficiez de <strong>solutions de paiement en plusieurs fois</strong> pour \u00e9taler le co\u00fbt de vos projets.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:10px 0 25px 0;"><a href="https://www.mayer-energie.fr/contact?utm_source=emailing&utm_campaign=reconquete_contrat_clos&utm_medium=email" style="display:inline-block;background-color:#f97316;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:6px;">Profiter de l\u2019offre retour client</a></td></tr></table>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83c\udf10 D\u00e9couvrez Mayer Energie</strong></p>
<p style="margin:0 0 20px 0;">Pompes \u00e0 chaleur, po\u00eales \u00e0 granul\u00e9s, climatisation, photovolta\u00efque\u2026 D\u00e9couvrez nos services sur <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;">www.mayer-energie.fr</a></p>
<p style="margin:0 0 20px 0;">On serait vraiment heureux de vous retrouver parmi nos clients. \u00c0 vous de jouer !</p>
<p style="margin:25px 0 5px 0;">\u00c0 tr\u00e8s bient\u00f4t,</p>
<p style="margin:0 0 5px 0;"><strong>Philippe MAZEL</strong> \u2013 Responsable Technique<br/><strong>Michel RIEUTORD</strong> \u2013 Charg\u00e9 de d\u00e9veloppement<br/><strong>L\u2019\u00e9quipe Mayer Energie</strong></p>
</td></tr>
<tr><td style="background-color:#f8f9fa;padding:20px 40px;text-align:center;font-size:13px;color:#666666;border-top:1px solid #e9ecef;">
<p style="margin:0 0 5px 0;">\ud83d\udcde <a href="tel:+33563332314" style="color:#1E4D8C;text-decoration:none;">05 63 33 23 14</a></p>
<p style="margin:0 0 5px 0;">\ud83d\udce7 <a href="mailto:contact@mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">contact@mayer-energie.fr</a></p>
<p style="margin:0 0 5px 0;">\ud83c\udf10 <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">www.mayer-energie.fr</a></p>
<p style="margin:10px 0 0 0;color:#999999;font-size:11px;">26 Route des Pyr\u00e9n\u00e9es \u2013 81600 Gaillac</p>
<p style="margin:12px 0 0 0;color:#bbbbbb;font-size:10px;">Si vous ne souhaitez plus recevoir nos communications, <a href="mailto:contact@mayer-energie.fr?subject=D\u00e9sabonnement" style="color:#bbbbbb;text-decoration:underline;">cliquez ici pour vous d\u00e9sabonner</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  },

  mail_e: {
    label: 'Mail E — Relance Contacté (leads)',
    subject: 'Votre projet énergie — Mayer Energie reste à votre disposition',
    tracking_type_value: 'relance',
    default_segment: 'leads_contacte',
    html_body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background-color:#ffffff;padding:30px 40px 0 40px;text-align:center;">
<img src="https://www.mayer-energie.fr/images/logo-email.png" alt="Mayer Energie" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;" />
</td></tr>
<tr><td style="background-color:#1E4D8C;padding:12px 40px;text-align:center;">
<p style="color:#ffffff;margin:0;font-size:14px;">Votre confort, toute l\u2019ann\u00e9e</p>
</td></tr>
<tr><td style="padding:30px 40px;color:#333333;font-size:15px;line-height:1.7;text-align:justify;">
<p style="margin:0 0 20px 0;">{{SALUTATION}}</p>
<p style="margin:0 0 20px 0;">Nous nous sommes r\u00e9cemment rapproch\u00e9s de vous au sujet de votre projet \u00e9nerg\u00e9tique, et nous souhaitions simplement vous confirmer que <strong>nous restons \u00e0 votre enti\u00e8re disposition</strong>. Que vous ayez besoin d\u2019un peu de temps pour m\u00fbrir votre r\u00e9flexion ou que vous souhaitiez avancer d\u00e8s maintenant, nous sommes l\u00e0 pour vous accompagner \u00e0 votre rythme.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udcac Pourquoi nous contacter ?</strong></p>
<p style="margin:0 0 8px 0;">\u2022 Un <strong>devis gratuit et sans engagement</strong> pour votre projet</p>
<p style="margin:0 0 8px 0;">\u2022 Des <strong>conseils personnalis\u00e9s</strong> adapt\u00e9s \u00e0 votre logement et vos besoins</p>
<p style="margin:0 0 8px 0;">\u2022 Un accompagnement sur les <strong>aides financi\u00e8res</strong> disponibles (MaPrimeR\u00e9nov\u2019, CEE\u2026)</p>
<p style="margin:0 0 20px 0;">\u2022 Des <strong>facilit\u00e9s de paiement</strong> pour \u00e9taler le co\u00fbt de votre projet</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udd27 Notre \u00e9quipe</strong></p>
<p style="margin:0 0 20px 0;">Nos techniciens <strong>Ludovic et Antoine</strong>, forts de plus de 15 ans d\u2019exp\u00e9rience, assurent des installations soign\u00e9es et un suivi rigoureux.</p>
<p style="margin:0 0 20px 0;"><strong>Philippe</strong> ou <strong>Michel</strong>, notre Charg\u00e9 de d\u00e9veloppement, sont disponibles pour vous guider dans votre projet. N\u2019h\u00e9sitez pas \u00e0 les contacter directement \u2014 ils sont l\u00e0 pour r\u00e9pondre \u00e0 toutes vos questions.</p>
<p style="margin:0 0 20px 0;">Un simple appel ou un email suffit \u2014 nous nous adaptons \u00e0 votre emploi du temps.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:10px 0 25px 0;"><a href="https://www.mayer-energie.fr/contact?utm_source=emailing&utm_campaign=relance_contacte&utm_medium=email" style="display:inline-block;background-color:#f97316;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:6px;">\u00catre rappel\u00e9 gratuitement</a></td></tr></table>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83c\udf10 En savoir plus</strong></p>
<p style="margin:0 0 20px 0;">Pompes \u00e0 chaleur, climatisation, po\u00eales \u00e0 granul\u00e9s, photovolta\u00efque\u2026 D\u00e9couvrez nos solutions sur <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;">www.mayer-energie.fr</a></p>
<p style="margin:0 0 20px 0;">Nous esp\u00e9rons avoir l\u2019occasion d\u2019\u00e9changer avec vous tr\u00e8s prochainement.</p>
<p style="margin:25px 0 5px 0;">Cordialement,</p>
<p style="margin:0 0 5px 0;"><strong>Philippe MAZEL</strong> \u2013 Responsable Technique<br/><strong>Michel RIEUTORD</strong> \u2013 Charg\u00e9 de d\u00e9veloppement<br/><strong>L\u2019\u00e9quipe Mayer Energie</strong></p>
</td></tr>
<tr><td style="background-color:#f8f9fa;padding:20px 40px;text-align:center;font-size:13px;color:#666666;border-top:1px solid #e9ecef;">
<p style="margin:0 0 5px 0;">\ud83d\udcde <a href="tel:+33563332314" style="color:#1E4D8C;text-decoration:none;">05 63 33 23 14</a></p>
<p style="margin:0 0 5px 0;">\ud83d\udce7 <a href="mailto:contact@mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">contact@mayer-energie.fr</a></p>
<p style="margin:0 0 5px 0;">\ud83c\udf10 <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">www.mayer-energie.fr</a></p>
<p style="margin:10px 0 0 0;color:#999999;font-size:11px;">26 Route des Pyr\u00e9n\u00e9es \u2013 81600 Gaillac</p>
<p style="margin:12px 0 0 0;color:#bbbbbb;font-size:10px;">Si vous ne souhaitez plus recevoir nos communications, <a href="mailto:contact@mayer-energie.fr?subject=D\u00e9sabonnement" style="color:#bbbbbb;text-decoration:underline;">cliquez ici pour vous d\u00e9sabonner</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  },

  mail_f: {
    label: 'Mail F — Relance Devis (leads)',
    subject: 'Votre devis Mayer Energie — des questions ? Nous sommes là',
    tracking_type_value: 'relance_devis',
    default_segment: 'leads_devis',
    html_body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background-color:#ffffff;padding:30px 40px 0 40px;text-align:center;">
<img src="https://www.mayer-energie.fr/images/logo-email.png" alt="Mayer Energie" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;" />
</td></tr>
<tr><td style="background-color:#1E4D8C;padding:12px 40px;text-align:center;">
<p style="color:#ffffff;margin:0;font-size:14px;">Votre confort, toute l\u2019ann\u00e9e</p>
</td></tr>
<tr><td style="padding:30px 40px;color:#333333;font-size:15px;line-height:1.7;text-align:justify;">
<p style="margin:0 0 20px 0;">{{SALUTATION}}</p>
<p style="margin:0 0 20px 0;">Vous avez re\u00e7u r\u00e9cemment un devis de notre part et nous souhaitions simplement prendre de vos nouvelles. Merci encore pour <strong>le temps que vous nous avez accord\u00e9</strong> lors de notre \u00e9change \u2014 c\u2019\u00e9tait un plaisir d\u2019\u00e9tudier votre projet.</p>
<p style="margin:0 0 20px 0;">Nous comprenons qu\u2019un projet \u00e9nerg\u00e9tique m\u00e9rite r\u00e9flexion \u2014 nous restons <strong>\u00e0 votre enti\u00e8re disposition</strong> pour r\u00e9pondre \u00e0 vos questions.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\u2753 Des questions sur votre devis ?</strong></p>
<p style="margin:0 0 8px 0;">\u2022 Nous pouvons <strong>adapter la solution technique</strong> \u00e0 vos contraintes (planning, choix d\u2019\u00e9quipement, configuration)</p>
<p style="margin:0 0 8px 0;">\u2022 Un <strong>deuxi\u00e8me rendez-vous</strong> est toujours possible si vous souhaitez approfondir certains points</p>
<p style="margin:0 0 20px 0;">\u2022 Des <strong>facilit\u00e9s de paiement</strong> sont disponibles avec notre partenaire financier pour \u00e9taler votre investissement</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udcb6 Avez-vous estim\u00e9 vos aides ?</strong></p>
<p style="margin:0 0 20px 0;">Selon votre situation, vous pouvez b\u00e9n\u00e9ficier de <strong>MaPrimeR\u00e9nov\u2019</strong>, des <strong>Certificats d\u2019\u00c9conomies d\u2019\u00c9nergie (CEE)</strong> ou d\u2019une <strong>TVA \u00e0 taux r\u00e9duit</strong>. Ces aides peuvent r\u00e9duire significativement le reste \u00e0 charge de votre projet. Pour estimer le montant auquel vous avez droit, utilisez notre simulateur en ligne :</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:0 0 20px 0;"><a href="https://www.mayer-energie.fr/aides?utm_source=emailing&utm_campaign=relance_devis&utm_medium=email" style="display:inline-block;background-color:#1E4D8C;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;padding:10px 24px;border-radius:6px;">Calculer mes aides</a></td></tr></table>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udcc5 \u00c0 propos des tarifs</strong></p>
<p style="margin:0 0 20px 0;">Gr\u00e2ce \u00e0 nos accords n\u00e9goci\u00e9s avec nos fournisseurs, nous sommes en mesure de <strong>garantir les tarifs de votre devis pendant 30 jours</strong>. Au-del\u00e0 de ce d\u00e9lai, les prix des \u00e9quipements et mati\u00e8res premi\u00e8res \u00e9voluent r\u00e9guli\u00e8rement \u00e0 la hausse \u2014 nous vous conseillons donc de ne pas trop tarder pour profiter des conditions actuelles.</p>
<p style="margin:0 0 20px 0;"><strong>Philippe</strong> ou <strong>Michel</strong> sont disponibles pour \u00e9changer avec vous \u00e0 tout moment. Un simple appel ou email suffit.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:10px 0 25px 0;"><a href="https://www.mayer-energie.fr/contact?utm_source=emailing&utm_campaign=relance_devis&utm_medium=email" style="display:inline-block;background-color:#f97316;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:6px;">Reprendre contact</a></td></tr></table>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udcdd Votre avis nous int\u00e9resse</strong></p>
<p style="margin:0 0 20px 0;">Et si finalement vous d\u00e9cidiez de ne pas donner suite, aucun souci \u2014 nous le comprendrons parfaitement. Dans ce cas, nous serions reconnaissants si vous pouviez nous faire part de la raison : cela nous aide \u00e0 <strong>am\u00e9liorer notre service et nos offres</strong>. Un simple mot par email ou par t\u00e9l\u00e9phone nous suffit.</p>
<p style="margin:0 0 20px 0;">Nous esp\u00e9rons dans tous les cas avoir l\u2019occasion de concr\u00e9tiser votre projet ensemble.</p>
<p style="margin:25px 0 5px 0;">Cordialement,</p>
<p style="margin:0 0 5px 0;"><strong>Philippe MAZEL</strong> \u2013 Responsable Technique<br/><strong>Michel RIEUTORD</strong> \u2013 Charg\u00e9 de d\u00e9veloppement<br/><strong>L\u2019\u00e9quipe Mayer Energie</strong></p>
</td></tr>
<tr><td style="background-color:#f8f9fa;padding:20px 40px;text-align:center;font-size:13px;color:#666666;border-top:1px solid #e9ecef;">
<p style="margin:0 0 5px 0;">\ud83d\udcde <a href="tel:+33563332314" style="color:#1E4D8C;text-decoration:none;">05 63 33 23 14</a></p>
<p style="margin:0 0 5px 0;">\ud83d\udce7 <a href="mailto:contact@mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">contact@mayer-energie.fr</a></p>
<p style="margin:0 0 5px 0;">\ud83c\udf10 <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">www.mayer-energie.fr</a></p>
<p style="margin:10px 0 0 0;color:#999999;font-size:11px;">26 Route des Pyr\u00e9n\u00e9es \u2013 81600 Gaillac</p>
<p style="margin:12px 0 0 0;color:#bbbbbb;font-size:10px;">Si vous ne souhaitez plus recevoir nos communications, <a href="mailto:contact@mayer-energie.fr?subject=D\u00e9sabonnement" style="color:#bbbbbb;text-decoration:underline;">cliquez ici pour vous d\u00e9sabonner</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  },

  mail_g: {
    label: 'Mail G — Remerciement Perdu (leads)',
    subject: 'Merci pour votre confiance — Mayer Energie reste à vos côtés',
    tracking_type_value: 'remerciement_perdu',
    default_segment: 'leads_perdu',
    html_body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background-color:#ffffff;padding:30px 40px 0 40px;text-align:center;">
<img src="https://www.mayer-energie.fr/images/logo-email.png" alt="Mayer Energie" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;" />
</td></tr>
<tr><td style="background-color:#1E4D8C;padding:12px 40px;text-align:center;">
<p style="color:#ffffff;margin:0;font-size:14px;">Votre confort, toute l\u2019ann\u00e9e</p>
</td></tr>
<tr><td style="padding:30px 40px;color:#333333;font-size:15px;line-height:1.7;text-align:justify;">
<p style="margin:0 0 20px 0;">{{SALUTATION}}</p>
<p style="margin:0 0 20px 0;">Nous tenions \u00e0 vous remercier sinc\u00e8rement pour <strong>le temps que vous nous avez accord\u00e9</strong> et la confiance que vous nous avez t\u00e9moign\u00e9e en nous consultant pour votre projet. M\u00eame si nous n\u2019avons pas eu l\u2019occasion de travailler ensemble cette fois-ci, ce fut un plaisir d\u2019\u00e9changer avec vous.</p>
<p style="margin:0 0 20px 0;">Votre projet \u00e9voluera peut-\u00eatre dans le temps, et si c\u2019est le cas, <strong>nous serons bien entendu disponibles pour vous</strong>. N\u2019h\u00e9sitez pas \u00e0 revenir vers nous quand le moment sera le bon.</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83c\udf10 En attendant, nos ressources sont \u00e0 votre disposition</strong></p>
<p style="margin:0 0 20px 0;">Notre site web regorge d\u2019informations utiles pour vous accompagner dans vos r\u00e9flexions \u00e9nerg\u00e9tiques :</p>
<p style="margin:0 0 8px 0;">\u2022 <strong><a href="https://www.mayer-energie.fr/faq?utm_source=emailing&utm_campaign=remerciement_perdu&utm_medium=email" style="color:#1E4D8C;">Foire aux questions</a></strong> \u2014 les r\u00e9ponses aux questions les plus courantes sur le chauffage, la climatisation et les \u00e9nergies renouvelables</p>
<p style="margin:0 0 8px 0;">\u2022 <strong><a href="https://www.mayer-energie.fr/guides?utm_source=emailing&utm_campaign=remerciement_perdu&utm_medium=email" style="color:#1E4D8C;">Nos guides pratiques</a></strong> \u2014 des conseils concrets pour entretenir vos \u00e9quipements, r\u00e9duire votre consommation et choisir les bonnes solutions</p>
<p style="margin:0 0 8px 0;">\u2022 <strong><a href="https://www.mayer-energie.fr/aides?utm_source=emailing&utm_campaign=remerciement_perdu&utm_medium=email" style="color:#1E4D8C;">Calculateur d\u2019aides</a></strong> \u2014 estimez en quelques clics le montant des aides financi\u00e8res auxquelles vous avez droit (MaPrimeR\u00e9nov\u2019, CEE, TVA r\u00e9duite)</p>
<p style="margin:0 0 20px 0;">\u2022 <strong><a href="https://www.mayer-energie.fr/contact?utm_source=emailing&utm_campaign=remerciement_perdu&utm_medium=email" style="color:#1E4D8C;">Formulaire SAV</a></strong> \u2014 r\u00e9ponse sous 24h pour toute question technique ou demande d\u2019intervention</p>
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udd27 Nos services au quotidien</strong></p>
<p style="margin:0 0 20px 0;">M\u00eame sans projet d\u2019installation imm\u00e9diat, nous restons \u00e0 votre service pour l\u2019<strong>entretien</strong>, le <strong>d\u00e9pannage</strong> et le <strong>suivi</strong> de vos \u00e9quipements existants. Pompes \u00e0 chaleur, climatisation, po\u00eales \u00e0 granul\u00e9s, photovolta\u00efque \u2014 quelle que soit votre installation, nous pouvons vous accompagner.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:10px 0 25px 0;"><a href="https://www.mayer-energie.fr?utm_source=emailing&utm_campaign=remerciement_perdu&utm_medium=email" style="display:inline-block;background-color:#f97316;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:6px;">Visiter notre site</a></td></tr></table>
<p style="margin:0 0 20px 0;">Merci encore et \u00e0 bient\u00f4t peut-\u00eatre !</p>
<p style="margin:25px 0 5px 0;">Cordialement,</p>
<p style="margin:0 0 5px 0;"><strong>Philippe MAZEL</strong> \u2013 Responsable Technique<br/><strong>Michel RIEUTORD</strong> \u2013 Charg\u00e9 de d\u00e9veloppement<br/><strong>L\u2019\u00e9quipe Mayer Energie</strong></p>
</td></tr>
<tr><td style="background-color:#f8f9fa;padding:20px 40px;text-align:center;font-size:13px;color:#666666;border-top:1px solid #e9ecef;">
<p style="margin:0 0 5px 0;">\ud83d\udcde <a href="tel:+33563332314" style="color:#1E4D8C;text-decoration:none;">05 63 33 23 14</a></p>
<p style="margin:0 0 5px 0;">\ud83d\udce7 <a href="mailto:contact@mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">contact@mayer-energie.fr</a></p>
<p style="margin:0 0 5px 0;">\ud83c\udf10 <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">www.mayer-energie.fr</a></p>
<p style="margin:10px 0 0 0;color:#999999;font-size:11px;">26 Route des Pyr\u00e9n\u00e9es \u2013 81600 Gaillac</p>
<p style="margin:12px 0 0 0;color:#bbbbbb;font-size:10px;">Si vous ne souhaitez plus recevoir nos communications, <a href="mailto:contact@mayer-energie.fr?subject=D\u00e9sabonnement" style="color:#bbbbbb;text-decoration:underline;">cliquez ici pour vous d\u00e9sabonner</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Mail H — Offre Combustible TotalEnergies + Parrainage (fid\u00e9lit\u00e9)
  // ──────────────────────────────────────────────────────────────────────────
  // N\u00e9cessite le segment clients_offre_combustible qui retourne la colonne
  // lien_pellets, ET un tweak du workflow N8N pour substituer {{lien_pellets}}
  // par item.json.lien_pellets dans le n\u0153ud "Personnaliser HTML".
  mail_h_offre_combustible: {
    label: 'Mail H — Offre Combustible + Parrainage',
    subject: '\ud83c\udf81 Votre cadeau de fid\u00e9lit\u00e9 + une offre exclusive qu\u2019on a n\u00e9goci\u00e9e pour vous',
    tracking_type_value: 'offre_combustible',
    default_segment: 'clients_offre_combustible',
    html_body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
<!-- Preheader (texte de preview masqu\u00e9 dans l'inbox) -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Un cadeau de fid\u00e9lit\u00e9, une offre pellets n\u00e9goci\u00e9e avec TotalEnergies et une palette offerte en parrainage.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background-color:#ffffff;padding:30px 40px 0 40px;text-align:center;">
<img src="https://www.mayer-energie.fr/images/logo-email.png" alt="Mayer Energie" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;" />
</td></tr>
<tr><td style="background-color:#1E4D8C;padding:12px 40px;text-align:center;">
<p style="color:#ffffff;margin:0;font-size:14px;">Votre confort, toute l\u2019ann\u00e9e</p>
</td></tr>
<tr><td style="padding:30px 40px 10px 40px;color:#333333;font-size:15px;line-height:1.7;text-align:justify;">

<p style="margin:0 0 20px 0;">{{SALUTATION}}</p>

<p style="margin:0 0 28px 0;">Vous faites partie de nos clients fid\u00e8les, et on a travaill\u00e9 ce mois-ci pour vous le prouver concr\u00e8tement.</p>

<!-- Section 1 : Offre pellets TotalEnergies -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:8px;margin:0 0 28px 0;">
<tr><td style="padding:22px 24px;">
<p style="margin:0 0 10px 0;font-size:17px;color:#ea580c;"><strong>\u26a1 NOUVEAUT\u00c9 \u2014 L\u2019offre pellets TotalEnergies, r\u00e9serv\u00e9e \u00e0 nos clients</strong></p>
<p style="margin:0 0 14px 0;">On a n\u00e9goci\u00e9 directement avec TotalEnergies un acc\u00e8s exclusif \u00e0 leurs pellets au <strong>meilleur prix du march\u00e9</strong> \u2014 c\u2019est leur engagement, et le n\u00f4tre. Impossible de trouver moins cher ailleurs.</p>
<p style="margin:0 0 8px 0;"><strong>Comment \u00e7a marche :</strong></p>
<ul style="margin:0 0 16px 18px;padding:0;">
<li style="margin-bottom:4px;">Vous cliquez sur le lien ci-dessous</li>
<li style="margin-bottom:4px;">Vous validez votre inscription en 2 minutes</li>
<li style="margin-bottom:4px;">TotalEnergies vous contacte directement pour la livraison et le paiement</li>
</ul>
<p style="margin:0 0 18px 0;">Rien de plus simple.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;"><tr><td align="center">
<a href="{{lien_pellets}}" style="display:inline-block;background-color:#ea580c;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:6px;">\ud83d\udc49 Je profite de l\u2019offre pellets TotalEnergies</a>
</td></tr></table>
</td></tr>
</table>

<!-- Section 2 : Plan PAC + aides -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px 0;">
<tr><td style="border-left:4px solid #1E4D8C;padding:4px 0 4px 18px;">
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udca1 Le gouvernement veut 1 million de pompes \u00e0 chaleur. Les aides sont l\u00e0. Maintenant.</strong></p>
<p style="margin:0 0 12px 0;">Le plan national PAC est en marche et les dispositifs d\u2019aide n\u2019ont jamais \u00e9t\u00e9 aussi accessibles :</p>
<ul style="margin:0 0 14px 18px;padding:0;">
<li style="margin-bottom:6px;"><strong>MaPrimeR\u00e9nov\u2019</strong> \u2014 jusqu\u2019\u00e0 70\u00a0% du co\u00fbt des travaux selon vos revenus</li>
<li style="margin-bottom:6px;"><strong>CEE</strong> \u2014 une prime suppl\u00e9mentaire financ\u00e9e par les fournisseurs d\u2019\u00e9nergie</li>
<li style="margin-bottom:6px;"><strong>Financement \u00e0 taux z\u00e9ro</strong> \u2014 pour \u00e9taler sans surco\u00fbt</li>
</ul>
<p style="margin:0;">Une pompe \u00e0 chaleur, un po\u00eale \u00e0 bois, une climatisation : aujourd\u2019hui, le reste \u00e0 charge peut \u00eatre proche de z\u00e9ro. On monte le dossier avec vous, de A \u00e0 Z. Vous n\u2019avez rien \u00e0 g\u00e9rer.</p>
</td></tr>
</table>

<!-- Section 3 : Parrainage -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin:0 0 28px 0;">
<tr><td style="padding:22px 24px;">
<p style="margin:0 0 10px 0;font-size:17px;color:#059669;"><strong>\ud83e\udd1d Parrainez \u2014 et on vous offre une palette de pellets</strong></p>
<p style="margin:0 0 12px 0;">Vous connaissez quelqu\u2019un \u2014 un voisin, un ami, un membre de la famille \u2014 qui envisage de passer au chauffage renouvelable ou d\u2019installer une climatisation\u00a0?</p>
<p style="margin:0 0 12px 0;">Parlez-leur de nous. Si votre filleul signe un devis pour l\u2019installation d\u2019un po\u00eale \u00e0 bois, d\u2019une climatisation ou d\u2019une pompe \u00e0 chaleur\u00a0:</p>
<p style="margin:0 0 6px 0;">\u2192 <strong>Vous recevez 1\u00a0palette de pellets offerte</strong> (valeur 385\u00a0\u20ac, livr\u00e9e chez vous)</p>
<p style="margin:0 0 14px 0;">\u2192 <strong>Votre filleul b\u00e9n\u00e9ficie de la mise en service gratuite</strong> (valeur 350\u00a0\u20ac)</p>
<p style="margin:0;font-style:italic;color:#065f46;">Sans limite \u2014 chaque parrainage abouti vous rapporte une palette.</p>
</td></tr>
</table>

<!-- Section 4 : Offre directe client -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin:0 0 28px 0;">
<tr><td style="padding:22px 24px;">
<p style="margin:0 0 10px 0;font-size:17px;color:#1E4D8C;"><strong>\ud83c\udfe0 Vous avez un projet pour vous\u00a0?</strong></p>
<p style="margin:0 0 12px 0;">Pas besoin de parrainer qui que ce soit. Contactez-nous pour votre propre installation et b\u00e9n\u00e9ficiez du package complet :</p>
<p style="margin:0 0 6px 0;">\u2192 <strong>1\u00a0palette de pellets offerte</strong> (valeur 385\u00a0\u20ac)</p>
<p style="margin:0 0 14px 0;">\u2192 <strong>Mise en service gratuite</strong> (valeur 350\u00a0\u20ac)</p>
<p style="margin:0 0 18px 0;">Parce qu\u2019un client qui nous fait confiance m\u00e9rite qu\u2019on lui en donne une raison suppl\u00e9mentaire.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;"><tr><td align="center">
<a href="https://www.mayer-energie.fr/contact?utm_source=emailing&utm_campaign=offre_combustible&utm_medium=email" style="display:inline-block;background-color:#1E4D8C;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:6px;">\ud83d\udc49 Je contacte Mayer \u00c9nergie</a>
</td></tr></table>
<p style="margin:14px 0 0 0;text-align:center;font-size:14px;">\ud83d\udcde <a href="tel:+33563332314" style="color:#1E4D8C;text-decoration:none;"><strong>05\u00a063\u00a033\u00a023\u00a014</strong></a></p>
</td></tr>
</table>

<!-- Mentions l\u00e9gales offres -->
<p style="margin:0 0 18px 0;font-size:12px;color:#666666;font-style:italic;">Offre valable pour tout devis sign\u00e9 avant le 30\u00a0juin\u00a02026. Palette remise \u00e0 la signature du devis parrain\u00e9. Offre pellets TotalEnergies sous r\u00e9serve des conditions en vigueur.</p>

<!-- Signature -->
<p style="margin:20px 0 5px 0;">\u00c0 tr\u00e8s bient\u00f4t,</p>
<p style="margin:0;"><strong>L\u2019\u00e9quipe Mayer \u00c9nergie</strong></p>

</td></tr>
<tr><td style="background-color:#f8f9fa;padding:20px 40px;text-align:center;font-size:13px;color:#666666;border-top:1px solid #e9ecef;">
<p style="margin:0 0 5px 0;">\ud83d\udcde <a href="tel:+33563332314" style="color:#1E4D8C;text-decoration:none;">05 63 33 23 14</a></p>
<p style="margin:0 0 5px 0;">\ud83d\udce7 <a href="mailto:contact@mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">contact@mayer-energie.fr</a></p>
<p style="margin:0 0 5px 0;">\ud83c\udf10 <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">www.mayer-energie.fr</a></p>
<p style="margin:10px 0 0 0;color:#999999;font-size:11px;">\ud83d\udccd 26 Route des Pyr\u00e9n\u00e9es \u2013 81600 Gaillac</p>
<p style="margin:4px 0 0 0;color:#999999;font-size:11px;">\ud83c\udfc5 RGE QualiPAC \u00b7 QualiBois \u00b7 QualiPV</p>
<p style="margin:12px 0 0 0;color:#bbbbbb;font-size:10px;">Si vous ne souhaitez plus recevoir nos communications, <a href="mailto:contact@mayer-energie.fr?subject=D\u00e9sabonnement" style="color:#bbbbbb;text-decoration:underline;">cliquez ici pour vous d\u00e9sabonner</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Mail I — Newsletter (base r\u00e9utilisable)
  // ──────────────────────────────────────────────────────────────────────────
  // Template g\u00e9n\u00e9rique pour les newsletters mensuelles.
  // \u00c9dite le contenu dans les blocs marqu\u00e9s <!-- BLOC X -->, les placeholders
  // [ENTRE CROCHETS] doivent \u00eatre remplac\u00e9s par le contenu r\u00e9el du mois.
  //
  // Structure :
  //   - Intro : phrase d'accroche
  //   - BLOC 1 : Offre du mois (carte orange + CTA)
  //   - BLOC 2 : News / Nouveaut\u00e9 (carte grise + optionnel lien)
  //   - BLOC 3 : Info utile / Conseil \u00e9ditorial (lis\u00e9r\u00e9 bleu)
  //   - BLOC 4 : CTA contact commercial (carte bleue + bouton)
  //
  // Tous les blocs sont optionnels \u2014 supprime ceux que tu n'utilises pas ce mois-ci.
  // Le segment par d\u00e9faut est "Tous les clients", change-le dans l'UI avant envoi.
  mail_i_newsletter: {
    label: 'Mail I — Newsletter (base r\u00e9utilisable)',
    subject: '[OBJET NEWSLETTER — ex: Vos nouveaut\u00e9s Mayer \u00c9nergie de [MOIS]]',
    tracking_type_value: 'newsletter',
    default_segment: 'clients_tous',
    html_body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
<!-- Preheader : texte de preview affich\u00e9 dans l'inbox, ~100 caract\u00e8res max -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">[PREHEADER \u2014 ex: L'offre du mois, une nouveaut\u00e9 et un conseil pour votre confort]</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">

<!-- HEADER : logo Mayer + bande bleue (ne pas modifier) -->
<tr><td style="background-color:#ffffff;padding:30px 40px 0 40px;text-align:center;">
<img src="https://www.mayer-energie.fr/images/logo-email.png" alt="Mayer Energie" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;" />
</td></tr>
<tr><td style="background-color:#1E4D8C;padding:12px 40px;text-align:center;">
<p style="color:#ffffff;margin:0;font-size:14px;">Votre confort, toute l\u2019ann\u00e9e</p>
</td></tr>

<!-- CORPS -->
<tr><td style="padding:30px 40px 10px 40px;color:#333333;font-size:15px;line-height:1.7;text-align:justify;">

<p style="margin:0 0 20px 0;">{{SALUTATION}}</p>

<!-- INTRO : 1 ou 2 phrases d'accroche pour poser le contexte du mois -->
<p style="margin:0 0 28px 0;">[INTRO \u2014 ex: Ce mois-ci chez Mayer \u00c9nergie, on vous partage une offre n\u00e9goci\u00e9e, une nouveaut\u00e9 dans nos services, et un conseil pratique pour votre confort.]</p>

<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- BLOC 1 : OFFRE DU MOIS (carte orange)                                     -->
<!-- Supprime ce bloc enti\u00e8rement si pas d'offre ce mois-ci                    -->
<!-- ════════════════════════════════════════════════════════════════════════ -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:8px;margin:0 0 28px 0;">
<tr><td style="padding:22px 24px;">
<p style="margin:0 0 10px 0;font-size:17px;color:#ea580c;"><strong>\ud83c\udf81 [TITRE DE L\u2019OFFRE DU MOIS]</strong></p>
<p style="margin:0 0 14px 0;">[DESCRIPTION DE L\u2019OFFRE \u2014 2 ou 3 phrases qui expliquent l\u2019avantage concret pour le client. Utilise <strong>texte en gras</strong> pour mettre en valeur les mots-cl\u00e9s.]</p>
<p style="margin:0 0 18px 0;">[\u00c9VENTUEL D\u00c9TAIL \u2014 liste \u00e0 puces, conditions, ou phrase de conclusion avant le CTA.]</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;"><tr><td align="center">
<a href="[URL_CTA_OFFRE]" style="display:inline-block;background-color:#ea580c;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:6px;">\ud83d\udc49 [LIBELL\u00c9 CTA \u2014 ex: J\u2019en profite]</a>
</td></tr></table>
</td></tr>
</table>
<!-- FIN BLOC 1 -->

<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- BLOC 2 : NEWS / NOUVEAUT\u00c9 (carte grise claire)                            -->
<!-- Pour annoncer un nouveau service, un \u00e9v\u00e9nement, un recrutement, etc.      -->
<!-- ════════════════════════════════════════════════════════════════════════ -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8f9fa;border:1px solid #e9ecef;border-radius:8px;margin:0 0 28px 0;">
<tr><td style="padding:22px 24px;">
<p style="margin:0 0 10px 0;font-size:17px;color:#1f2937;"><strong>\ud83c\udd95 [TITRE DE LA NOUVEAUT\u00c9]</strong></p>
<p style="margin:0 0 10px 0;">[DESCRIPTION DE LA NOUVEAUT\u00c9 \u2014 2 ou 3 phrases. Exemple : nouveau technicien dans l\u2019\u00e9quipe, nouvelle prestation propos\u00e9e, nouveau partenariat, etc.]</p>
<p style="margin:0;">[OPTIONNEL : lien <a href="[URL]" style="color:#1E4D8C;">En savoir plus</a> si tu as une page d\u00e9di\u00e9e.]</p>
</td></tr>
</table>
<!-- FIN BLOC 2 -->

<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- BLOC 3 : INFO UTILE / CONSEIL \u00c9DITORIAL (lis\u00e9r\u00e9 bleu \u00e0 gauche)             -->
<!-- Pour un conseil pratique, une info r\u00e9glementaire, un point technique    -->
<!-- ════════════════════════════════════════════════════════════════════════ -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px 0;">
<tr><td style="border-left:4px solid #1E4D8C;padding:4px 0 4px 18px;">
<p style="margin:0 0 10px 0;font-size:16px;"><strong>\ud83d\udca1 [TITRE DU CONSEIL]</strong></p>
<p style="margin:0 0 12px 0;">[INTRO DU CONSEIL \u2014 pose le contexte ou le probl\u00e8me.]</p>
<ul style="margin:0 0 12px 18px;padding:0;">
<li style="margin-bottom:6px;"><strong>[Point 1]</strong> \u2014 [explication courte]</li>
<li style="margin-bottom:6px;"><strong>[Point 2]</strong> \u2014 [explication courte]</li>
<li style="margin-bottom:6px;"><strong>[Point 3]</strong> \u2014 [explication courte]</li>
</ul>
<p style="margin:0;">[CONCLUSION \u2014 1 phrase qui ram\u00e8ne vers l\u2019action ou l\u2019expertise Mayer.]</p>
</td></tr>
</table>
<!-- FIN BLOC 3 -->

<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- BLOC 4 : CTA CONTACT COMMERCIAL (carte bleue)                             -->
<!-- Appel \u00e0 contacter Mayer pour un projet d\u2019installation                    -->
<!-- ════════════════════════════════════════════════════════════════════════ -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin:0 0 28px 0;">
<tr><td style="padding:22px 24px;">
<p style="margin:0 0 10px 0;font-size:17px;color:#1E4D8C;"><strong>\ud83c\udfe0 Un projet en cours\u00a0?</strong></p>
<p style="margin:0 0 18px 0;">[PHRASE D\u2019ACCROCHE \u2014 ex: Pompe \u00e0 chaleur, po\u00eale, climatisation, photovolta\u00efque : contactez-nous pour un devis gratuit et sans engagement. Notre \u00e9quipe vous accompagne de A \u00e0 Z, du montage du dossier d\u2019aides \u00e0 la mise en service.]</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;"><tr><td align="center">
<a href="https://www.mayer-energie.fr/contact?utm_source=emailing&utm_campaign=newsletter&utm_medium=email" style="display:inline-block;background-color:#1E4D8C;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:6px;">\ud83d\udc49 Je contacte Mayer \u00c9nergie</a>
</td></tr></table>
<p style="margin:14px 0 0 0;text-align:center;font-size:14px;">\ud83d\udcde <a href="tel:+33563332314" style="color:#1E4D8C;text-decoration:none;"><strong>05\u00a063\u00a033\u00a023\u00a014</strong></a></p>
</td></tr>
</table>
<!-- FIN BLOC 4 -->

<!-- Signature -->
<p style="margin:20px 0 5px 0;">\u00c0 tr\u00e8s bient\u00f4t,</p>
<p style="margin:0;"><strong>L\u2019\u00e9quipe Mayer \u00c9nergie</strong></p>

</td></tr>

<!-- FOOTER (ne pas modifier) -->
<tr><td style="background-color:#f8f9fa;padding:20px 40px;text-align:center;font-size:13px;color:#666666;border-top:1px solid #e9ecef;">
<p style="margin:0 0 5px 0;">\ud83d\udcde <a href="tel:+33563332314" style="color:#1E4D8C;text-decoration:none;">05 63 33 23 14</a></p>
<p style="margin:0 0 5px 0;">\ud83d\udce7 <a href="mailto:contact@mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">contact@mayer-energie.fr</a></p>
<p style="margin:0 0 5px 0;">\ud83c\udf10 <a href="https://www.mayer-energie.fr" style="color:#1E4D8C;text-decoration:none;">www.mayer-energie.fr</a></p>
<p style="margin:10px 0 0 0;color:#999999;font-size:11px;">\ud83d\udccd 26 Route des Pyr\u00e9n\u00e9es \u2013 81600 Gaillac</p>
<p style="margin:4px 0 0 0;color:#999999;font-size:11px;">\ud83c\udfc5 RGE QualiPAC \u00b7 QualiBois \u00b7 QualiPV</p>
<p style="margin:12px 0 0 0;color:#bbbbbb;font-size:10px;">Si vous ne souhaitez plus recevoir nos communications, <a href="mailto:contact@mayer-energie.fr?subject=D\u00e9sabonnement" style="color:#bbbbbb;text-decoration:underline;">cliquez ici pour vous d\u00e9sabonner</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  },
};

// =============================================================================
// COMPOSANT PRINCIPAL
// =============================================================================

export default function Mailing() {
  const { organization } = useAuth();
  const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_MAILING;

  // State formulaire
  const [campaign, setCampaign] = useState('mail_a');
  const [segment, setSegment] = useState(TEMPLATES.mail_a.default_segment);
  const [subject, setSubject] = useState(TEMPLATES.mail_a.subject);
  const [htmlBody, setHtmlBody] = useState(TEMPLATES.mail_a.html_body);
  const [trackingTypeValue, setTrackingTypeValue] = useState(TEMPLATES.mail_a.tracking_type_value);
  const [testEmail, setTestEmail] = useState('');
  const [batchSize, setBatchSize] = useState(400);

  // SQL généré automatiquement depuis le segment
  const segmentSql = SEGMENTS[segment]?.sql || '';

  // Compteur destinataires
  const [recipientCount, setRecipientCount] = useState(null);
  const [countLoading, setCountLoading] = useState(false);

  useEffect(() => {
    if (!segmentSql) {
      setRecipientCount(null);
      return;
    }
    let cancelled = false;

    // Retirer ORDER BY (inutile pour un COUNT) et le point-virgule final
    const cleanSql = segmentSql.replace(/;?\s*$/, '').replace(/ORDER BY[^)]*$/i, '');
    const countSql = `SELECT COUNT(*) as total FROM (${cleanSql}) sub`;

    setCountLoading(true);
    supabase.rpc('exec_sql', { query_text: countSql })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('Mailing count error:', error);
          setRecipientCount(null);
        } else {
          // exec_sql retourne jsonb : [{"total": 354}]
          const rows = Array.isArray(data) ? data : [];
          setRecipientCount(rows[0]?.total ?? null);
        }
      })
      .catch(() => { if (!cancelled) setRecipientCount(null); })
      .finally(() => { if (!cancelled) setCountLoading(false); });

    return () => { cancelled = true; };
  }, [segmentSql]);

  // State UI
  const [showPreview, setShowPreview] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [showHtml, setShowHtml] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const iframeRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Changement de template
  // ---------------------------------------------------------------------------
  const handleCampaignChange = useCallback((key) => {
    setCampaign(key);
    if (TEMPLATES[key]) {
      setSubject(TEMPLATES[key].subject);
      setHtmlBody(TEMPLATES[key].html_body);
      setSegment(TEMPLATES[key].default_segment);
      setTrackingTypeValue(TEMPLATES[key].tracking_type_value);
    }
    // "new" : on garde les champs vides pour repartir de zero
    setShowPreview(false);
  }, []);

  const handleNewCampaign = useCallback(() => {
    setCampaign('new');
    setSubject('');
    setHtmlBody('');
    setSegment('clients_tous');
    setTrackingTypeValue('');
    setShowPreview(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Construire le payload
  // ---------------------------------------------------------------------------
  const buildPayload = useCallback((isTest = false) => {
    // Ajouter LIMIT au SQL depuis batch_size
    const sql = segmentSql ? `${segmentSql.replace(/;?\s*$/, '')} LIMIT ${batchSize};` : '';
    // Déterminer le type de destinataire (client ou lead) depuis la famille du segment
    const recipientType = SEGMENTS[segment]?.family === 'Leads' ? 'lead' : 'client';
    return {
      subject,
      html_body: htmlBody,
      segment_sql: sql,
      campaign_name: TEMPLATES[campaign]?.label || campaign || 'custom',
      org_id: organization?.id,
      recipient_type: recipientType,
      tracking_column: 'emailing_reprise_sent_at',
      tracking_type_column: 'emailing_reprise_type',
      tracking_type_value: trackingTypeValue,
      batch_size: batchSize,
      ...(isTest && testEmail ? { test_email: testEmail } : {}),
    };
  }, [subject, htmlBody, segmentSql, segment, campaign, organization, trackingTypeValue, batchSize, testEmail]);

  // ---------------------------------------------------------------------------
  // Envoyer au webhook
  // ---------------------------------------------------------------------------
  const sendToWebhook = useCallback(async (isTest = false) => {
    if (!webhookUrl) {
      toast.error('Variable VITE_N8N_WEBHOOK_MAILING non configurée');
      return;
    }
    if (isTest && !testEmail) {
      toast.error('Renseigne un email de test');
      return;
    }

    setSending(true);
    try {
      const payload = buildPayload(isTest);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      let response;
      try {
        response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          // Timeout = normal pour les gros batchs, N8n continue en arrière-plan
          toast.success(
            isTest
              ? `Test envoyé à ${testEmail}`
              : `Campagne lancée ! L'envoi des ${recipientCount ?? batchSize} mails se poursuit en arrière-plan.`
          );
          setShowConfirm(false);
          return;
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      let result = {};
      try {
        const text = await response.text();
        if (text) result = JSON.parse(text);
      } catch {
        // Réponse non-JSON, on continue
      }

      toast.success(
        isTest
          ? `Test envoyé à ${testEmail}`
          : `Campagne lancée ! ${result.message || ''}`
      );
      setShowConfirm(false);
    } catch (err) {
      toast.error(`Erreur : ${err.message}`);
    } finally {
      setSending(false);
    }
  }, [webhookUrl, testEmail, buildPayload]);

  // ---------------------------------------------------------------------------
  // Preview HTML
  // ---------------------------------------------------------------------------
  const handlePreview = useCallback(() => {
    setShowPreview(true);
    setTimeout(() => {
      if (iframeRef.current) {
        const doc = iframeRef.current.contentDocument;
        doc.open();
        doc.write(htmlBody.replace(/\{\{SALUTATION\}\}/g, 'Bonjour Jean Dupont,'));
        doc.close();
      }
    }, 50);
  }, [htmlBody]);

  // ---------------------------------------------------------------------------
  // Copier JSON
  // ---------------------------------------------------------------------------
  const copyJson = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(buildPayload(!!testEmail), null, 2));
    toast.success('JSON copié');
  }, [buildPayload, testEmail]);

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-secondary-900 flex items-center gap-3">
          <Mail className="w-7 h-7 text-primary-600" />
          Mailing
        </h1>
        <p className="text-secondary-500 mt-1">
          Composer et envoyer des campagnes email via le workflow N8N
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ================================================================= */}
        {/* COLONNE GAUCHE : Formulaire                                       */}
        {/* ================================================================= */}
        <div className="space-y-4">

          {/* Campagne + Segment */}
          <div className="card p-4 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              {/* Campagne */}
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-1">
                  Campagne
                </label>
                <div className="flex gap-2">
                  <select
                    value={campaign}
                    onChange={(e) => handleCampaignChange(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    {Object.entries(TEMPLATES).map(([key, tpl]) => (
                      <option key={key} value={key}>{tpl.label}</option>
                    ))}
                    {campaign === 'new' && (
                      <option value="new">Nouvelle campagne</option>
                    )}
                  </select>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleNewCampaign}
                    title="Nouvelle campagne"
                    className="px-2.5 shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Segment ciblage */}
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-1">
                  <Filter className="w-3.5 h-3.5 inline mr-1" />
                  Ciblage
                  {countLoading ? (
                    <Loader2 className="w-3 h-3 inline ml-2 animate-spin text-secondary-400" />
                  ) : recipientCount !== null ? (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700">
                      {recipientCount} destinataire{recipientCount > 1 ? 's' : ''}
                    </span>
                  ) : null}
                </label>
                <select
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                >
                  <optgroup label="Clients">
                    {Object.entries(SEGMENTS).filter(([, s]) => s.family === 'Clients').map(([key, s]) => (
                      <option key={key} value={key}>{s.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Leads">
                    {Object.entries(SEGMENTS).filter(([, s]) => s.family === 'Leads').map(([key, s]) => (
                      <option key={key} value={key}>{s.label}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </div>

            {/* Objet */}
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-1">
                Objet du mail
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                placeholder="Objet du mail..."
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {/* Tracking type */}
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-1">
                  Type de tracking
                </label>
                <input
                  type="text"
                  value={trackingTypeValue}
                  onChange={(e) => setTrackingTypeValue(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  placeholder="contrat / standard / ..."
                />
              </div>

              {/* Batch size */}
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-1">
                  Batch size
                </label>
                <input
                  type="number"
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  min={1}
                  max={1000}
                />
              </div>
            </div>
          </div>

          {/* SQL genere (collapsible, lecture seule) */}
          <div className="card p-4">
            <button
              onClick={() => setShowSql(!showSql)}
              className="flex items-center justify-between w-full text-sm font-medium text-secondary-700"
            >
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                SQL généré — {SEGMENTS[segment]?.label || 'Aucun'}
              </span>
              {showSql ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showSql && (
              <pre className="mt-3 bg-gray-50 rounded-lg p-3 text-xs font-mono text-secondary-600 overflow-auto max-h-48">
                {segmentSql || 'Aucun segment sélectionné'}
              </pre>
            )}
          </div>

          {/* HTML body (collapsible) */}
          <div className="card p-4">
            <button
              onClick={() => setShowHtml(!showHtml)}
              className="flex items-center justify-between w-full text-sm font-medium text-secondary-700"
            >
              <span>Corps HTML</span>
              {showHtml ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showHtml && (
              <textarea
                value={htmlBody}
                onChange={(e) => setHtmlBody(e.target.value)}
                rows={16}
                className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              />
            )}
          </div>

          {/* JSON preview (collapsible) */}
          <div className="card p-4">
            <button
              onClick={() => setShowJson(!showJson)}
              className="flex items-center justify-between w-full text-sm font-medium text-secondary-700"
            >
              <span>Payload JSON</span>
              {showJson ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showJson && (
              <div className="mt-3">
                <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs overflow-auto max-h-64">
                  {JSON.stringify(buildPayload(!!testEmail), null, 2)}
                </pre>
                <Button variant="ghost" size="sm" onClick={copyJson} className="mt-2">
                  <Copy className="w-3.5 h-3.5 mr-1" />
                  Copier JSON
                </Button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="card p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-1">
                Email de test (optionnel)
              </label>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                placeholder="test@exemple.fr"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={handlePreview}>
                <Eye className="w-4 h-4 mr-2" />
                Prévisualiser
              </Button>

              <Button
                variant="secondary"
                onClick={() => sendToWebhook(true)}
                disabled={sending || !testEmail}
              >
                {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FlaskConical className="w-4 h-4 mr-2" />}
                Envoyer test
              </Button>

              <Button
                onClick={() => setShowConfirm(true)}
                disabled={sending}
              >
                <Send className="w-4 h-4 mr-2" />
                Lancer la campagne
              </Button>
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* COLONNE DROITE : Preview                                          */}
        {/* ================================================================= */}
        <div className="card p-0 overflow-hidden">
          {showPreview ? (
            <iframe
              ref={iframeRef}
              title="Preview email"
              className="w-full border-0"
              style={{ minHeight: '700px' }}
            />
          ) : (
            <div className="flex items-center justify-center h-96 text-secondary-400">
              <div className="text-center">
                <Eye className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Clique sur "Prévisualiser" pour voir le rendu</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation modale */}
      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="Lancer la campagne"
        description={`Tu es sur le point d'envoyer la campagne "${TEMPLATES[campaign]?.label || 'Nouvelle campagne'}" au segment "${SEGMENTS[segment]?.label || '?'}" (${recipientCount ?? '?'} destinataires). Cette action est irréversible.`}
        confirmLabel="Lancer l'envoi"
        variant="default"
        onConfirm={() => sendToWebhook(false)}
        loading={sending}
      />
    </div>
  );
}
