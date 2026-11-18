// src/lib/certificatConformeModel.js — certificat « Conforme » allégé, posé par le bureau
// Module PUR (aucun import React/Supabase/alias) — testé `node --test scripts/certificat-conforme-model.test.mjs`.
// Spec : docs/superpowers/specs/2026-11-16-certificat-conforme-allege-design.md
//
// Quand le technicien n'a pas rempli le certificat sur place, le bureau pose un certificat allégé :
// « on est passé, rien d'anormal ». C'est une ligne `certificats` comme les autres (`mode = 'allege'`,
// finalisée, sans signature du client), donc Facturer, l'attestation de ramonage et l'e-mail la
// trouvent sans rien apprendre de nouveau. Le document est une lettre de la même forme que
// l'attestation (`buildAttestationEntretien().lettre`) : même gabarit PDF, qui ne calcule rien.
//
// ⚠️ PDF Helvetica/WinAnsi : pas de caractère hors cp1252 dans les textes produits.

import {
  formatDateLettre, marqueModele, paragraphesRamonage, ARTICLE_ATTESTATION_RAMONAGE,
} from './attestationEntretienModel.js';

export const MODE_ALLEGE = 'allege';

/** @param {{ mode?: string }|null|undefined} certificat */
export function estAllege(certificat) {
  return certificat?.mode === MODE_ALLEGE;
}

/**
 * Date de passage proposée : celle du RDV, jamais dans le futur (la base refuse une visite future),
 * aujourd'hui à défaut.
 * @param {string|null|undefined} scheduledDate
 * @param {string} today `YYYY-MM-DD`
 * @returns {string} `YYYY-MM-DD`
 */
export function dateDePassage(scheduledDate, today) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(scheduledDate || ''));
  if (!m) return today;
  return m[1] > today ? today : m[1];
}

const signeOuEnvoye = (c) => c?.statut === 'signe' || c?.statut === 'envoye';

/**
 * Ce qui interdit de poser « Conforme » sur une ligne qui a déjà un certificat. Un brouillon
 * conforme se remplace ; un brouillon où le technicien a noté une anomalie, jamais.
 * @param {object|null|undefined} existant  ligne `majordhome_certificats` de la ligne d'équipement
 * @returns {string|null} message à afficher, `null` si rien ne s'y oppose
 */
export function blocageConforme(existant) {
  if (!existant || estAllege(existant)) return null;
  if (signeOuEnvoye(existant)) return 'Un certificat complet est déjà signé pour cet équipement.';
  const anomalie = (existant.bilan_conformite && existant.bilan_conformite !== 'conforme')
    || String(existant.anomalies_detail || '').trim() !== '';
  if (anomalie) return 'Le technicien a commencé un certificat qui note une anomalie : ouvrez-le avec « Remplir ».';
  return null;
}

/** Un brouillon complet existe et sera remplacé : à dire avant de confirmer. */
export function brouillonRemplace(existant) {
  return !!existant && !estAllege(existant) && !signeOuEnvoye(existant);
}

const texteOuNull = (s) => {
  const t = String(s ?? '').trim();
  return t === '' ? null : t;
};

/**
 * Ligne `certificats` du certificat allégé, prête pour l'upsert (une par ligne d'équipement).
 * Finalisée (`statut = 'signe'`) sans signature du client. Ramonage coché ⇒ un conduit noté
 * « ramoné », méthode MÉCANIQUE : c'est ce que la case dit (« Ramonage mécanique effectué »), et
 * c'est la définition légale du ramonage (R. 1331-70 : action mécanique directe sur la paroi). Le
 * certificat vaut alors attestation de ramonage (R. 1331-75) — vécu AMAR 2026-11-18 : la lettre
 * disait seulement « a été ramoné », la cliente a réclamé méthode, conduit et vacuité.
 *
 * @param {object} p
 * @param {string} p.interventionId  intervention enfant (ligne d'équipement)
 * @param {{ code: string, marque?: string, modele?: string, numeroSerie?: string }} p.equipement  `code` = code de catégorie
 * @param {number|null} [p.tvaTaux]  absent ⇒ défaut de la base
 * @param {{ id?: string|null, nom?: string }} p.technicien
 * @param {string} p.date  `YYYY-MM-DD`
 * @param {boolean} p.ramonage
 * @returns {object}
 */
