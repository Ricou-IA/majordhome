// src/lib/tournee/plein.js
// ============================================================================
// « Journée pleine par code » (spec 2026-09-12 « bloc contrat et journée
// pleine », R2). Module PUR — Node, Vite, Deno (copie _shared synchronisée).
// Testé : node --test scripts/tournee/plein.test.mjs
//
// Une journée est pleine quand il n'y rentre plus rien : le reste utile
// (budget + dépassement toléré − travail − trajets) est en dessous de la plus
// petite visite possible (`reste_utile_min_minutes`). Le budget est du temps
// d'homme (travail + route, comme dans `simuler`) : la pause n'en fait pas
// partie. Décision Eric :
// une journée pleine se fige tout de suite — « si c'est plein depuis 10 jours,
// pourquoi attendre la veille ? ». Une journée non pleine reste adaptable.
// ============================================================================
import { diagnostiquerJournee, sequencerTournee } from './sequence.js';
import { construireArretsPourConsolidation, TYPES_ADAPTABLES } from './arrets.js';
import { cleCoord } from './geo.js';

/**
 * @param {object} p
 * @param {Array<object>} p.arrets   construireArretsPourConsolidation(...)
 * @param {Function} p.trajet        (keyA, keyB) → minutes
 * @param {string} p.depotKey
 * @param {number} p.budgetMinutes         daily_work_minutes du technicien
 * @param {number} [p.depassementMinutes=0]  réglage depassement_journee_minutes
 * @param {number} p.resteUtileMinMinutes   réglage reste_utile_min_minutes
 * @returns {{ pleine: boolean, vide: boolean, resteUtileMinutes: number, chargeMinutes: number,
 *   travailMinutes: number, trajetsMinutes: number, budgetTolereMinutes: number }}
 */
export function evaluerRemplissage({
  arrets, trajet, depotKey, budgetMinutes, depassementMinutes = 0, resteUtileMinMinutes,
}) {
  const budgetTolereMinutes = budgetMinutes + depassementMinutes;
  if (!arrets || arrets.length === 0) {
    return {
      pleine: false, vide: true, resteUtileMinutes: budgetTolereMinutes, chargeMinutes: 0,
      travailMinutes: 0, trajetsMinutes: 0, budgetTolereMinutes,
    };
  }
  const d = diagnostiquerJournee(arrets, { depotKey, trajet, budgetMinutes: budgetTolereMinutes, pause: { minutes: 0 } });
  const chargeMinutes = d.chargeMinutes;
  const resteUtileMinutes = budgetTolereMinutes - chargeMinutes;
  return {
    pleine: resteUtileMinutes < resteUtileMinMinutes,
    vide: false,
    resteUtileMinutes,
    chargeMinutes,
    travailMinutes: d.travailMinutes,
    trajetsMinutes: d.trajetsMinutes,
    budgetTolereMinutes,
  };
}

/** Même lecture que souplesseEffective (souplesse.js) : type concerné, pas figé, souplesse > 0. */
export function rdvAdaptable(rdv, flexDefaut) {
  if (!TYPES_ADAPTABLES.includes(rdv?.appointment_type)) return false;
  if (rdv?.hour_confirmed_at) return false;
  return (rdv?.time_flex_minutes ?? flexDefaut) > 0;
}

/**
 * Verdict d'une journée pour le figeage automatique (R2/R3) — la même
 * mécanique dans l'edge `tournees-figer` (avec la matrice Mapbox) et dans
 * l'onglet Tournées (alerte « à arbitrer », trajets estimés).
 *
 * @param {object} p
 * @param {{ date: string, rdvs: Array<object>, amplitude: {debut:number, fin:number}, budgetMinutes: number }} p.journee
 * @param {{ lat: number, lng: number }} p.depot
 * @param {object} p.reglages   construireReglages(settings)
 * @param {Function} p.trajet   (keyA, keyB) → minutes
 * @returns {{ verdict: 'sans_adaptable'|'non_pleine'|'figeable'|'a_arbitrer', adaptables: number,
 *   remplissage: ReturnType<typeof evaluerRemplissage>|null,
 *   sequence: ReturnType<typeof sequencerTournee>|null }}
 */
export function verdictJournee({ journee, depot, reglages, trajet }) {
  const flexDefaut = reglages.souplesse_defaut_minutes ?? 0;
  const rdvs = (journee.rdvs || []).filter((r) => r.status !== 'cancelled');
  const adaptables = rdvs.filter((r) => rdvAdaptable(r, flexDefaut)).length;
  if (rdvs.length === 0 || adaptables === 0) return { verdict: 'sans_adaptable', adaptables, remplissage: null, sequence: null };
  const arrets = construireArretsPourConsolidation(rdvs, depot, {
    souplesse: true, flexDefaut, amplitude: journee.amplitude, demiJournee: reglages.demi_journee,
  });
  const depotKey = cleCoord(depot) ?? '';
  const depassementMinutes = reglages.depassement_journee_minutes ?? 0;
  const remplissage = evaluerRemplissage({
    arrets, trajet, depotKey, budgetMinutes: journee.budgetMinutes, depassementMinutes,
    resteUtileMinMinutes: reglages.reste_utile_min_minutes ?? 75,
  });
  if (!remplissage.pleine) return { verdict: 'non_pleine', adaptables, remplissage, sequence: null };
  const sequence = sequencerTournee({
    depotKey, arrets, trajet, amplitude: journee.amplitude,
    budgetMinutes: journee.budgetMinutes + depassementMinutes,
    pause: { minutes: reglages.pause_minutes ?? 0, fenetre: [(reglages.pause_fenetre?.[0] ?? 12) * 60, (reglages.pause_fenetre?.[1] ?? 14) * 60] },
    figesSontDesFaits: true,
  });
  return { verdict: sequence.faisable ? 'figeable' : 'a_arbitrer', adaptables, remplissage, sequence };
}
