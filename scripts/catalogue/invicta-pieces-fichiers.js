// scripts/catalogue/invicta-pieces-fichiers.js
// Règles PURES de la copie des fichiers d'un relevé de pièces détachées Invicta (photos, vues éclatées, documents)
// vers notre Storage. Aucun import, aucun accès réseau : le script attach-invicta-fichiers.mjs fait les appels.
// Testé dans scripts/catalogue/invicta-pieces.test.mjs. Spec :
// docs/superpowers/specs/2026-11-11-pieces-detachees-invicta-releve-nomenclature-design.md § 5.4.
//
// Un fichier est stocké UNE fois par contenu : au relevé du 2026-11-11, 973 documents pèsent 1 396 Mo pour 294
// contenus distincts (477 Mo) — la même procédure est publiée sous un identifiant différent pour chaque appareil.
// L'identité d'un contenu est l'ETag rendu par le site (empreinte du fichier).

/** Type de document du site → type en base ; `null` = non importé (micrologiciels). */
const TYPES = { Notice: 'notice', Datasheet: 'fiche_technique', Procedure: 'procedure' };
export const typeDocument = (typeSite) => TYPES[typeSite] || null;

const EXTENSIONS = { 'application/pdf': 'pdf', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
/** Extension d'un fichier d'après son type MIME ; `null` si le bucket ne l'accepte pas. */
export const extensionDepuisMime = (mime) => EXTENSIONS[String(mime || '').split(';')[0].trim().toLowerCase()] || null;

/** ETag du site → identifiant de contenu utilisable dans un nom de fichier (`null` s'il est absent). */
export function cleContenu(etag) {
  const k = String(etag || '').replace(/^W\//, '').replace(/"/g, '').replace(/[^A-Za-z0-9-]/g, '').toLowerCase();
  return k || null;
}

/** Dossier Storage des fichiers relevés d'une org (bucket product-documents). */
export const dossierSite = (orgId) => `${orgId}/equipment-models/site`;
export const cheminImage = (orgId, fileId, ext) => `${dossierSite(orgId)}/img-${fileId}.${ext}`;
export const cheminDocument = (orgId, cle, ext) => `${dossierSite(orgId)}/doc-${cle}.${ext}`;

/** Nom de fichier lisible d'un document : libellé du site nettoyé + extension. */
export function nomFichierDocument(label, type, ext) {
  const base = String(label || type || 'document').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'document';
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

/**
 * Ce qu'il y a à copier dans un relevé : images (photo + vues éclatées, une par identifiant de fichier) et
 * documents importables (un par document du site).
 * @param {object} releve
 * @returns {{ images: Array<{ fileId: string, url: string }>, documents: Array<{ id: string, fileKey: string, type: string, label: string }>, ignores: Record<string, number> }}
 */
export function fichiersACopier(releve) {
  const images = new Map();
  const documents = new Map();
  const ignores = {};
  for (const a of (releve && releve.appareils) || []) {
    for (const img of [a.photo, ...(a.vues_eclatees || [])]) {
      if (img && img.fileId && img.url && !images.has(img.fileId)) images.set(img.fileId, { fileId: img.fileId, url: img.url });
    }
    for (const d of a.documents || []) {
      const type = typeDocument(d.type);
      if (!type || !d.id || !d.fileKey) { ignores[d.type || 'sans type'] = (ignores[d.type || 'sans type'] || 0) + 1; continue; }
      if (!documents.has(d.id)) documents.set(d.id, { id: d.id, fileKey: d.fileKey, type, label: d.label || '' });
    }
  }
  return { images: [...images.values()], documents: [...documents.values()], ignores };
}

/**
 * Charge utile de public.equipment_models_set_files, par modèle. Rien d'approximatif n'est écrit :
 *   - photo : posée si elle a été déposée, sinon laissée telle quelle en base ;
 *   - vues éclatées : tout ou rien par appareil (une liste partielle remplacerait la liste complète) ;
 *   - documents : la liste REMPLACE celle du modèle, donc elle n'est envoyée que si chaque document importable a
 *     été déposé ou est `absent` du site (lien mort : écarté et compté) ; sinon `documents: null` = ne pas toucher,
 *     le passage suivant complètera.
 * @param {object} releve
 * @param {{ images: Map<string, { path: string }>,
 *           documents: Map<string, { path: string, size: number, mime: string, ext: string } | { absent: true }> }} deposes
 *   images par fileId, documents par id de document du site
 * @returns {{ fichiers: object[], bilan: { images_manquantes: number, documents_manquants: number, documents_absents: number,
 *             modeles_documents_incomplets: number, documents_ecrits: number } }}
 */
export function fichiersPourModeles(releve, deposes) {
  const bilan = { images_manquantes: 0, documents_manquants: 0, documents_absents: 0, modeles_documents_incomplets: 0, documents_ecrits: 0 };
  const fichiers = [];
  for (const a of (releve && releve.appareils) || []) {
    const photo = a.photo && deposes.images.get(a.photo.fileId);
    if (a.photo && !photo) bilan.images_manquantes += 1;
    const vues = [];
    for (const v of a.vues_eclatees || []) {
      const img = deposes.images.get(v.fileId);
      if (!img) { bilan.images_manquantes += 1; continue; }
      vues.push({ path: img.path, width: v.width ?? null, height: v.height ?? null });
    }
    const vuesCompletes = vues.length === (a.vues_eclatees || []).length;
    const documents = [];
    let complet = true;
    for (const d of a.documents || []) {
      const type = typeDocument(d.type);
      if (!type) continue;
      const dep = deposes.documents.get(d.id);
      if (!dep) { bilan.documents_manquants += 1; complet = false; continue; }
      if (dep.absent) { bilan.documents_absents += 1; continue; }
      documents.push({
        id: d.id, type, label: d.label || '', file_name: nomFichierDocument(d.label, d.type, dep.ext), storage_path: dep.path,
        file_size: dep.size, mime_type: dep.mime, fileKey: d.fileKey,
      });
    }
    if (!complet) bilan.modeles_documents_incomplets += 1; else bilan.documents_ecrits += documents.length;
    fichiers.push({ source_id: a.publicId, photo_path: photo ? photo.path : null, exploded_views: vuesCompletes ? vues : [], documents: complet ? documents : null });
  }
  return { fichiers, bilan };
}
