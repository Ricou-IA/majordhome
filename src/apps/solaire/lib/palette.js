// src/apps/solaire/lib/palette.js
// Palette deutan (spec §10.1) — JAMAIS de rouge/vert, jamais de couleur seule.
// Les jaunes sont réservés aux remplissages de graphiques ; le texte porteur
// de sens utilise les bleus + neutres, toujours accompagné d'une icône/libellé.
export const PV_COLORS = {
  production: '#F5C542',   // jaune — remplissages graphiques uniquement
  productionLight: '#FFD166',
  conso: '#0D47A1',        // bleu foncé
  autoconso: '#2196F3',    // bleu clair
  blueMid: '#1565C0',
  surplus: '#9CA3AF',      // gris (hachuré dans les charts)
};
