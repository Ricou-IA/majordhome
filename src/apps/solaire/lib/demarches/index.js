// src/apps/solaire/lib/demarches/index.js
// Point d'entrée UNIQUE du module Démarches administratives PV.
// PUR : aucun import React/Supabase/alias. Le résultat est figé dans
// pv_dossiers.demarches.resultat avec engine_version ; un dossier rouvert le relit.
import { valeurA } from './parametres.js';
import { calculerPlanning } from './planning.js';
import { delaiInstruction, demarcheEnedis, typeConsuel, rachat, alertesSituation, construireEtapes } from './regles.js';
import { listerPieces } from './pieces.js';
import { calculerFrais } from './frais.js';

/** À incrémenter à tout changement de règle, de texte d'étape ou de calcul. */
export const ENGINE_VERSION = 1;

/**
 * Complète et normalise les entrées (spec §5.1). `perimetre_abf` se dérive du bloc
 * `abf` du dossier s'il n'est pas fourni : secteur_protege true → oui, false → non, sinon inconnu.
 * @param {object} partial
 * @param {{ aujourdhui: string }} opts
 */
export function normaliserInputs(partial = {}, { aujourdhui }) {
  let perimetre_abf = partial.perimetre_abf;
  if (!['oui', 'non', 'inconnu'].includes(perimetre_abf)) {
    const sp = partial.abf?.secteur_protege;
    perimetre_abf = sp === true ? 'oui' : sp === false ? 'non' : 'inconnu';
  }
  return {
    commune_insee: partial.commune_insee ?? null,
    commune_nom: partial.commune_nom ?? null,
    puissance_kwc: Number(partial.puissance_kwc) || 0,
    batterie: partial.batterie === true,
    perimetre_abf,
    installateur_rge: partial.installateur_rge === true,
    mode_valorisation: partial.mode_valorisation === 'autoconso_totale' ? 'autoconso_totale' : 'autoconso_surplus',
    copropriete_ou_lotissement: ['copropriete', 'lotissement'].includes(partial.copropriete_ou_lotissement) ? partial.copropriete_ou_lotissement : 'aucun',
    compteur_linky: partial.compteur_linky !== false,
    date_depart: typeof partial.date_depart === 'string' && partial.date_depart ? partial.date_depart : aujourdhui,
    prise_en_charge: partial.prise_en_charge ?? {},
  };
}

/**
 * @param {object} inputsPartiels voir normaliserInputs
 * @param {object} params buildDemarchesParams(settings)
 * @param {{ aujourdhui?: string, societe?: string }} [opts]
 */
export function calculerDemarches(inputsPartiels, params, { aujourdhui, societe } = {}) {
  const jour = aujourdhui ?? new Date().toISOString().slice(0, 10);
  const inputs = normaliserInputs(inputsPartiels, { aujourdhui: jour });

  const instruction = delaiInstruction(inputs);
  const enedis = demarcheEnedis(inputs);
  const planning = calculerPlanning({ date_depart: inputs.date_depart, instructionCle: instruction.cle, enedisCle: enedis.delaiCle }, params);
  const etapes = construireEtapes(inputs, params, { instructionCle: instruction.cle, enedisCle: enedis.delaiCle, societe });
  const pieces = listerPieces(inputs);
  const frais = calculerFrais(inputs, params, planning);
  const oa = rachat(inputs, params, planning.depot_enedis);

  const alertes = [...instruction.alertes, ...alertesSituation(inputs), ...oa.alertes, ...frais.alertes];

  // Traçabilité : tarifs réellement résolus (jamais la prime, non affichée).
  const parametres_utilises = {};
  for (const ligne of frais.lignes) {
    if (ligne.parametre?.cle && ligne.parametre.date_effet) {
      parametres_utilises[ligne.parametre.cle] = { valeur: ligne.montant_ttc, date_effet: ligne.parametre.date_effet, unite: ligne.parametre.unite };
    }
  }
  if (oa.tarif) parametres_utilises[oa.tarif.cle] = { valeur: oa.tarif.valeur, date_effet: oa.tarif.date_effet, unite: oa.tarif.unite };

  return {
    engine_version: ENGINE_VERSION,
    calcule_le: jour,
    inputs,
    etapes,
    planning,
    pieces,
    frais,
    consuel: typeConsuel(inputs),
    enedis: enedis.type,
    rachat: { applicable: oa.applicable, eligible: oa.eligible, tarif: oa.tarif },
    alertes,
    parametres_utilises,
  };
}

// valeurA ré-exporté pour les consommateurs UI (affichage « en vigueur au … »).
export { valeurA };
