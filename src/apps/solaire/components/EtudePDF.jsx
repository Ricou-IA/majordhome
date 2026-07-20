/**
 * EtudePDF.jsx — Étude de rentabilité photovoltaïque personnalisée.
 * ============================================================================
 * Orchestrateur fin : assemble la couverture + les pages de l'étude (chaque page
 * = un composant sous etude/). Branding multi-tenant via buildCompanyInfo (couleur
 * d'accent, logo, coordonnées de l'org). Graphiques redessinés en primitives
 * react-pdf (palette deutan) — jamais de capture d'écran. Le surplus n'est JAMAIS
 * valorisé en €.
 *
 * Pages :
 *   1. Couverture brandée (CoverPage)
 *   2. En un coup d'œil + plan du toit satellite (SynthesePage)
 *   3. Installation & production (InstallationPage)
 *   4. Vos flux d'électricité — constat (FluxPage)
 *   5. Optimiser l'autoconsommation — cascade figée (OptimisationPage, si leviers actifs)
 *   6. Coûts & rentabilité — projection 20 ans (CoutsPage)
 * Socle partagé : etude/pdfShared.jsx (palette, formatters, header, footer, accent).
 * ============================================================================
 */
import { Document, pdf } from '@react-pdf/renderer';
import { CoverPage } from './etude/CoverPage';
import { SynthesePage } from './etude/SynthesePage';
import { InstallationPage } from './etude/InstallationPage';
import { FluxPage } from './etude/FluxPage';
import { OptimisationPage } from './etude/OptimisationPage';
import { CoutsPage } from './etude/CoutsPage';

function EtudeDocument({ model, autoconso, config, company, inputs, meta, annexLabels, roofMap, material }) {
  const { ev } = inputs;
  // Page optimisation seulement si au moins un levier a été activé lors de la démo
  // (sinon la cascade se réduit au constat → page sans valeur, on la saute).
  const showOptim = autoconso?.cascade?.length > 1;

  return (
    <Document title={`Étude photovoltaïque — ${meta.clientName}`} author={company.name}>
      <CoverPage company={company} meta={meta} />
      <SynthesePage model={model} config={config} company={company} meta={meta} roofMap={roofMap} material={material} ev={ev} />
      <InstallationPage model={model} config={config} company={company} inputs={inputs} />
      <FluxPage model={model} company={company} />
      {showOptim ? <OptimisationPage autoconso={autoconso} company={company} /> : null}
      <CoutsPage model={model} config={config} company={company} annexLabels={annexLabels} />
    </Document>
  );
}

/**
 * Génère le blob PDF de l'étude (sans les annexes — fusionnées ensuite via pdf-lib).
 * `autoconso` (buildOptimModel, optionnel) = état FIGÉ des leviers d'optimisation
 * à la génération → page « Optimiser l'autoconsommation ». `roofMap`
 * (buildSatelliteRoofModel, optionnel) = vue satellite du toit sur la synthèse.
 * `material` (bloc dossier, optionnel) précise marque/modèle des modules.
 */
export async function generateEtudePdfBlob({ model, autoconso, config, company, inputs, meta, annexLabels, roofMap, material }) {
  return pdf(
    <EtudeDocument
      model={model}
      autoconso={autoconso}
      config={config}
      company={company}
      inputs={inputs}
      meta={meta}
      annexLabels={annexLabels}
      roofMap={roofMap}
      material={material}
    />,
  ).toBlob();
}
