// src/lib/maintenance/echeances.js
// ============================================================================
// Règle d'échéance du module Maintenance — module PUR (aucun import), testé par
// `node --test scripts/maintenance/echeances.test.mjs`, copié pour Deno par
// `npm run sync:tournee-engine` (edge maintenance-digest). SEULE définition de
// « dû / en retard » : la borne, le suivi, l'e-mail du soir et le registre PDF
// l'importent. Spec : docs/superpowers/specs/2026-09-25-module-maintenance-taches-recurrentes-design.md § 4.
//
// Toutes les dates sont des jours calendaires 'YYYY-MM-DD' en Europe/Paris ; le
// jour d'une réalisation est le jour Paris de son `done_at`. L'arithmétique se fait
// en UTC sur des jours entiers (jamais sur l'heure locale du navigateur).
//
// Règles (décisions Eric, 2026-09-25) :
//   - jours cochés (`weekdays`) : dû chaque jour coché ; un jour manqué reste UNE
//     échéance en retard (pas d'empilement) ;
//   - intervalle (`interval`) : dernière réalisation + N jours / semaines / mois ;
//   - « pas pu faire » (`not_done`) : la tâche revient le lendemain, toutes fréquences ;
//   - jamais due avant `start_date` ; archivée ⇒ jamais due.
// ============================================================================

const TIME_ZONE = 'Europe/Paris';
const FORMAT_JOUR = new Intl.DateTimeFormat('fr-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * Jour calendaire Paris ('YYYY-MM-DD') d'un instant.
 * @param {Date|string} instant
 * @returns {string}
 */
export function jourParis(instant) {
  return FORMAT_JOUR.format(instant instanceof Date ? instant : new Date(instant));
}

/** @param {string} jour @returns {Date} minuit UTC du jour */
function versUtc(jour) {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j));
}

/** @param {Date} d @returns {string} */
function depuisUtc(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * @param {string} jour 'YYYY-MM-DD'
 * @param {number} n jours (négatif accepté)
 * @returns {string}
 */
export function ajouterJours(jour, n) {
  const d = versUtc(jour);
  d.setUTCDate(d.getUTCDate() + n);
  return depuisUtc(d);
}

/**
 * Ajoute n mois, ancré en fin de mois (31 janv. + 1 mois = dernier jour de février).
 * @param {string} jour
 * @param {number} n
 * @returns {string}
 */
export function ajouterMois(jour, n) {
  const [a, m, j] = jour.split('-').map(Number);
  const cible = new Date(Date.UTC(a, m - 1 + n, 1));
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(j, dernierJour));
  return depuisUtc(cible);
}

/**
 * Jour ISO de la semaine : 1 = lundi … 7 = dimanche.
 * @param {string} jour
 * @returns {number}
 */
export function jourIso(jour) {
  const js = versUtc(jour).getUTCDay();
  return js === 0 ? 7 : js;
}

/** Écart en jours entre deux jours calendaires (b - a). */
function ecartJours(a, b) {
  return Math.round((versUtc(b) - versUtc(a)) / 86_400_000);
}

/** Premier jour coché ≥ `depuis` (au plus 7 jours plus loin). */
function premierJourCoche(weekdays, depuis) {
  const coches = new Set((weekdays || []).map(Number));
  if (coches.size === 0) return null;
  for (let i = 0; i < 7; i += 1) {
    const jour = ajouterJours(depuis, i);
    if (coches.has(jourIso(jour))) return jour;
  }
  return null;
}

/**
 * @typedef {object} Tache
 * @property {'weekdays'|'interval'} frequency_kind
 * @property {number[]} [weekdays]
 * @property {'day'|'week'|'month'} [interval_unit]
 * @property {number} [interval_count]
 * @property {string} start_date
 * @property {string|null} [archived_at]
 */

/**
 * @typedef {object} LogRealisation
 * @property {'done'|'not_done'} status
 * @property {string} done_at
 */

/**
 * Prochaine échéance d'une tâche compte tenu de sa dernière réalisation.
 * @param {Tache} tache
 * @param {LogRealisation|null|undefined} dernierLog
 * @returns {string|null} 'YYYY-MM-DD', ou null si la tâche n'est jamais due (archivée, sans jour coché)
 */
export function prochaineEcheance(tache, dernierLog) {
  if (!tache || tache.archived_at) return null;
  const debut = tache.start_date;
  let calcul;

  if (!dernierLog) {
    calcul = tache.frequency_kind === 'weekdays' ? premierJourCoche(tache.weekdays, debut) : debut;
  } else {
    const jourLog = jourParis(dernierLog.done_at);
    if (dernierLog.status === 'not_done') {
      calcul = ajouterJours(jourLog, 1);
    } else if (tache.frequency_kind === 'weekdays') {
      calcul = premierJourCoche(tache.weekdays, ajouterJours(jourLog, 1));
    } else {
      const n = Math.max(1, Number(tache.interval_count) || 1);
      if (tache.interval_unit === 'month') calcul = ajouterMois(jourLog, n);
      else if (tache.interval_unit === 'week') calcul = ajouterJours(jourLog, 7 * n);
      else calcul = ajouterJours(jourLog, n);
    }
  }

  if (!calcul) return null;
  return calcul < debut ? debut : calcul;
}

/**
 * État d'une tâche pour un jour donné.
 * @param {Tache} tache
 * @param {LogRealisation|null|undefined} dernierLog
 * @param {string} aujourdhui 'YYYY-MM-DD'
 * @returns {{ etat: 'a_venir'|'a_faire'|'en_retard'|'archivee', echeance: string|null, joursDeRetard: number }}
 */
