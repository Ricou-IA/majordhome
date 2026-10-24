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
 * @param {object} p
 * @param {string} p.orgId  org core
 * @param {string} p.interventionId  carte d'entretien (racine ; les certificats des enfants sont inclus)
 * @param {{ name: string, address?: string, postal_code?: string, city?: string }} p.client
 * @param {object} p.company  buildCompanyInfo(settings)
 * @param {Array<{ code: string, label: string, certificate_profile?: string }>} p.categories
 * @param {string} p.invoiceDate  `YYYY-MM-DD`
 * @returns {Promise<{ generated: { certificatId: string, path: string }[], skipped: { certificatId: string|null, message: string }[], warnings: string[] }>}
 */
export async function genererAttestationsIntervention({ orgId, interventionId, client, company, categories = [], invoiceDate }) {
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
    assets = { logoSrc: null, signatureSrc: null };
    if (company.logoUrl) {
      assets.logoSrc = await fetchAsDataUrl(company.logoUrl);
      if (!assets.logoSrc) result.warnings.push('Logo illisible : attestation éditée sans logo.');
    }
    if (company.signatorySignaturePath) {
      const { url } = await storageService.getSignedUrl(SIGNATURE_BUCKET, company.signatorySignaturePath);
      assets.signatureSrc = url ? await fetchAsDataUrl(url) : null;
      if (!assets.signatureSrc) result.warnings.push('Signature illisible : attestation éditée sans signature.');
    } else {
      result.warnings.push('Aucune signature dans Organisation → Identité : attestation éditée sans signature.');
    }
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
    const blob = await generateAttestationPdfBlob({ lettre: model.lettre, company, logoSrc, signatureSrc });
    const up = await certificatsService.uploadAttestation(path, blob);
    if (up.error) {
      result.skipped.push({ certificatId: certificat.id, message: `Archivage impossible : ${up.error.message}` });
      continue;
    }
    result.generated.push({ certificatId: certificat.id, path });
  }
  return result;
}
