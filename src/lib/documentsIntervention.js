// ============================================================================
// documentsIntervention.js — les documents qu'un chantier ou une intervention a produits
// (onglet Interventions de la fiche client). Règles PURES : on ne liste que ce qui
// EXISTE — un PV signé, un certificat avec son PDF, un rapport archivé — jamais un
// document à venir. Testé : scripts/documents-intervention.test.mjs
// ============================================================================

import { rapportDeCarte } from './rapportSav.js';

const STATUTS_RECEPTIONNE = ['realise', 'facture'];

/**
 * Documents d'un chantier : le PV de réception, puis le PV de levée des réserves.
 * « PV signé » = un fichier archivé (signé sur tablette, ou déjà produit) OU une
 * signature en ligne : jamais le chemin seul.
 * @param {Object|null|undefined} chantier ligne de `majordhome_chantiers`
 * @returns {{ cle: 'pv_reception'|'pv_levee', libelle: string, signeLe: string|null, enLigne: boolean, avecReserves?: boolean }[]}
 */
export function documentsDeChantier(chantier) {
  const c = chantier || {};
  const documents = [];
  if (c.pv_reception_path || c.pv_signed_at) {
    documents.push({
      cle: 'pv_reception',
      libelle: 'PV de réception',
      signeLe: c.pv_signed_at || null,
      enLigne: Boolean(c.pv_signed_at),
      avecReserves: Boolean(c.pv_avec_reserves),
    });
  }
  if (c.pv_levee_path || c.pv_reserves_levees_at) {
    documents.push({
      cle: 'pv_levee',
      libelle: 'PV de levée des réserves',
      signeLe: c.pv_reserves_levees_at || null,
      enLigne: Boolean(c.pv_reserves_levees_at),
    });
  }
  return documents;
}

/** Chantier réceptionné (ou facturé) sans aucun PV : réception validée sans document. */
export function receptionneSansPv(chantier) {
  return STATUTS_RECEPTIONNE.includes(chantier?.chantier_status) && documentsDeChantier(chantier).length === 0;
}

/**
 * Certificats rangés par intervention. S'il y en a plusieurs pour la même, celui qui a
 * son PDF passe devant (un brouillon n'est pas un document).
 * @param {{ intervention_id: string, pdf_storage_path?: string|null }[]|null|undefined} certificats
 * @returns {Map<string, Object>}
 */
export function certificatsParIntervention(certificats) {
  const index = new Map();
  for (const c of certificats || []) {
    if (!c?.intervention_id) continue;
    const deja = index.get(c.intervention_id);
    if (!deja || (!deja.pdf_storage_path && c.pdf_storage_path)) index.set(c.intervention_id, c);
  }
  return index;
}

/**
 * Documents d'une carte Entretien / SAV : son certificat (s'il a un PDF) et son rapport
 * d'intervention SAV (s'il est archivé). L'attestation de ramonage a son propre lien.
 * @param {Object|null|undefined} intervention ligne de `majordhome_interventions`
 * @param {{ pdf_storage_path?: string|null, mode?: string|null }|null|undefined} certificat
 * @returns {{ cle: 'certificat'|'rapport_sav', libelle: string, chemin: string, depot: 'certificats'|'interventions' }[]}
 */
export function documentsDeCarte(intervention, certificat) {
  const documents = [];
  if (certificat?.pdf_storage_path) {
    documents.push({
      cle: 'certificat',
      libelle: certificat.mode === 'allege' ? 'Certificat d’entretien (lettre)' : 'Certificat d’entretien',
      chemin: certificat.pdf_storage_path,
      depot: 'certificats',
    });
  }
  const rapport = rapportDeCarte(intervention);
  if (rapport) {
    documents.push({ cle: 'rapport_sav', libelle: 'Rapport d’intervention', chemin: rapport.path, depot: 'interventions' });
  }
  return documents;
}
