// src/apps/thermique/lib/etudeModel.js
// buildEtudeModel = SOURCE DE CALCUL UNIQUE (pattern Solaire) : l'écran résultats (plan 4) et le PDF
// (plan 5) consomment le même modèle. Module PUR — les données JSON sont passées en paramètres.
import { assembleBatiment } from './assembleBatiment.js';
import { assembleBatimentParametrique } from './assembleBatimentParametrique.js';
import { calculeBatiment } from './thermalEngine.js';
import { courbeCharge, pointBivalence, consoAnnuelle } from './heatPumpEngine.js';

export const ENGINE_VERSION = '1.0.0'; // à incrémenter à tout changement de règle de calcul

/** Identifiant canonique d'une PAC du catalogue (pas de champ id dans pac-catalogue.json). */
export function pacId(pac) {
  return `${pac.fabricant}|${pac.modele}`;
}

/**
 * Sous-ensemble du modèle persisté dans thermal_studies.results (Task 14) — vit ici (et pas dans
 * wizardState.js) car son shape dérive du modèle, à côté d'ENGINE_VERSION qui le versionne.
 * Les parois sont EXCLUES : re-dérivables du `input` persisté via buildEtudeModel.
 */
export function resultsPersistables(model) {
  return { bilan: model.bilan, thetaE: model.thetaE, pac: model.pac };
}

function resolvePac(pac, pacCatalogue) {
  if (!pac || !pac.mode) return null;
  if (pac.mode === 'manuelle') {
    if (!Array.isArray(pac.points) || pac.points.length < 2) return null;
    return { type: 'manuelle', points: pac.points, scopManuel: pac.scopManuel ?? null };
  }
  if (!pacCatalogue || !pac.pacId) return null;
  return pacCatalogue.pacs.find((p) => pacId(p) === pac.pacId) ?? null;
}

/**
 * @param {{ contexte, dessin, compositions, pac }} etude — état wizard (= input jsonb persisté)
 *   pac = { regime, mode: 'catalogue'|'manuelle'|null, pacId, points, scopManuel, prixKwh }
 *   contexte porte dju (résolu à la sélection de commune — commune.dju ?? djuDepartemental, R2)
 * @param {{ config, data }} env — config = buildThermiqueConfig(settings) ;
 *   data = { climat, uDefauts, coefficientsB, ventilation, pacCatalogue? } (pacCatalogue lazy)
 * @returns {{ ok, erreurs, avertissements, thetaE, bilan, parois, pac, engineVersion }}
 *   pac = null si pas de sélection valide ou catalogue non chargé ;
 *   sinon { bivalence, conso: {...}|null, consoErreur: string|null }.
 */
export function buildEtudeModel(etude, { config, data }) {
  const { contexte, compositions } = etude;
  const reglages = { thetaIntDefauts: config.theta_int_defauts, deltaUtb: config.delta_utb, fRH: config.f_rh };
  const modeParametrique = etude.saisie?.modeSaisie === 'parametrique'
    && (etude.saisie.pieces?.length > 0 || !etude.dessin?.pieces?.length);
  const assemblage = modeParametrique
    ? assembleBatimentParametrique(etude.saisie, { data, contexte, compositions, reglages })
    : assembleBatiment(etude.dessin, { data, contexte, compositions, reglages });
  const base = {
    erreurs: assemblage.erreurs, avertissements: assemblage.avertissements,
    thetaE: assemblage.thetaE, parois: assemblage.parois, engineVersion: ENGINE_VERSION,
  };
  if (!assemblage.batiment) return { ...base, ok: false, bilan: null, pac: null };

  const bilan = calculeBatiment(assemblage.batiment);
  // Foisonnement émetteur : valeur PAR ÉTUDE prioritaire (etude.foisonnement, éditable étape
  // Résultats), sinon défaut org (config.foisonnement_emetteur), sinon 1.0.
  const foisonnement = Number.isFinite(etude.foisonnement)
    ? etude.foisonnement
    : (Number.isFinite(config.foisonnement_emetteur) ? config.foisonnement_emetteur : 1.0);
  bilan.pieces = bilan.pieces.map((p) => ({ ...p, puissanceEmetteur: p.total * foisonnement }));
  const pacResolue = resolvePac(etude.pac, data.pacCatalogue);
  if (!pacResolue) return { ...base, ok: true, bilan, pac: null };

  const thetaNC = config.theta_non_chauffage;
  // R4 : total (relance incluse) → courbe de charge ; gv (relance exclue) → conso. Ne pas croiser.
  const charge = courbeCharge({ phiTotal: bilan.total, thetaBase: assemblage.thetaE, thetaNC });
  const bivalence = pointBivalence({
    pac: pacResolue, tDepart: etude.pac.regime, charge, thetaBase: assemblage.thetaE, thetaNC,
  });
  let conso = null;
  let consoErreur = null;
  try {
    conso = consoAnnuelle({
      gv: bilan.gv, dju: contexte.dju,
      heuresChauffage: data.climat.heuresChauffage[contexte.dept],
      pac: pacResolue, tDepart: etude.pac.regime,
      prixKwh: etude.pac.prixKwh ?? config.prix_kwh,
      facteurAjustement: config.facteur_ajustement,
    });
  } catch (e) {
    consoErreur = e.message; // ex. PAC manuelle sans scopManuel — l'UI affiche la raison
  }
  return { ...base, ok: true, bilan, pac: { bivalence, conso, consoErreur } };
}
