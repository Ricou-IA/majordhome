/* eslint-disable react-refresh/only-export-components -- module de rendu PDF (blob), jamais monté
   dans l'arbre React : Fast Refresh ne s'applique pas. */
/**
 * EtudeThermiquePDF.jsx — Rapport PDF de l'étude thermique (déperditions + PAC).
 * ============================================================================
 * Orchestrateur fin : assemble les pages (chacune = un composant de ce dossier). Branding
 * multi-tenant via buildCompanyInfo (couleur d'accent, logo, coordonnées de l'org) — aucune valeur
 * en dur. Graphiques redessinés en primitives react-pdf, jamais de capture d'écran.
 *
 * Pages :
 *   1. Bilan — projet, déperditions totales, décomposition par poste, détail pièce par pièce
 *      (le tableau des pièces déborde de lui-même sur une page 2 sur les grandes maisons)
 *   2. Pompe à chaleur — bivalence, couverture, consommation, graphe besoin vs PAC (si configurée)
 *   3. Hypothèses de calcul — U retenus, forfaits, ventilation (transparence, spec §8)
 *
 * `rapport` vient de buildRapportModel, qui consomme lui-même buildEtudeModel : les chiffres du PDF
 * sont, par construction, ceux de l'écran de résultats (live) ou ceux figés à l'enregistrement.
 * ============================================================================
 */
import { Document, pdf } from '@react-pdf/renderer';
import { couleurRatio } from '../../lib/rapportModel';
import { BilanPage } from './BilanPage';
import { PacPage } from './PacPage';
import { HypothesesPage } from './HypothesesPage';

// Dégradé de l'échelle des pièces pré-calculé (react-pdf n'a pas de linear-gradient) — mêmes
// bornes bleu/ambre que les vignettes, donc la légende décrit exactement ce qui est colorié.
const ECHELLE = Array.from({ length: 12 }, (_, i) => couleurRatio(i / 11));

function RapportDocument({ rapport, company }) {
  return (
    <Document
      title={`Étude thermique — ${rapport.projet.clientName || rapport.projet.titre}`}
      author={company.name}
    >
      <BilanPage rapport={rapport} company={company} echelle={ECHELLE} />
      {rapport.pac ? <PacPage rapport={rapport} company={company} /> : null}
      <HypothesesPage rapport={rapport} company={company} />
    </Document>
  );
}

/** Blob PDF du rapport thermique. */
export async function generateRapportThermiquePdfBlob({ rapport, company }) {
  return pdf(<RapportDocument rapport={rapport} company={company} />).toBlob();
}

export { RapportDocument };
