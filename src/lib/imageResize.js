/**
 * imageResize.js — réduction d'une photo côté navigateur avant envoi.
 * ============================================================================
 * Une photo de tablette pèse 3 à 6 Mo ; une plaque signalétique se lit très bien
 * à 1600 px. On redessine l'image sur un canvas (orientation EXIF respectée par
 * `createImageBitmap`) et on la réencode en JPEG. En cas d'échec (format non
 * décodable, navigateur sans canvas), le fichier d'origine est renvoyé tel quel :
 * la réduction est un confort, jamais un blocage.
 * ============================================================================
 */

/**
 * @param {File|Blob} file
 * @param {{ maxCote?: number, qualite?: number }} [opts]
 * @returns {Promise<Blob>} JPEG réduit, ou le fichier d'origine si la réduction échoue
 */
export async function reduireImage(file, { maxCote = 1600, qualite = 0.85 } = {}) {
  if (!file || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const ratio = Math.min(1, maxCote / Math.max(bitmap.width, bitmap.height));
    const largeur = Math.max(1, Math.round(bitmap.width * ratio));
    const hauteur = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = largeur;
    canvas.height = hauteur;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, largeur, hauteur);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualite));
    return blob || file;
  } catch {
    return file;
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}
