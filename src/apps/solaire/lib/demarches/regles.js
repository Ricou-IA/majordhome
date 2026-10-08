// src/apps/solaire/lib/demarches/regles.js
// Règles métier du parcours (spec §6.1 à 6.6, 6.10). PUR.
import { ETAPES } from './referentiel.js';
import { valeurA, TARIFS_META } from './parametres.js';

/** @typedef {{ code: string, niveau: 'info'|'avertissement'|'bloquant', message: string, cle?: string }} Alerte */

/**
 * Alerte paramètre manquant / périmé pour une clé de tarif, ou null si tout va bien.
 * @param {string} cle
 * @param {ReturnType<typeof valeurA>} resolu
 * @returns {Alerte|null}
 */
export function alerteParametre(cle, resolu) {
  const libelle = TARIFS_META[cle]?.libelle ?? cle;
  if (!resolu) {
    return { code: 'parametre_manquant', niveau: 'avertissement', cle, message: `Paramètre à renseigner : ${libelle} (Paramètres > Solaire > Démarches).` };
  }
  if (resolu.perimee) {
    return { code: 'parametre_perime', niveau: 'avertissement', cle, message: `${libelle} : la valeur en vigueur (${resolu.date_effet}) n’est valide que jusqu’au ${resolu.valide_jusqu_au}. À mettre à jour.` };
  }
  return null;
}

/**
 * Délai d'instruction selon le périmètre ABF (inconnu ⇒ prudence : 2 mois + alerte).
 * @returns {{ cle: 'instruction_dp'|'instruction_dp_abf', alertes: Alerte[] }}
 */
export function delaiInstruction(inputs) {
  if (inputs.perimetre_abf === 'non') return { cle: 'instruction_dp', alertes: [] };
  if (inputs.perimetre_abf === 'oui') {
    return {
      cle: 'instruction_dp_abf',
      alertes: [{ code: 'abf_prescriptions', niveau: 'info', message: 'Périmètre des Bâtiments de France : prescriptions possibles (panneaux noirs, pose intégrée). Échange préalable avec l’UDAP recommandé.' }],
    };
  }
  return {
    cle: 'instruction_dp_abf',
    alertes: [{ code: 'abf_a_verifier', niveau: 'avertissement', message: 'Périmètre ABF à vérifier (Atlas des patrimoines) : le délai d’instruction retenu est de 2 mois par prudence.' }],
  };
}

/** @returns {{ type: 'cacsi'|'surplus', delaiCle: 'enedis_cacsi'|'enedis_surplus' }} */
export function demarcheEnedis(inputs) {
  return inputs.mode_valorisation === 'autoconso_totale'
    ? { type: 'cacsi', delaiCle: 'enedis_cacsi' }
    : { type: 'surplus', delaiCle: 'enedis_surplus' };
}

/** @returns {'bleu'|'violet'} */
export function typeConsuel(inputs) {
  return inputs.batterie ? 'violet' : 'bleu';
}

/**
 * Contrat de rachat (obligation d'achat). Applicable en surplus seulement ;
 * éligible si installateur RGE (pose toujours en toiture).
 * @param {object} inputs
 * @param {object} params
 * @param {string} dateIso date de la demande complète (planning.depot_enedis)
 */
export function rachat(inputs, params, dateIso) {
  if (inputs.mode_valorisation !== 'autoconso_surplus') return { applicable: false, eligible: false, tarif: null, alertes: [] };
  const alertes = [];
  const eligible = inputs.installateur_rge === true;
  if (!eligible) {
    alertes.push({ code: 'oa_non_eligible', niveau: 'bloquant', message: 'Contrat de rachat non éligible : l’installateur doit être certifié RGE. Vente du surplus impossible en l’état.' });
  }
  const cle = inputs.puissance_kwc <= 9 ? 'tarif_oa_surplus_lte_9kwc' : 'tarif_oa_surplus_gt_9kwc';
  const resolu = valeurA(params.tarifs[cle], dateIso);
  const alerteP = alerteParametre(cle, resolu);
  if (alerteP) alertes.push(alerteP);
  const tarif = resolu ? { cle, valeur: resolu.valeur, unite: TARIFS_META[cle].unite, date_effet: resolu.date_effet } : null;
  return { applicable: true, eligible, tarif, alertes };
}

/**
 * Alertes liées à la situation du bien (copropriété, lotissement, compteur).
 * @returns {Alerte[]}
 */
export function alertesSituation(inputs) {
  const alertes = [];
  if (inputs.copropriete_ou_lotissement === 'copropriete') {
    alertes.push({ code: 'copropriete_ag', niveau: 'avertissement', message: 'Copropriété : l’accord de l’assemblée générale est requis avant le dépôt de la déclaration préalable.' });
  }
  if (inputs.copropriete_ou_lotissement === 'lotissement') {
    alertes.push({ code: 'lotissement_reglement', niveau: 'info', message: 'Lotissement : vérifier le règlement ou le cahier des charges (aspect, implantation).' });
  }
  if (inputs.mode_valorisation === 'autoconso_surplus' && inputs.compteur_linky === false) {
    alertes.push({ code: 'compteur_non_linky', niveau: 'avertissement', message: 'Compteur non communicant : remplacement par un Linky nécessaire, frais de raccordement à confirmer avec Enedis.' });
  }
  return alertes;
}

function libelleDelai(delai) {
  if (!delai) return null;
  if (delai.mois != null) return `${delai.mois} mois`;
  return `${delai.jours} jours`;
}

/**
 * Étapes résolues pour un projet (textes, applicabilité, délai affiché).
 * @param {object} inputs
 * @param {object} params
 * @param {{ instructionCle: string, enedisCle: string, societe?: string }} ctxCalc
 */
export function construireEtapes(inputs, params, ctxCalc) {
  const ctx = {
    societe: ctxCalc.societe || 'Votre entreprise',
    mode_valorisation: inputs.mode_valorisation,
    copropriete_ou_lotissement: inputs.copropriete_ou_lotissement,
    instructionCle: ctxCalc.instructionCle,
    enedisCle: ctxCalc.enedisCle,
  };
  return ETAPES.map((e, i) => {
    const delaiCle = e.delaiCle(ctx);
    const delai = delaiCle ? params.delais[delaiCle] : null;
    return {
      code: e.code,
      libelle: e.libelle,
      ordre: i + 1,
      applicable: e.applicable(ctx),
      client: e.client(ctx),
      installateur: e.installateur(ctx),
      tiers: e.tiers,
      delai: delai ? { cle: delaiCle, libelle: libelleDelai(delai) } : null,
    };
  });
}
