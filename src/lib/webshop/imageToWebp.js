/**
 * imageToWebp.js — conversion navigateur d'une photo en WebP (largeur max 1600 px),
 * même format que le script d'import du site (scripts/import-dixneuf.ts).
 */
export async function imageToWebp(file, { maxWidth = 1600, quality = 0.82 } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob) throw new Error('Conversion de la photo impossible');
  return blob;
}
