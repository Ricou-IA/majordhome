// src/lib/certificatAnomalies.js
// ============================================================================
// Anomalie constatée sur le certificat d'entretien — module PUR (spec
// 2026-10-10-anomalie-certificat-sav-facture-commentaire-devis-design.md).
// La SOURCE reste le certificat (`bilan_conformite`, `anomalies_detail`,
// `action_corrective`) ; la vue `majordhome_entretien_sav` l'agrège en
// `anomalies` (jsonb) pour la carte et la fiche de synthèse. Ici : libellés
// (source unique, importés par StepBilan), normalisation pour la carte,
// déclencheur de la demande SAV et textes (description SAV, information
// client imprimée sur la facture). Aucun import React / Supabase ; textes
// PDF-safe (espaces ordinaires, apostrophe typographique = cp1252).
// Testé par scripts/certificat-anomalies.test.mjs (audit:quality).
// ============================================================================

/** Actions correctives du bilan — source unique des codes et libellés. */
export const ACTIONS_CORRECTIVES = Object.freeze([
  Object.freeze({ value: 'sur_place', label: 'Corrigée sur place' }),
  Object.freeze({ value: 'devis', label: 'Devis à établir' }),
  Object.freeze({ value: 'arret_urgence', label: "Arrêt d'urgence" }),
]);

const BILANS = Object.freeze({ conforme: 'Conforme', anomalie: 'Anomalie', arret_urgence: "Arrêt d'urgence" });
const BILANS_NON_CONFORMES = new Set(['anomalie', 'arret_urgence']);

/** Suite donnée, telle qu'on l'écrit au client. */
const SUITE_CLIENT = Object.freeze({
  devis: 'Un devis vous sera adressé.',
  sur_place: 'Corrigé sur place.',
  arret_urgence: 'Installation mise à l’arrêt par sécurité.',
});

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** @param {string} code  @returns {string} libellé, '' si inconnu */
export function libelleAction(code) {
  return ACTIONS_CORRECTIVES.find((a) => a.value === code)?.label || '';
}

function texte(v) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

/** « 7 octobre 2026 » depuis une date ISO ; '' si absente ou invalide (sans dépendre de la locale Node). */
function dateLongue(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const jour = Number(m[3]);
  const mois = MOIS[Number(m[2]) - 1];
  if (!jour || !mois) return '';
  return `${jour} ${mois} ${m[1]}`;
}

/** Détail sans point final (on le remet nous-mêmes). */
function detailPropre(v) {
  return texte(v).replace(/[.\s]+$/, '');
}

/**
 * Anomalies d'une carte Entretien / SAV, depuis `item.anomalies` (jsonb de la vue, ou sa chaîne).
 * Ne garde que les bilans non conformes, triées par date de certificat croissante.
 * @param {{ anomalies?: unknown }} item
 * @returns {Array<{ certificatId: string, interventionId: string|null, equipmentId: string|null, equipement: string, equipementType: string|null, bilan: string, bilanLabel: string, detail: string, action: string|null, actionLabel: string, date: string|null, savId: string|null }>}
 */
export function anomaliesDeCarte(item) {
  let raw = item?.anomalies;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && BILANS_NON_CONFORMES.has(a.bilan))
    .map((a) => ({
      certificatId: a.certificat_id,
      interventionId: a.intervention_id || null,
      equipmentId: a.equipment_id || null,
      equipement: texte(a.equipement),
      equipementType: a.equipement_type || null,
      bilan: a.bilan,
      bilanLabel: BILANS[a.bilan] || '',
      detail: texte(a.detail),
      action: a.action || null,
      actionLabel: libelleAction(a.action),
      date: a.date || null,
      savId: a.sav_id || null,
    }))
    .sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')));
}

/**
 * Faut-il ouvrir une demande SAV pour ce certificat ? Décision Eric 2026-10-10 : seule l'action
 * « Devis à établir » sur un bilan non conforme en ouvre une (« Arrêt d'urgence » non, pour l'instant).
 * @param {{ bilan_conformite?: string, action_corrective?: string }|null} cert
 */
export function doitCreerSav(cert) {
  if (!cert) return false;
  return cert.action_corrective === 'devis' && BILANS_NON_CONFORMES.has(cert.bilan_conformite);
}

/**
 * Description de la demande SAV ouverte depuis un certificat (colonne `sav_description`).
 * @param {{ date_intervention?: string, equipement_marque?: string, equipement_modele?: string, anomalies_detail?: string, action_corrective?: string }} cert
 * @param {{ equipementLabel?: string }} [opts]  libellé de repli quand marque/modèle manquent (ex. catégorie)
 */
export function descriptionSavDepuisCertificat(cert, { equipementLabel = '' } = {}) {
  const c = cert || {};
  const quand = dateLongue(c.date_intervention);
  const equipement = texte([c.equipement_marque, c.equipement_modele].filter(Boolean).join(' ')) || texte(equipementLabel);
  const tete = `Suite à l’entretien${quand ? ` du ${quand}` : ''}${equipement ? ` (${equipement})` : ''}`;
  const detail = detailPropre(c.anomalies_detail) || 'anomalie constatée';
  const action = libelleAction(c.action_corrective);
  return `${tete} : ${detail}.${action ? ` ${action}.` : ''}`;
}

/**
 * Information client pré-remplie sur la facture d'entretien : une ligne par anomalie, l'équipement
 * n'est cité que s'il y en a plusieurs. Chaîne vide sans anomalie.
 * @param {ReturnType<typeof anomaliesDeCarte>|null} anomalies
 */
export function noteClientDepuisAnomalies(anomalies) {
  const liste = Array.isArray(anomalies) ? anomalies.filter((a) => a && (a.detail || a.action)) : [];
  if (!liste.length) return '';
  const plusieurs = liste.length > 1;
  return liste.map((a) => {
    const ou = plusieurs && a.equipement ? ` (${a.equipement})` : '';
    const detail = detailPropre(a.detail) || 'anomalie';
    const suite = SUITE_CLIENT[a.action] || '';
    return `Constaté lors de l’entretien${ou} : ${detail}.${suite ? ` ${suite}` : ''}`;
  }).join('\n');
}