export function etatDuJour(tache, dernierLog, aujourdhui) {
  const echeance = prochaineEcheance(tache, dernierLog);
  if (!echeance) return { etat: 'archivee', echeance: null, joursDeRetard: 0 };
  if (echeance > aujourdhui) return { etat: 'a_venir', echeance, joursDeRetard: 0 };
  if (echeance === aujourdhui) return { etat: 'a_faire', echeance, joursDeRetard: 0 };
  return { etat: 'en_retard', echeance, joursDeRetard: ecartJours(echeance, aujourdhui) };
}

/**
 * Dernière réalisation (la plus récente par `done_at`) de chaque tâche.
 * @param {Array<LogRealisation & { task_id: string }>} logs
 * @returns {Map<string, LogRealisation & { task_id: string }>}
 */
export function dernierLogParTache(logs) {
  const parTache = new Map();
  for (const l of logs || []) {
    const actuel = parTache.get(l.task_id);
    if (!actuel || new Date(l.done_at) > new Date(actuel.done_at)) parTache.set(l.task_id, l);
  }
  return parTache;
}

/**
 * Ponctualité : part des réalisations « faites » dont le jour Paris ≤ leur échéance visée.
 * @param {Array<LogRealisation & { due_date: string }>} logs
 * @returns {{ faits: number, aLHeure: number, taux: number|null, nonFaits: number }}
 */
export function ponctualite(logs) {
  let faits = 0;
  let aLHeure = 0;
  let nonFaits = 0;
  for (const l of logs || []) {
    if (l.status === 'not_done') { nonFaits += 1; continue; }
    faits += 1;
    if (jourParis(l.done_at) <= l.due_date) aLHeure += 1;
  }
  return { faits, aLHeure, taux: faits ? aLHeure / faits : null, nonFaits };
}

/**
 * Écran du jour (borne, suivi) : tâches en retard, puis par unité les tâches à faire
 * aujourd'hui et les réalisations déjà saisies aujourd'hui. Unités et tâches archivées
 * ignorées ; unités sans rien à montrer omises.
 * @param {object} p
 * @param {Array<{id:string,name:string,sort_order?:number,archived_at?:string|null}>} p.units
 * @param {Array<Tache & {id:string,unit_id:string,label:string,sort_order?:number}>} p.tasks
 * @param {Array<LogRealisation & {task_id:string}>} p.derniersLogs dernière réalisation de chaque tâche
 * @param {Array<LogRealisation & {task_id:string}>} p.logsDuJour réalisations saisies aujourd'hui
 * @param {string} p.aujourdhui
 * @returns {{ enRetard: Array<{tache:object, unite:object, echeance:string, joursDeRetard:number, dernierLog:object|null}>,
 *   unites: Array<{ unite:object, aFaire: Array<{tache:object, echeance:string}>, faites: Array<{tache:object, log:object}> }> }}
 */
export function tableauDuJour({ units, tasks, derniersLogs, logsDuJour, aujourdhui }) {
  const actives = [...(units || [])].filter((u) => !u.archived_at)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)));
  const uniteParId = new Map(actives.map((u) => [u.id, u]));
  const derniers = dernierLogParTache(derniersLogs);
  const tachesTriees = [...(tasks || [])]
    .filter((t) => !t.archived_at && uniteParId.has(t.unit_id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.label).localeCompare(String(b.label)));
  const tacheParId = new Map(tachesTriees.map((t) => [t.id, t]));

  const enRetard = [];
  const parUnite = new Map(actives.map((u) => [u.id, { unite: u, aFaire: [], faites: [] }]));
  for (const t of tachesTriees) {
    const dernier = derniers.get(t.id) || null;
    const e = etatDuJour(t, dernier, aujourdhui);
    if (e.etat === 'en_retard') {
      enRetard.push({ tache: t, unite: uniteParId.get(t.unit_id), echeance: e.echeance, joursDeRetard: e.joursDeRetard, dernierLog: dernier });
    } else if (e.etat === 'a_faire') {
      parUnite.get(t.unit_id).aFaire.push({ tache: t, echeance: e.echeance });
    }
  }
  const duJour = [...(logsDuJour || [])].filter((l) => jourParis(l.done_at) === aujourdhui)
    .sort((a, b) => new Date(a.done_at) - new Date(b.done_at));
  for (const l of duJour) {
    const t = tacheParId.get(l.task_id);
    if (t) parUnite.get(t.unit_id).faites.push({ tache: t, log: l });
  }
  enRetard.sort((a, b) => b.joursDeRetard - a.joursDeRetard);
  return {
    enRetard,
    unites: [...parUnite.values()].filter((g) => g.aFaire.length || g.faites.length),
  };
}

const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/**
 * Libellé lisible d'une fréquence (« Du lundi au vendredi », « Toutes les 2 semaines »…).
 * @param {Tache} tache
 * @returns {string}
 */
export function decrireFrequence(tache) {
  if (tache.frequency_kind === 'weekdays') {
    const jours = [...new Set((tache.weekdays || []).map(Number))].sort((a, b) => a - b);
    if (jours.length === 7) return 'Tous les jours';
    if (jours.join(',') === '1,2,3,4,5') return 'Du lundi au vendredi';
    return jours.map((j) => JOURS_COURTS[j - 1]).join(', ');
  }
  const n = Math.max(1, Number(tache.interval_count) || 1);
  if (tache.interval_unit === 'week') return n === 1 ? 'Toutes les semaines' : `Toutes les ${n} semaines`;
  if (tache.interval_unit === 'month') return n === 1 ? 'Tous les mois' : `Tous les ${n} mois`;
  return n === 1 ? 'Tous les jours' : `Tous les ${n} jours`;
}
