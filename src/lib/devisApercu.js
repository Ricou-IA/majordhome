/**
 * devisApercu.js — le devis en cours de saisie, vu comme le client le recevra (module pur).
 * ============================================================================
 * L'éditeur montre un aperçu (ApercuDevis) AVANT « Créer le devis ». Le rendu reste celui
 * du modèle de document unique (buildDevisDocumentModel) : ce module ne fait que bâtir,
 * à partir de la saisie, le `quote` que le modèle attend — client du lead (ou du devis
 * modifié), objet, conditions, remise, date du jour et fin de validité. Un devis pas encore
 * créé n'a pas de numéro : l'aperçu n'en montre pas.
 * Testé : scripts/devis-apercu.test.mjs.
 * ============================================================================
 */

const nomDuLead = (lead) => {
  if (!lead) return '';
  if (lead.client_display_name) return lead.client_display_name;
  return [lead.first_name, lead.last_name].filter(Boolean).join(' ');
};

/**
 * @param {{ lead?: object, form: object, quote?: object|null, aujourdhui?: Date }} p
 *   `quote` = devis modifié (garde son numéro, sa date et son client) ; absent pour un nouveau devis.
 */
export function quoteApercu({ lead, form, quote = null, aujourdhui = new Date() }) {
  const f = form || {};
  const jours = Number.parseInt(f.validityDays, 10);
  const depart = quote?.created_at ? new Date(quote.created_at) : aujourdhui;
  const validite = Number.isFinite(jours) && jours > 0
    ? new Date(depart.getFullYear(), depart.getMonth(), depart.getDate() + jours)
    : null;
  const client = quote || {
    client_display_name: nomDuLead(lead),
    client_address: lead?.address || '',
    client_postal_code: lead?.postal_code || '',
    client_city: lead?.city || '',
    client_phone: lead?.phone || '',
    client_email: lead?.email || '',
  };
  return {
    quote_number: quote?.quote_number || '',
    created_at: depart,
    validity_date: validite,
    subject: f.subject || '',
    conditions: f.conditions || '',
    commentaire: f.commentaire || '',
    global_discount_percent: Number(String(f.globalDiscountPercent ?? 0).replace(',', '.')) || 0,
    client_display_name: client.client_display_name || '',
    client_address: client.client_address || '',
    client_postal_code: client.client_postal_code || '',
    client_city: client.client_city || '',
    client_phone: client.client_phone || '',
    client_email: client.client_email || '',
  };
}
