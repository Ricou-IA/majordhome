// src/apps/thermique/lib/rapportExport.js
// Nommage et téléchargement du rapport thermique PDF (pendant de solaire/lib/etudeExport.js).

/** `rapport-thermique-<slug>-<AAAA-MM-JJ>.pdf` — accents et ponctuation strippés (nom de fichier
 * portable Windows/macOS). `date` est injectée par le caller (testable, pas d'horloge implicite). */
export function buildRapportFilename(nom, date = new Date()) {
  const slug = (nom || 'etude')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'etude';
  return `rapport-thermique-${slug}-${date.toISOString().slice(0, 10)}.pdf`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
