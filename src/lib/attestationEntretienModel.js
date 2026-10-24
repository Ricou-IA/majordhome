// src/lib/attestationEntretienModel.js — attestation d'entretien et de ramonage (lettre client)
// Module PUR (aucun import React/Supabase/alias) — testé `node --test scripts/attestation-entretien-model.test.mjs`.
//
// Générée au clic sur « Facturer », une par certificat comportant un ramonage, rangée à côté du
// certificat (`…/{certificat_id}-attestation.pdf`). Tout vient du certificat signé, de la fiche
// client et de l'organisation : rien n'est saisi ici, rien n'est calculé dans le PDF.
//
// Garde-fou (Eric, 2026-10-24) : la phrase « conduit déclaré vacant » n'est écrite que si TOUS
// les conduits sont notés « ramoné » et que le bilan n'est pas « arrêt d'urgence ». Sinon pas
// d'attestation, et la facturation le dit (jamais bloquante).
//
// La facture est citée par sa DATE seulement : au clic, la facture Pennylane n'est qu'un
// brouillon sans numéro, et on ne sait pas si elle est payée (Eric : « sans numéro ni acquittée »).
//
// ⚠️ PDF Helvetica/WinAnsi : pas de caractère hors cp1252 dans les textes produits.

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** @param {string|null|undefined} iso  `YYYY-MM-DD…` @returns {{ long: string, court: string }|null} */
export function formatDateLettre(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const [, y, mo, d] = m;
  const mois = MOIS[Number(mo) - 1];
  if (!mois) return null;
  return { long: `${Number(d)} ${mois} ${y}`, court: `${d}-${mo}-${y}` };
}

/** Liste française : « a », « a et b », « a, b et c ». @param {string[]} items */
export function listeFr(items) {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] || '';
  return `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}`;
}

const minuscule = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const sansCaracteresHorsPdf = (s) => String(s ?? '').replace(/\s/g, ' ').replace(/[−]/g, '-').replace(/[→←]/g, '-');

const METHODES = {
  mecanique: {
    adjectif: 'mécanique',
    phrase: [
      { text: 'L’opération a été effectuée par ' }, { text: 'brossage mécanique', bold: true },
      { text: ' au moyen d’un hérisson de section adaptée, sur la totalité du conduit, depuis le raccordement de l’appareil jusqu’à la sortie en toiture.' },
    ],
  },
  chimique: {
    adjectif: 'chimique',
    phrase: [
      { text: 'L’opération a été effectuée par ' }, { text: 'ramonage chimique', bold: true },
      { text: ', sur la totalité du conduit, depuis le raccordement de l’appareil jusqu’à la sortie en toiture.' },
    ],
  },
  aspiration: {
    adjectif: 'par aspiration',
    phrase: [
      { text: 'L’opération a été effectuée par ' }, { text: 'aspiration', bold: true },
      { text: ', sur la totalité du conduit, depuis le raccordement de l’appareil jusqu’à la sortie en toiture.' },
    ],
  },
};

/** Motifs pour lesquels aucune attestation n'est produite. `silencieux` : rien à signaler (pas un ramonage). */
export const MOTIFS = {
  pas_de_ramonage: { silencieux: true, message: 'Pas de ramonage sur ce certificat' },
  conduit_obstrue: { silencieux: false, message: 'Conduit noté obstrué : vacuité non attestable' },
  arret_urgence: { silencieux: false, message: 'Bilan « arrêt d’urgence » : appareil non apte à l’usage' },
  certificat_non_signe: { silencieux: false, message: 'Certificat non signé' },
  signataire_manquant: { silencieux: false, message: 'Signataire non renseigné (Organisation → Identité)' },
  date_manquante: { silencieux: false, message: 'Date d’intervention absente du certificat' },
};

