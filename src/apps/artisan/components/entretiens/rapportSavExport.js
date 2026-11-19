// src/apps/artisan/components/entretiens/rapportSavExport.js
// Point d'entrée UNIQUE de l'édition du rapport d'intervention SAV
// (spec docs/superpowers/specs/2026-11-19-rapport-intervention-sav-design.md) :
//   lettre (modèle pur) → logo et signature de l'entreprise → PDF → archivage → trace sur la carte.
// Lève sur refus (contrat des mutations) ; ce qui n'a pas pu être fait sans être bloquant (logo ou
// signature illisible) est RENVOYÉ dans `avertissements`, jamais avalé.
import { rapportSavService } from '@services/rapportSav.service';
import { buildRapportSav } from '@/lib/rapportSavModel';
import { formatDateForInput } from '@/lib/utils';
import { generateAttestationPdfBlob } from '../certificat/AttestationEntretienPDF';
import { chargerVisuelsLettre } from '../certificat/attestationExport';

/**
 * @param {object} p
 * @param {string} p.orgId  org CORE
 * @param {{ id: string, project_id: string }} p.carte  carte SAV
 * @param {object} p.contenu  saisie validée (cf. rapportSavModel.validerContenu)
 * @param {{ name: string, address?: string, postal_code?: string, city?: string }} p.client
 * @param {object} p.company  buildCompanyInfo(settings)
 * @param {string|null} [p.userId]
 * @returns {Promise<{ path: string, trace: object, avertissements: string[] }>}
 */
export async function editerRapportSav({ orgId, carte, contenu, client, company, userId = null }) {
  const { lettre } = buildRapportSav({ contenu, client, company, dateEdition: formatDateForInput(new Date()) });
  const { logoSrc, signatureSrc, warnings } = await chargerVisuelsLettre(company);
  const blob = await generateAttestationPdfBlob({ lettre, company, logoSrc, signatureSrc });
  const { data, error } = await rapportSavService.archiver({ orgId, carte, contenu, blob, userId });
  if (error || !data) throw new Error(`Rapport non enregistré : ${error?.message || 'erreur inconnue'}`);
  return { ...data, avertissements: warnings };
}
