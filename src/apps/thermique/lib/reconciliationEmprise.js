// src/apps/thermique/lib/reconciliationEmprise.js
// Croisement « vérification globale » (emprise dessinée) vs somme des pièces paramétriques — module PUR.
// Alerte NON bloquante au-delà du seuil. Ignore un niveau dont l'emprise n'est pas renseignée.
import { empriseDerives } from './assembleBatimentParametrique.js';

function ecartPct(ref, val) {
  if (!(ref > 0)) return 0;
  return Math.abs(val - ref) / ref;
}

export function reconcilieBatiment(saisie, { seuilPct = 0.10 } = {}) {
  const parNiveau = [];
  const messages = [];
  for (const n of saisie.niveaux) {
    const { surfaceSol, perimetre } = empriseDerives(n.emprise);
    const pieces = saisie.pieces.filter((p) => p.niveauId === n.id);
    const surfacePieces = pieces.reduce((s, p) => s + ((p.longueur ?? 0) / 100) * ((p.largeur ?? 0) / 100), 0);
    const mlExtPieces = pieces.reduce((s, p) => s + (p.mlMurExterieur ?? 0) / 100, 0);
    const empriseRenseignee = surfaceSol > 0;
    const ecartSurfacePct = empriseRenseignee ? ecartPct(surfaceSol, surfacePieces) : 0;
    const ecartMlPct = empriseRenseignee ? ecartPct(perimetre, mlExtPieces) : 0;
    const alerte = empriseRenseignee && (ecartSurfacePct > seuilPct || ecartMlPct > seuilPct);
    if (alerte) {
      if (ecartSurfacePct > seuilPct) messages.push(`${n.nom} : surface pièces ${surfacePieces.toFixed(1)} m² vs emprise ${surfaceSol.toFixed(1)} m² (${Math.round(ecartSurfacePct * 100)} % d'écart)`);
      if (ecartMlPct > seuilPct) messages.push(`${n.nom} : métré mur ext ${mlExtPieces.toFixed(1)} m vs périmètre ${perimetre.toFixed(1)} m (${Math.round(ecartMlPct * 100)} % d'écart)`);
    }
    parNiveau.push({ niveauId: n.id, nom: n.nom, surfaceEmprise: surfaceSol, surfacePieces, ecartSurfacePct, perimetreEmprise: perimetre, mlExtPieces, ecartMlPct, alerte });
  }
  return { parNiveau, alerteGlobale: parNiveau.some((x) => x.alerte), messages };
}
