// ============================================================================
// imageDataUrl.js — une image distante (logo de l'organisation, signature du signataire)
// lue en data URL pour être posée dans un PDF react-pdf. Jamais d'exception : une image
// qui ne répond pas rend `null`, et c'est l'appelant qui dit ce qui manque.
// ============================================================================

async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

/**
 * @param {string|null|undefined} url
 * @returns {Promise<string|null>} data URL, ou `null` si l'adresse est vide ou ne répond pas
 */
export async function fetchAsDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await blobToDataUrl(await res.blob());
  } catch {
    return null;
  }
}
