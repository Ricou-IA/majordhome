// src/apps/solaire/lib/demarches/planning.js
// Planning prévisionnel des démarches (spec §6.7). PUR, dates ISO YYYY-MM-DD en UTC.
// Les étapes 4 (recours des tiers) et 5 (Enedis) se chevauchent : la demande Enedis
// part dès l'accord de la DP. La pose ne peut commencer qu'après les deux.
import { DELAIS_META } from './parametres.js';

const JOUR_MS = 86_400_000;

function parse(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(dt) {
  return dt.toISOString().slice(0, 10);
}

/**
 * Ajoute un délai. Les mois sont calendaires (31/01 + 1 mois = 28/02).
 * @param {string} iso
 * @param {{ jours?: number, mois?: number }} delai
 * @returns {string}
 */
export function ajouterDelai(iso, delai = {}) {
  let dt = parse(iso);
  const mois = Number(delai.mois) || 0;
  const jours = Number(delai.jours) || 0;
  if (mois) {
    const jour = dt.getUTCDate();
    const cible = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + mois, 1));
    const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
    dt = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth(), Math.min(jour, dernierJour)));
  }
  if (jours) dt = new Date(dt.getTime() + jours * JOUR_MS);
  return format(dt);
}

/** Lundi de la prochaine semaine ouvrée (un lundi est conservé). */
export function lundiSuivant(iso) {
  const dt = parse(iso);
  const jour = dt.getUTCDay(); // 0 = dimanche, 1 = lundi
  const delta = jour === 1 ? 0 : (8 - jour) % 7;
  return format(new Date(dt.getTime() + delta * JOUR_MS));
}

/** La plus tardive de deux dates ISO. */
export function maxIso(a, b) {
  return a >= b ? a : b;
}

function libelleDelai(cle, delai) {
  const meta = DELAIS_META[cle];
  const n = delai.mois ?? delai.jours;
  const unite = delai.mois != null ? 'mois' : 'jours';
  return `${meta ? meta.libelle : cle} : ${n} ${unite}`;
}

/**
 * @param {{ date_depart: string, instructionCle: 'instruction_dp'|'instruction_dp_abf', enedisCle: 'enedis_cacsi'|'enedis_surplus' }} ctx
 * @param {{ delais: Record<string, { jours?: number, mois?: number }> }} params
 */
export function calculerPlanning(ctx, params) {
  const d = params.delais;
  const depot_dp = ajouterDelai(ctx.date_depart, d.depot_dp);
  const accord_dp = ajouterDelai(depot_dp, d[ctx.instructionCle]);
  const fin_recours = ajouterDelai(accord_dp, d.recours_tiers);
  const depot_enedis = accord_dp;
  const reponse_enedis = ajouterDelai(depot_enedis, d[ctx.enedisCle]);
  const pose_au_plus_tot = lundiSuivant(maxIso(fin_recours, reponse_enedis));
  const fin_pose = ajouterDelai(pose_au_plus_tot, d.duree_pose);
  const attestation_consuel = ajouterDelai(fin_pose, d.consuel);
  const mise_en_service_au_plus_tard = ajouterDelai(attestation_consuel, d.mise_en_service);
  const dureeJours = (parse(mise_en_service_au_plus_tard) - parse(ctx.date_depart)) / JOUR_MS;
  const duree_totale_mois = Math.round((dureeJours / 30.44) * 10) / 10;

  const hypotheses = [
    libelleDelai('depot_dp', d.depot_dp),
    libelleDelai(ctx.instructionCle, d[ctx.instructionCle]),
    libelleDelai('recours_tiers', d.recours_tiers),
    libelleDelai(ctx.enedisCle, d[ctx.enedisCle]),
    'Demande Enedis déposée dès l’accord de la DP, en parallèle du recours des tiers',
    'Pose au lundi suivant la fin du recours et la réponse Enedis',
    libelleDelai('duree_pose', d.duree_pose),
    libelleDelai('consuel', d.consuel),
    libelleDelai('mise_en_service', d.mise_en_service),
    'Délais indicatifs',
  ];

  return {
    depot_dp, accord_dp, fin_recours, depot_enedis, reponse_enedis,
    pose_au_plus_tot, fin_pose, attestation_consuel, mise_en_service_au_plus_tard,
    duree_totale_mois, hypotheses,
  };
}
