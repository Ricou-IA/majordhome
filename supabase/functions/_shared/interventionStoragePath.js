// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/interventionStoragePath.js — ne pas éditer.
/**
 * Chemin d'un fichier de la fiche d'intervention (photos de terrain, signature du client) dans
 * le dossier Storage `interventions`.
 *
 * Le PREMIER segment est l'organisation (org CORE, `core.organization_members.org_id`) : les
 * règles d'accès `interventions_org_*` le comparent à l'adhésion de l'utilisateur, comme pour
 * les PV de réception (`${orgId}/pv-reception/…`). Un chemin qui commence par l'identifiant du
 * projet est refusé — c'était le cas avant le 2026-11-18, aucun dépôt n'est jamais passé.
 *
 * Module pur (aucun import) : testé par `scripts/intervention-storage-path.test.mjs`, et la même
 * forme est éprouvée contre les règles par `scripts/migration-rehearsal/assert-interventions-fiche-storage.sql`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {Object} p
 * @param {string} p.orgId - Organisation CORE de l'utilisateur (`useAuth().organization.id`)
 * @param {string} p.projectId - Projet de l'intervention
 * @param {string} p.interventionId
 * @param {string} p.fileType - `photo_before`, `photo_after`, `photo_extra`, `signature`…
 * @param {string} [p.extension]
 * @param {number} [p.now] - Horodatage (injecté par les tests)
 * @returns {string} `${orgId}/${projectId}/${interventionId}/${fileType}_${now}.${extension}`
 */
export function buildInterventionStoragePath({ orgId, projectId, interventionId, fileType, extension = 'jpg', now = Date.now() }) {
  if (!UUID.test(String(orgId || ''))) throw new Error('[interventions] organisation requise pour ranger le fichier');
  if (!projectId || !interventionId || !fileType) throw new Error('[interventions] projectId, interventionId et fileType requis');
  return `${orgId}/${projectId}/${interventionId}/${fileType}_${now}.${extension}`;
}

/**
 * Chemin du rapport d'intervention SAV archivé : un seul fichier par carte, remplacé à chaque
 * édition (nom fixe). L'edge `sav-report-send` le DÉRIVE par cette même fonction (copie Deno) :
 * un chemin n'est jamais reçu d'une requête.
 * @param {{ orgId: string, projectId: string, interventionId: string }} p
 * @returns {string} `${orgId}/${projectId}/${interventionId}/rapport-intervention.pdf`
 */
export function buildInterventionReportPath({ orgId, projectId, interventionId }) {
  if (!UUID.test(String(orgId || ''))) throw new Error('[interventions] organisation requise pour ranger le rapport');
  if (!UUID.test(String(projectId || '')) || !UUID.test(String(interventionId || ''))) {
    throw new Error('[interventions] projectId et interventionId requis pour ranger le rapport');
  }
  return `${orgId}/${projectId}/${interventionId}/rapport-intervention.pdf`;
}
