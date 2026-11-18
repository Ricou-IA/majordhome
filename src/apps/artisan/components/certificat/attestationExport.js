// src/apps/artisan/components/certificat/attestationExport.js
// Point d'entrée UNIQUE de la génération des attestations d'entretien et de ramonage d'une
// intervention (appelé au clic sur « Facturer », les deux modes de facturation). Une attestation
// par certificat éligible (cf. eligibiliteAttestation), rangée à côté du certificat.
// Jamais bloquant : la facture est déjà créée quand on arrive ici ; ce qui n'a pas pu être
// produit est RENVOYÉ (motif lisible) pour être dit à l'utilisateur, jamais avalé.
import { certificatsService } from '@services/certificats.service';
import { storageService } from '@services/storage.service';
import { buildAttestationEntretien, attestationPathFor, MOTIFS } from '@/lib/attestationEntretienModel';
import { CONTROLES_SECURITE_ITEMS, getNettoyageItems, sectionsPourProfil } from './constants';
import { generateAttestationPdfBlob } from './AttestationEntretienPDF';

const SIGNATURE_BUCKET = 'product-documents';

async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

async function fetchAsDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await blobToDataUrl(await res.blob());
  } catch {
    return null;
  }
}

/**
 * Logo et signature du signataire en data URL, pour une lettre à l'en-tête de l'entreprise
 * (attestation de ramonage, certificat allégé). Jamais bloquant : ce qui manque est renvoyé
 * dans `warnings`, le document sort sans.
 * @param {object} company  buildCompanyInfo(settings)
 * @returns {Promise<{ logoSrc: string|null, signatureSrc: string|null, warnings: string[] }>}
 */
export async function chargerVisuelsLettre(company) {
  const visuels = { logoSrc: null, signatureSrc: null, warnings: [] };
  if (company.logoUrl) {
    visuels.logoSrc = await fetchAsDataUrl(company.logoUrl);
    if (!visuels.logoSrc) visuels.warnings.push('Logo illisible : document édité sans logo.');
  }
  if (company.signatorySignaturePath) {
    const { url } = await storageService.getSignedUrl(SIGNATURE_BUCKET, company.signatorySignaturePath);
    visuels.signatureSrc = url ? await fetchAsDataUrl(url) : null;
    if (!visuels.signatureSrc) visuels.warnings.push('Signature illisible : document édité sans signature.');
  } else {
    visuels.warnings.push('Aucune signature dans Organisation → Identité : document édité sans signature.');
  }
  return visuels;
}

/**
 * @param {object} p
 * @param {string} p.orgId  org core
 * @param {string} p.interventionId  carte d'entretien (racine ; les certificats des enfants sont inclus)
 * @param {{ name: string, address?: string, postal_code?: string, city?: string }} p.client
 * @param {object} p.company  buildCompanyInfo(settings)
 * @param {Array<{ code: string, label: string, certificate_profile?: string }>} p.categories
 * @param {string} p.invoiceDate  `YYYY-MM-DD`
 * @param {{ rendrePdf?: (p: object) => Promise<Blob|Uint8Array>, archiver?: (path: string, pdf: Blob|Uint8Array) => Promise<{ error?: { message: string }|null }> }} [p.deps]
 *   rendu et archivage, remplaçables par un script Node (rattrapage `scripts/certificats/regenerer-attestations.mjs` :
 *   `pdf().toBlob()` n'existe pas hors navigateur). L'app ne les passe jamais.
 * @returns {Promise<{ generated: { certificatId: string, path: string }[], skipped: { certificatId: string|null, message: string }[], warnings: string[] }>}
 */
export async function genererAttestationsIntervention({ orgId, interventionId, client, company, categories = [], invoiceDate, deps = {} }) {
  const rendrePdf = deps.rendrePdf || generateAttestationPdfBlob;
  const archiver = deps.archiver || ((path, blob) => certificatsService.uploadAttestation(path, blob));
  const result = { generated: [], skipped: [], warnings: [] };
  const { data: certificats, error } = await certificatsService.listForInterventionTree(orgId, interventionId);
  if (error) throw new Error(`Certificats illisibles : ${error.message}`);

  // Équipement sans certificat rempli (intervention enfant sans certificat) : l'attestation part
  // du certificat signé, il n'y en a donc pas pour lui — à dire, pas à taire (vécu VERMONT
  // 2026-10-24 : carte « Réalisé » dont le certificat du poêle n'avait jamais été rempli).
  const { data: children, error: childErr } = await certificatsService.listChildInterventions(interventionId);
  if (childErr) throw new Error(`Interventions illisibles : ${childErr.message}`);
  const withCert = new Set((certificats || []).map((c) => c.intervention_id));
  const sansCertificat = (children || []).filter((c) => c.equipment_id && !withCert.has(c.id)).length;
  if (sansCertificat > 0) {
    result.skipped.push({
      certificatId: null,
      message: sansCertificat > 1
        ? `${sansCertificat} équipements sans certificat rempli : remplissez-les pour obtenir leur attestation`
        : 'Un équipement n’a pas de certificat rempli : remplissez-le pour obtenir son attestation',
    });
  }
  if (!certificats?.length && sansCertificat === 0) {
    result.skipped.push({ certificatId: null, message: 'Aucun certificat rempli sur cet entretien' });
  }

  const byCode = new Map(categories.map((c) => [c.code, c]));
  let assets = null;
  const loadAssets = async () => {
    if (assets) return assets;
    assets = await chargerVisuelsLettre(company);
    result.warnings.push(...assets.warnings);
    return assets;
  };

  for (const certificat of certificats || []) {
    const categorie = byCode.get(certificat.equipement_type);
    const profil = categorie?.certificate_profile || 'generique';
    const model = buildAttestationEntretien({
      certificat,
      sections: sectionsPourProfil(profil),
      nettoyageItems: getNettoyageItems(profil),
      controleItems: CONTROLES_SECURITE_ITEMS,
      appareil: categorie?.label || null,
      client,
      company,
      invoiceDate,
    });
    if (!model.eligible) {
      if (!MOTIFS[model.motif]?.silencieux) result.skipped.push({ certificatId: certificat.id, message: MOTIFS[model.motif]?.message || model.motif });
      continue;
    }
    const path = attestationPathFor(certificat.pdf_storage_path);
    if (!path) {
      result.skipped.push({ certificatId: certificat.id, message: 'Certificat sans PDF archivé' });
      continue;
    }
    const { logoSrc, signatureSrc } = await loadAssets();
    const blob = await rendrePdf({ lettre: model.lettre, company, logoSrc, signatureSrc });
    const up = await archiver(path, blob);
    if (up.error) {
      result.skipped.push({ certificatId: certificat.id, message: `Archivage impossible : ${up.error.message}` });
      continue;
    }
    result.generated.push({ certificatId: certificat.id, path });
  }
  return result;
}
