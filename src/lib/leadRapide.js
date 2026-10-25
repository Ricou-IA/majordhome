// src/lib/leadRapide.js
// Fiche courte du client avant un devis créé depuis le Kanban (« Nouveau devis », demande d'Eric 2026-10-25) —
// module PUR, testé (scripts/lead-rapide.test.mjs). Le lead créé ici est un lead comme les autres : statut
// « Nouveau » posé, filet anti-doublon passé avant (NouveauDevisRapideModal), commercial / source / projet repris.

/** Formulaire vide. `commercial_id` = id de la table commercials (assigned_user_id d'un lead, pont dual-ID). */
export const FORMULAIRE_LEAD_VIDE = Object.freeze({
  first_name: '', last_name: '', phone: '', email: '', address: '', postal_code: '', city: '',
  commercial_id: '', source_id: '', project_family_key: '',
});

const t = (v) => String(v ?? '').trim();
const ouNull = (v) => t(v) || null;

/**
 * Erreurs bloquantes, dans l'ordre d'affichage ; [] = valide.
 * @param {typeof FORMULAIRE_LEAD_VIDE} form
 * @returns {string[]}
 */
export function validerLeadRapide(form) {
  const erreurs = [];
  if (!t(form.last_name)) erreurs.push('Le nom est requis');
  const email = t(form.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erreurs.push('E-mail invalide');
  else if (!t(form.phone) && !email && t(form.last_name)) erreurs.push('Un téléphone ou un e-mail est requis');
  return erreurs;
}

/**
 * Données du lead à créer (leadsService.createLead), champs vides ⇒ null.
 * @param {typeof FORMULAIRE_LEAD_VIDE} form
 * @param {{ statusId: string | null }} p statut « Nouveau » de l'org
 * @returns {Record<string, string | null>}
 */
export function leadDepuisFormulaire(form, { statusId }) {
  return {
    first_name: ouNull(form.first_name),
    last_name: ouNull(form.last_name),
    phone: ouNull(form.phone),
    email: t(form.email) ? t(form.email).toLowerCase() : null,
    address: ouNull(form.address),
    postal_code: ouNull(form.postal_code),
    city: ouNull(form.city),
    status_id: statusId || null,
    assigned_user_id: ouNull(form.commercial_id),
    source_id: ouNull(form.source_id),
    // « Projet » = famille de devis (liste commerciale), pas le référentiel d'équipements d'entretien
    project_family_key: ouNull(form.project_family_key),
  };
}