/**
 * Éligibilité d'un certificat à l'attestation.
 * @param {{ statut?: string, bilan_conformite?: string, date_intervention?: string, donnees_ramonage?: { conduits?: { resultat?: string }[] } }} certificat
 * @param {{ showRamonage: boolean }} sections  sections du profil de certificat de la catégorie
 * @param {{ signatoryName?: string }} company
 * @returns {{ eligible: true } | { eligible: false, motif: keyof typeof MOTIFS }}
 */
export function eligibiliteAttestation(certificat, sections, company) {
  const conduits = (certificat?.donnees_ramonage?.conduits || []).filter((c) => c && c.resultat !== 'na');
  if (!sections?.showRamonage || conduits.length === 0) return { eligible: false, motif: 'pas_de_ramonage' };
  if (certificat.statut !== 'signe' && certificat.statut !== 'envoye') return { eligible: false, motif: 'certificat_non_signe' };
  if (certificat.bilan_conformite === 'arret_urgence') return { eligible: false, motif: 'arret_urgence' };
  if (conduits.some((c) => c.resultat !== 'ramone')) return { eligible: false, motif: 'conduit_obstrue' };
  if (!company?.signatoryName?.trim()) return { eligible: false, motif: 'signataire_manquant' };
  if (!formatDateLettre(certificat.date_intervention)) return { eligible: false, motif: 'date_manquante' };
  return { eligible: true };
}

/**
 * Lettre d'attestation, prête à être mise en page (le PDF n'ajoute rien).
 *
 * @param {object} p
 * @param {object} p.certificat  ligne `majordhome_certificats`
 * @param {{ showRamonage: boolean }} p.sections
 * @param {{ key: string, label: string }[]} p.nettoyageItems  items de nettoyage du profil
 * @param {{ key: string, label: string }[]} p.controleItems   contrôles de sécurité
 * @param {string} p.appareil  libellé de la catégorie d'équipement (ex. « Poêle à granulés »)
 * @param {{ name: string, address?: string, postal_code?: string, city?: string }} p.client
 * @param {object} p.company   buildCompanyInfo(settings)
 * @param {string} p.invoiceDate  date de la facture `YYYY-MM-DD`
 * @returns {{ eligible: false, motif: string } | { eligible: true, lettre: object }}
 */
