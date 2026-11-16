// src/apps/artisan/components/certificat/certificatConformeExport.js
// Point d'entrée UNIQUE du certificat « Conforme » allégé posé par le bureau
// (spec docs/superpowers/specs/2026-11-16-certificat-conforme-allege-design.md).
//
// Même ordre que le certificat complet (CertificatWizard.finaliser) :
//   certificat enregistré → ligne « Réalisé » (et carte + visite de l'année si c'était la
//   dernière ligne) → PDF → archivage.
// La clôture passe AVANT le rendu react-pdf : la carte ne dépend jamais d'un rendu réussi côté
// navigateur. Un PDF qui échoue ne défait rien, il se régénère (`genererPdfConforme`).
// Ces fonctions lèvent sur refus (contrat des mutations) ; ce qui n'a pas pu être fait sans
// être bloquant est RENVOYÉ dans `avertissements`, jamais avalé.
import { certificatsService } from '@services/certificats.service';
import { savService } from '@services/sav.service';
import { buildCertificatConforme } from '@/lib/certificatConformeModel';
import { attestationPathFor } from '@/lib/attestationEntretienModel';
import { formatDateForInput } from '@/lib/utils';
import { generateAttestationPdfBlob } from './AttestationEntretienPDF';
import { chargerVisuelsLettre } from './attestationExport';

const messageDe = (err) => err?.message || 'erreur inconnue';

/**
 * (Re)génère le PDF d'un certificat allégé et l'archive à côté des autres certificats.
 * @param {object} p
 * @param {object} p.certificat  ligne `majordhome_certificats` (mode allégé)
 * @param {{ appareil?: string|null, contractNumber?: string|null, client: object, company: object, orgId: string }} p.lettreCtx
 * @returns {Promise<{ storagePath: string, avertissements: string[] }>}
 */
export async function genererPdfConforme({ certificat, lettreCtx }) {
  const { appareil = null, contractNumber = null, client, company, orgId } = lettreCtx;
  const { lettre } = buildCertificatConforme({
    certificat, appareil, contractNumber, client, company, dateEdition: formatDateForInput(new Date()),
  });
  const { logoSrc, signatureSrc, warnings } = await chargerVisuelsLettre(company);
  const blob = await generateAttestationPdfBlob({ lettre, company, logoSrc, signatureSrc });

  const up = await certificatsService.uploadPdf(orgId, certificat.client_id, certificat.id, blob);
  if (up.error) throw new Error(`archivage impossible : ${messageDe(up.error)}`);
  const { storagePath } = up.data;
  const { data: signedUrl } = await certificatsService.getSignedUrl(storagePath);
  const info = await certificatsService.updatePdfInfo(certificat.id, storagePath, signedUrl || '');
  if (info.error) throw new Error(`document archivé mais non rattaché au certificat : ${messageDe(info.error)}`);
  return { storagePath, avertissements: warnings };
}

/**
 * Pose le certificat allégé d'une ligne d'équipement et clôt la ligne.
 * @param {object} p
 * @param {object} p.payload  `certificatAllegePayload(...)`
 * @param {string} p.childId  intervention enfant (= payload.intervention_id)
 * @param {object} p.lettreCtx  cf. genererPdfConforme
 * @returns {Promise<{ certificat: object, avertissements: string[] }>}
 */
export async function poserCertificatConforme({ payload, childId, lettreCtx }) {
  // 1. Le certificat d'abord : sans ligne en base, rien à clôturer.
  const saved = await certificatsService.saveAllege(payload);
  if (saved.error || !saved.data) throw new Error(`Certificat non enregistré : ${messageDe(saved.error)}`);
  const certificat = saved.data;

  // 2. Ligne « Réalisé » — et carte + visite de l'année à la date saisie si c'était la dernière.
  const realise = await savService.markRealise(childId, { visitDate: certificat.date_intervention });
  if (realise.error) {
    throw new Error(`Certificat enregistré, mais la ligne n'a pas pu être clôturée : ${messageDe(realise.error)}. Recliquez « Conforme ».`);
  }

  // 3. Document. Un échec ici ne défait rien : « Voir certificat » le régénère.
  const avertissements = [];
  try {
    const pdf = await genererPdfConforme({ certificat, lettreCtx });
    avertissements.push(...pdf.avertissements);
  } catch (err) {
    avertissements.push(`Ligne clôturée, mais le document n'a pas été généré (${messageDe(err)}) : « Voir certificat » le régénère.`);
  }
  return { certificat, avertissements };
}

/**
 * Annule un certificat allégé avant facturation : certificat retiré, ligne remise « À faire ».
 * Le certificat part en premier : s'il ne se retire pas, rien n'a bougé.
 * @param {object} p
 * @param {{ id: string, pdf_storage_path?: string|null }} p.certificat
 * @param {string} p.childId
 * @param {string} p.orgId  org core
 */
export async function annulerCertificatConforme({ certificat, childId, orgId }) {
  const removed = await certificatsService.deleteAllege(certificat.id, orgId);
  if (removed.error) throw new Error(`Certificat non retiré : ${messageDe(removed.error)}`);

  const reset = await savService.unmarkChildNeant(childId);
  if (reset.error) throw new Error(`Certificat retiré, mais la ligne est restée close : ${messageDe(reset.error)}`);

  // Fichiers : best effort, des orphelins dans le bucket ne changent rien à l'écran.
  const pdfPath = certificat.pdf_storage_path || null;
  await certificatsService.removeFiles([pdfPath, attestationPathFor(pdfPath)]);
  return { certificatId: certificat.id };
}
