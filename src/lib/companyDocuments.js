// src/lib/companyDocuments.js — documents de l'entreprise (Settings → Organisation → Identité)
// Module PUR (aucun import React/Supabase) — testé `node --test scripts/company-documents.test.mjs`.
//
// Stockage : bucket privé `product-documents`, chemin `${orgId}/branding/documents/${kind}/…`.
// Réglage : `settings.company_documents = { [kind]: [{ path, name, valid_until }] }` — toujours
// un tableau par nature, même pour une nature à fichier unique (`multiple: false`).

/** @type {{ key: string, label: string, hint: string, multiple: boolean, fields: { intitule: string, numero: string, organisme: string } }[]} */
export const COMPANY_DOCUMENT_KINDS = [
  {
    key: 'certifications', label: 'Certifications', hint: 'Un certificat par qualification (QualiBois, QualiPAC, QualiPV…)', multiple: true,
    fields: { intitule: 'Qualification', numero: 'N° de qualification', organisme: 'Organisme' },
  },
  {
    key: 'attestation_fluides', label: 'Attestation de capacité fluides', hint: 'Manipulation des fluides frigorigènes', multiple: false,
    fields: { intitule: 'Attestation', numero: "N° d'attestation", organisme: 'Organisme agréé' },
  },
  {
    key: 'attestation_assurance', label: "Attestation d'assurance", hint: 'Décennale et RC professionnelle', multiple: false,
    fields: { intitule: 'Garanties', numero: 'N° de police', organisme: 'Assureur' },
  },
];

export const COMPANY_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
export const COMPANY_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const EXPIRY_SOON_DAYS = 30;

/**
 * Ramène le réglage brut à `{ [kind]: Document[] }` pour toutes les natures connues.
 * @param {unknown} raw
 * @returns {Record<string, { path: string, name: string, valid_until: string|null }[]>}
 */
export function normalizeCompanyDocuments(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const { key } of COMPANY_DOCUMENT_KINDS) {
    const list = Array.isArray(src[key]) ? src[key] : [];
    out[key] = list
      .filter((d) => d && typeof d.path === 'string' && d.path)
      .map((d) => ({
        path: d.path,
        name: d.name || d.path.split('/').pop(),
        valid_until: d.valid_until || null,
        // Lu par l'IA au dépôt (edge company-document-extract), corrigeable à l'écran.
        intitule: d.intitule || '',
        numero: d.numero || '',
        organisme: d.organisme || '',
        // null = jamais lu · 'ok' · 'illisible' (le modèle n'y trouve pas le document attendu) · 'echec' (appel en erreur)
        read_status: ['ok', 'illisible', 'echec'].includes(d.read_status) ? d.read_status : null,
      }));
  }
  return out;
}

/**
 * État de validité d'un document à la date `today`.
 * @param {string|null} validUntil  date ISO `YYYY-MM-DD`
 * @param {Date} [today]
 * @returns {'none'|'valid'|'soon'|'expired'}
 */
export function expiryStatus(validUntil, today = new Date()) {
  if (!validUntil || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return 'none';
  const [y, m, d] = validUntil.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((end - now) / 86400000);
  if (days < 0) return 'expired';
  if (days <= EXPIRY_SOON_DAYS) return 'soon';
  return 'valid';
}

/**
 * Chemin de stockage d'un nouveau fichier (horodaté : jamais d'écrasement d'un fichier encore référencé).
 * @param {string} orgId
 * @param {string} kind
 * @param {string} fileName
 * @param {number} [now]
 * @returns {string}
 */
export function buildCompanyDocumentPath(orgId, kind, fileName, now = Date.now()) {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'document';
  return `${orgId}/branding/documents/${kind}/${now}-${base}${ext ? `.${ext}` : ''}`;
}

/**
 * Chemins présents dans `before` mais absents de `after` (fichiers à purger du Storage).
 * @param {Record<string, { path: string }[]>} before
 * @param {Record<string, { path: string }[]>} after
 * @returns {string[]}
 */
export function removedDocumentPaths(before, after) {
  const kept = new Set(Object.values(after || {}).flat().map((d) => d.path));
  return Object.values(before || {}).flat().map((d) => d.path).filter((p) => !kept.has(p));
}

/**
 * Fusionne le résultat de la lecture IA dans un document : l'IA ne remplace jamais une
 * valeur déjà saisie (la correction humaine prime), elle ne fait que combler les vides.
 * @param {{ intitule: string, numero: string, organisme: string, valid_until: string|null }} doc
 * @param {{ lisible: boolean, intitule: string|null, numero: string|null, organisme: string|null, valid_until: string|null }|null} extracted
 */
export function applyExtraction(doc, extracted) {
  if (!extracted) return { ...doc, read_status: 'echec' };
  return {
    ...doc,
    intitule: doc.intitule || extracted.intitule || '',
    numero: doc.numero || extracted.numero || '',
    organisme: doc.organisme || extracted.organisme || '',
    valid_until: doc.valid_until || extracted.valid_until || null,
    read_status: extracted.lisible ? 'ok' : 'illisible',
  };
}

/**
 * Qualifications « intitulé + numéro » lues sur les certificats déposés, expirés exclus.
 * @param {Record<string, { intitule: string, numero: string, valid_until: string|null }[]>} docs
 * @param {Date} [today]
 * @returns {string[]}
 */
export function qualificationsFromDocuments(docs, today = new Date()) {
  return (docs?.certifications || [])
    .filter((d) => d.intitule && expiryStatus(d.valid_until, today) !== 'expired')
    .map((d) => [d.intitule, d.numero].filter(Boolean).join(' '));
}

/**
 * Source unique de la liste des qualifications affichées (PDF, e-mails…) : les certificats
 * déposés dès qu'il y en a au moins un, sinon la saisie manuelle historique `rge_certifications`.
 * @param {Record<string, unknown>} settings
 * @param {Date} [today]
 * @returns {string[]}
 */
export function resolveRgeCertifications(settings, today = new Date()) {
  const docs = normalizeCompanyDocuments(settings?.company_documents);
  if (docs.certifications.length > 0) return qualificationsFromDocuments(docs, today);
  return Array.isArray(settings?.rge_certifications) ? settings.rge_certifications : [];
}
