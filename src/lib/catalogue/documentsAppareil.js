/**
 * documentsAppareil.js — Règles pures du lecteur de documents d'un appareil (mode atelier, fiches).
 * ============================================================================
 * Aucun import React / Supabase / alias. La nature d'un fichier (PDF, image, autre) et la liste des onglets
 * proposés à l'atelier (vues éclatées d'abord, puis notice / fiche technique / autres, procédures en dernier)
 * se décident ici, jamais dans un composant.
 * ============================================================================
 */

import { rangerDocumentsModele, titreDocumentModele } from './nomenclature.js';

const LIBELLES_TYPE = { notice: 'Notice technique', fiche_technique: 'Fiche technique', procedure: 'Procédure' };
const TYPES_ONGLET = new Set(['notice', 'fiche_technique', 'procedure']);

/**
 * Nature d'un fichier d'après son type MIME, sinon son nom ou son chemin.
 * @param {{ mime_type?: string, file_name?: string, storage_path?: string }} doc
 * @returns {'pdf'|'image'|'autre'}
 */
export function natureDocument(doc) {
  const mime = String(doc?.mime_type || '').toLowerCase();
  const nom = String(doc?.file_name || doc?.storage_path || '').toLowerCase();
  if (mime === 'application/pdf' || nom.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(nom)) return 'image';
  return 'autre';
}

/**
 * Onglets du mode atelier : une entrée par vue éclatée (`vue:<i>`), puis les documents dans l'ordre de
 * `rangerDocumentsModele` (principaux puis procédures, `doc:<id>`). Rien n'est proposé pour un type absent.
 * @param {{ vues?: Array<object>, documents?: Array<object> }} p
 * @returns {Array<{ id: string, type: 'vue'|'notice'|'fiche_technique'|'procedure'|'autre', libelle: string, source: object }>}
 */
export function ongletsAtelier({ vues, documents } = {}) {
  const lesVues = Array.isArray(vues) ? vues : [];
  const onglets = lesVues.map((v, i) => ({
    id: `vue:${i}`,
    type: 'vue',
    libelle: lesVues.length > 1 ? `Vue éclatée ${i + 1}/${lesVues.length}` : 'Vue éclatée',
    source: { kind: 'vue', url: v?.url, width: v?.width ?? null, height: v?.height ?? null },
  }));
  const { principaux, procedures } = rangerDocumentsModele(documents || []);
  for (const doc of [...principaux, ...procedures]) {
    onglets.push({
      id: `doc:${doc.id}`,
      type: TYPES_ONGLET.has(doc.document_type) ? doc.document_type : 'autre',
      libelle: titreDocumentModele(doc, (t) => LIBELLES_TYPE[t] || 'Document'),
      source: { kind: 'doc', doc },
    });
  }
  return onglets;
}