export function buildAttestationEntretien({ certificat, sections, nettoyageItems = [], controleItems = [], appareil, client, company, invoiceDate }) {
  const elig = eligibiliteAttestation(certificat, sections, company);
  if (!elig.eligible) return elig;

  const dateIntervention = formatDateLettre(certificat.date_intervention);
  const dateFacture = formatDateLettre(invoiceDate);
  const ramonage = certificat.donnees_ramonage || {};
  const conduits = (ramonage.conduits || []).filter((c) => c && c.resultat === 'ramone');
  const pluriel = conduits.length > 1;
  const methode = METHODES[ramonage.methode] || null;

  const adresseSiege = [company.address, [company.postalCode, (company.city || '').toUpperCase()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const adresseClient = [client.address, [client.postal_code, (client.city || '').toUpperCase()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const nomSociete = (company.legalName || company.name || '').toUpperCase();
  const rge = company.rgeCertifications || [];

  const p1 = [
    { text: 'Je soussigné, ' }, { text: company.signatoryName, bold: true },
    { text: company.signatoryRole ? ` agissant en qualité de ${company.signatoryRole} de la société ${nomSociete}` : ` agissant pour le compte de la société ${nomSociete}` },
    { text: adresseSiege ? `, dont le siège social est situé ${adresseSiege}` : '' },
    { text: company.rcs ? `, immatriculée sous le n° ${company.rcs}` : '' },
    { text: rge.length ? `, titulaire ${rge.length > 1 ? 'des qualifications' : 'de la qualification'} RGE ${listeFr(rge)}` : '' },
    { text: ',' },
  ];

  const marque = certificat.equipement_marque ? ` de marque ${certificat.equipement_marque.toUpperCase()}` : '';
  const p2 = [
    { text: `Atteste par la présente être intervenu le ${dateIntervention.long} au domicile de : ${client.name}${adresseClient ? `, ${adresseClient}` : ''}, dans le cadre de l’entretien annuel de son ` },
    { text: `${minuscule(appareil || 'appareil de chauffage')}${marque}`, bold: true },
    { text: ` et du ramonage${methode ? ` ${methode.adjectif}` : ''} ${pluriel ? 'des conduits de fumée raccordés' : 'du conduit de fumée raccordé'} à cet appareil.` },
  ];

  const nettoyage = certificat.donnees_entretien?.nettoyage || {};
  const controles = certificat.donnees_entretien?.controles_securite || {};
  const nettoyes = nettoyageItems.filter((i) => nettoyage[i.key] === 'conforme').map((i) => minuscule(i.label));
  const controlesOk = controleItems.filter((i) => controles[i.key] === 'conforme').map((i) => minuscule(i.label));
  const p3 = [{ text: 'L’entretien annuel de l’appareil a comporté ' }];
  if (nettoyes.length) p3.push({ text: 'le nettoyage : ' }, { text: listeFr(nettoyes), bold: true });
  if (controlesOk.length) p3.push({ text: `${nettoyes.length ? ', ' : ''}le contrôle : ${listeFr(controlesOk)}` });
  p3.push({ text: `${nettoyes.length || controlesOk.length ? ', ainsi que ' : ''}la vérification du bon fonctionnement général de l’appareil.` });

  const p4 = methode
    ? methode.phrase
    : [{ text: `L’opération a été effectuée${ramonage.methode_autre ? ` (${ramonage.methode_autre})` : ''} sur la totalité du conduit, depuis le raccordement de l’appareil jusqu’à la sortie en toiture.` }];

  const p5 = [
    { text: 'À l’issue de l’opération, le ' }, { text: 'test de vacuité', bold: true },
    { text: pluriel ? ' a été réalisé avec succès : les conduits sont déclarés ' : ' a été réalisé avec succès : le conduit est déclaré ' },
    { text: pluriel ? 'vacants sur toute leur longueur' : 'vacant sur toute sa longueur', bold: true },
    { text: ' et apte' + (pluriel ? 's' : '') + ' à un usage normal en sécurité.' },
  ];

  const p6 = [{
    text: `La présente attestation est délivrée à l’intéressé(e) pour servir et valoir ce que de droit.${dateFacture ? ` Elle se rapporte à la facture du ${dateFacture.long}.` : ''}`,
  }];

  const clean = (segments) => segments.filter((s) => s.text).map((s) => ({ ...s, text: sansCaracteresHorsPdf(s.text) }));
  const ville = company.city || '';
  const dateLettre = dateFacture || dateIntervention;

  return {
    eligible: true,
    lettre: {
      lieuDate: `${ville ? `${ville}, le ` : 'Le '}${dateLettre.long}`,
      destinataire: [client.name, client.address, [client.postal_code, (client.city || '').toUpperCase()].filter(Boolean).join(' ')].filter(Boolean),
      objet: 'ATTESTATION D’ENTRETIEN ET DE RAMONAGE',
      references: 'Établie en application du décret n° 2023-641 du 20 juillet 2023 et de l’arrêté du 20 juillet 2023, articles R. 1331-14 à R. 1331-21 du Code de la santé publique.',
      salutation: 'Madame, Monsieur,',
      paragraphes: [p1, p2, p3, p4, p5, p6].map(clean),
      faitA: `Fait à ${ville || '..........'}, le ${dateLettre.court}`,
      signataire: { entreprise: nomSociete, nom: company.signatoryName, fonction: company.signatoryRole || '' },
    },
  };
}

/** Chemin de l'attestation : à côté du PDF du certificat. @param {string|null} pdfStoragePath */
export function attestationPathFor(pdfStoragePath) {
  if (!pdfStoragePath || !/\.pdf$/i.test(pdfStoragePath)) return null;
  return pdfStoragePath.replace(/\.pdf$/i, '-attestation.pdf');
}
