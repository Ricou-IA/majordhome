// src/apps/solaire/lib/demarchesInputs.js
// Assemble les entrées du moteur Démarches depuis l'état du wizard et le dossier PV.
// Les DÉRIVÉS (commune, puissance, batterie, ABF, RGE) viennent toujours du wizard/dossier,
// jamais d'un résultat figé : changer de scénario change la puissance. Les SAISIES (mode de
// valorisation, copropriété, Linky, date de départ, prise en charge, devis) sont reprises de
// pv_dossiers.demarches.inputs quand elles existent. PUR : aucun import React/Supabase.
import { docsGeneratedAt } from './dossierDocuments.js';

/**
 * Point de départ du planning : date de génération des documents du dossier (dossier validé),
 * sinon aujourd'hui.
 * @param {object|null} dossier
 * @param {string} aujourdhui ISO YYYY-MM-DD
 */
export function dateDepartParDefaut(dossier, aujourdhui) {
  if (!dossier || dossier.status === 'offre') return aujourdhui;
  const gen = docsGeneratedAt(dossier.documents);
  return typeof gen === 'string' && gen.length >= 10 ? gen.slice(0, 10) : aujourdhui;
}

/**
 * @param {{ state: object, dossier: object|null, activeKwc: number, company: object, aujourdhui: string }} p
 */
export function assemblerInputsDemarches({ state, dossier, activeKwc, company, aujourdhui }) {
  const saisies = dossier?.demarches?.inputs ?? {};
  const cadastreDossier = dossier?.cadastre;
  const cadastreWizard = Array.isArray(state?.cadastre) ? state.cadastre[0] : null;
  return {
    commune_insee: cadastreDossier?.commune_insee ?? cadastreWizard?.code_insee ?? null,
    commune_nom: cadastreDossier?.nom_com ?? cadastreWizard?.nom_com ?? null,
    puissance_kwc: Number(activeKwc) || 0,
    batterie: state?.optim?.batteryOn === true,
    abf: dossier?.abf ?? state?.abf ?? null,
    installateur_rge: (company?.rgeCertifications?.length ?? 0) > 0,
    mode_valorisation: saisies.mode_valorisation ?? 'autoconso_surplus',
    copropriete_ou_lotissement: saisies.copropriete_ou_lotissement ?? 'aucun',
    compteur_linky: saisies.compteur_linky ?? true,
    date_depart: saisies.date_depart ?? dateDepartParDefaut(dossier, aujourdhui),
    prise_en_charge: saisies.prise_en_charge ?? {},
    devis: { numero: saisies.devis?.numero ?? '', date: saisies.devis?.date ?? '' },
  };
}