export function certificatAllegePayload({
  interventionId, clientId, equipmentId = null, contractId = null, orgId, userId = null,
  equipement, tvaTaux = null, technicien = {}, date, ramonage = false,
}) {
  const payload = {
    intervention_id: interventionId,
    client_id: clientId,
    equipment_id: equipmentId || null,
    contract_id: contractId || null,
    org_id: orgId,
    created_by: userId || null,
    mode: MODE_ALLEGE,
    statut: 'signe',
    type_document: ramonage ? 'entretien_ramonage' : 'entretien',
    equipement_type: equipement.code,
    equipement_marque: texteOuNull(equipement.marque),
    equipement_modele: texteOuNull(equipement.modele),
    equipement_numero_serie: texteOuNull(equipement.numeroSerie),
    donnees_entretien: {},
    donnees_ramonage: ramonage
      ? { methode: 'mecanique', conduits: [{ label: 'Conduit de fumée', resultat: 'ramone' }] }
      : null,
    mesures: {},
    pieces_remplacees: [],
    bilan_conformite: 'conforme',
    anomalies_detail: null,
    action_corrective: null,
    recommandations: null,
    technicien_id: technicien.id || null,
    technicien_nom: String(technicien.nom || '').trim(),
    date_intervention: date,
    signature_client_base64: null,
    signature_client_nom: null,
    signed_at: null,
    pdf_storage_path: null,
    pdf_url: null,
    pdf_generated_at: null,
  };
  if (tvaTaux != null) payload.tva_taux = tvaTaux;
  return payload;
}

const minuscule = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const pdfSafe = (s) => String(s ?? '').replace(/\s/g, ' ').replace(/[−]/g, '-').replace(/[→←]/g, '-');

/**
 * Lettre du certificat allégé, prête à être mise en page par `AttestationEntretienPDF`.
 *
 * @param {object} p
 * @param {object} p.certificat  ligne `majordhome_certificats` (référence, date, technicien, équipement, ramonage)
 * @param {string|null} [p.appareil]  libellé de la catégorie (ex. « Poêle à granulés »)
 * @param {string|null} [p.contractNumber]
 * @param {{ name: string, address?: string, postal_code?: string, city?: string }} p.client
 * @param {object} p.company  buildCompanyInfo(settings)
 * @param {string} p.dateEdition  `YYYY-MM-DD`
 * @returns {{ lettre: object }}
 */
export function buildCertificatConforme({ certificat, appareil = null, contractNumber = null, client, company, dateEdition }) {
  const datePassage = formatDateLettre(certificat.date_intervention);
  const dateLettre = formatDateLettre(dateEdition) || datePassage;
  const cpVille = [client.postal_code, (client.city || '').toUpperCase()].filter(Boolean).join(' ');
  const adresseClient = [client.address, cpVille].filter(Boolean).join(', ');

  const appareilTexte = `${minuscule(appareil || 'appareil de chauffage')}${marqueModele(certificat)}`;
  const ramone = (certificat.donnees_ramonage?.conduits || []).some((c) => c?.resultat === 'ramone');

  const paragraphes = [
    [
      { text: `Nous attestons être intervenus${datePassage ? ` le ${datePassage.long}` : ''} au domicile de ${client.name}${adresseClient ? `, ${adresseClient},` : ''} pour l’entretien annuel de son ` },
      { text: appareilTexte, bold: true },
      { text: ramone ? ' et le ramonage du conduit de fumée qui lui est raccordé.' : '.' },
    ],
    [
      { text: 'Aucune anomalie n’a été relevée', bold: true },
      { text: ' lors de cette intervention. L’installation est conforme et apte à un usage normal.' },
    ],
    ...(ramone ? paragraphesRamonage(certificat.donnees_ramonage, appareilTexte) : []),
    [{
      text: ramone
        ? `Le présent document vaut certificat d’entretien et attestation de ramonage au sens de l’${ARTICLE_ATTESTATION_RAMONAGE}. Il est délivré pour servir et valoir ce que de droit.`
        : 'Le présent certificat est délivré pour servir et valoir ce que de droit.',
    }],
  ];

  const ville = company.city || '';
  return {
    lettre: {
      lieuDate: pdfSafe(dateLettre ? `${ville ? `${ville}, le ` : 'Le '}${dateLettre.long}` : ville),
      destinataire: [client.name, client.address, cpVille].filter(Boolean).map(pdfSafe),
      objet: ramone ? 'CERTIFICAT D’ENTRETIEN ET ATTESTATION DE RAMONAGE' : 'CERTIFICAT D’ENTRETIEN',
      references: pdfSafe([
        certificat.reference ? `Référence ${certificat.reference}` : '',
        contractNumber ? `Contrat ${contractNumber}` : '',
      ].filter(Boolean).join(' - ')),
      salutation: 'Madame, Monsieur,',
      paragraphes: paragraphes.map((p) => p.filter((s) => s.text).map((s) => ({ ...s, text: pdfSafe(s.text) }))),
      faitA: pdfSafe(dateLettre ? `Fait${ville ? ` à ${ville},` : ''} le ${dateLettre.court}` : ''),
      signataire: {
        entreprise: pdfSafe((company.legalName || company.name || '').toUpperCase()),
        nom: pdfSafe(company.signatoryName || ''),
        fonction: pdfSafe(company.signatoryRole || ''),
      },
    },
  };
}

/**
 * « Annuler » un certificat allégé : tant que la carte n'est pas facturée. Après, le document a pu
 * partir chez le client avec sa facture.
 * @param {{ workflow_status?: string, invoice_id?: string|null, invoiced_at?: string|null }|null|undefined} carte
 */
export function peutAnnulerConforme(carte) {
  if (!carte) return false;
  return carte.workflow_status !== 'facture' && !carte.invoice_id && !carte.invoiced_at;
}
