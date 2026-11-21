/**
 * planningCouloirs.js — couloirs par personne dans la grille horaire du planning
 * ============================================================================
 * FullCalendar (version libre) range les RDV qui se chevauchent dans l'ordre où ils
 * arrivent : la même personne se retrouve à gauche un jour, à droite le lendemain.
 * La vue « une colonne par ressource » est payante. Ici, on calcule nous-mêmes la
 * place horizontale de chaque bloc :
 *   - dans un jour, UN couloir par personne qui y a au moins un bloc, toujours dans
 *     le même ordre (techniciens d'abord, puis les autres, par ordre alphabétique) ;
 *   - une personne sans bloc ce jour-là n'a pas de couloir (la place va aux autres) ;
 *   - deux blocs de la même personne qui se chevauchent (un RDV annulé et son
 *     remplaçant) se partagent son couloir.
 * La place est portée par une classe `mdh-c-<gauche>-<droite>` (en millièmes de la
 * largeur du jour) ; `cssDesCouloirs` rend les règles CSS qui l'imposent au cadre
 * que FullCalendar positionne (cf. Planning.jsx).
 *
 * Module PUR : aucun import React / Supabase / alias. Testé par
 * scripts/planning-couloirs.test.mjs.
 * ============================================================================
 */

/** Couloir des blocs que personne ne porte (membre désactivé, RDV sans personne). */
const SANS_PERSONNE = '__sans_personne__';

const CLASSE = /^mdh-c-(\d+)-(\d+)$/;

/**
 * Ordre des couloirs : les personnes qui portent des interventions d'abord, puis les
 * autres ; dans chaque groupe, l'ordre de la liste d'équipe (alphabétique).
 * @param {Array<{ profileKey: string, kinds?: { intervention?: boolean } }>} teamList
 * @returns {string[]} clés de profil, dans l'ordre des couloirs
 */
export function ordreDesCouloirs(teamList = []) {
  const terrain = teamList.filter((h) => h.kinds?.intervention);
  const autres = teamList.filter((h) => !h.kinds?.intervention);
  return [...terrain, ...autres].map((h) => h.profileKey);
}

/**
 * Sous-colonnes des blocs d'UNE personne sur UN jour : les blocs qui se chevauchent
 * (de proche en proche) forment un groupe, partagé en autant de sous-colonnes qu'il
 * en faut ; un bloc seul sur son créneau prend tout le couloir.
 * @returns {Map<string, { rang: number, sur: number }>}
 */
function sousColonnes(blocs) {
  const tries = [...blocs].sort((a, b) => a.debut - b.debut || b.fin - a.fin || String(a.id).localeCompare(String(b.id)));
  const places = new Map();
  let groupe = [];
  let finGroupe = -Infinity;
  let finsColonnes = [];
  const clore = () => {
    for (const b of groupe) places.get(b.id).sur = finsColonnes.length;
  };
  for (const b of tries) {
    if (b.debut >= finGroupe) {
      clore();
      groupe = [];
      finsColonnes = [];
      finGroupe = -Infinity;
    }
    let rang = finsColonnes.findIndex((fin) => fin <= b.debut);
    if (rang === -1) rang = finsColonnes.length;
    finsColonnes[rang] = b.fin;
    places.set(b.id, { rang, sur: 1 });
    groupe.push(b);
    finGroupe = Math.max(finGroupe, b.fin);
  }
  clore();
  return places;
}

/**
 * Place horizontale de chaque bloc.
 * @param {Array<{ id: string, jour: string, debut: number, fin: number, personne: (string|null) }>} blocs
 *   `debut` / `fin` en minutes depuis minuit ; `personne` = clé de profil.
 * @param {string[]} ordre clés de profil dans l'ordre des couloirs (cf. ordreDesCouloirs)
 * @returns {Map<string, { gauche: number, droite: number }>} marges en millièmes de la
 *   largeur du jour (gauche = distance au bord gauche, droite = distance au bord droit)
 */
export function placerEnCouloirs(blocs = [], ordre = []) {
  const rangDe = new Map(ordre.map((cle, i) => [cle, i]));
  const parJour = new Map();
  for (const b of blocs) {
    const cle = b.personne || SANS_PERSONNE;
    if (!parJour.has(b.jour)) parJour.set(b.jour, new Map());
    const jour = parJour.get(b.jour);
    if (!jour.has(cle)) jour.set(cle, []);
    // Un bloc sans durée lisible occupe au moins une minute : il garde sa place.
    jour.get(cle).push({ ...b, fin: Math.max(b.fin, b.debut + 1) });
  }

  const places = new Map();
  for (const jour of parJour.values()) {
    const couloirs = [...jour.keys()].sort((a, b) => {
      const ra = rangDe.has(a) ? rangDe.get(a) : (a === SANS_PERSONNE ? Infinity : ordre.length);
      const rb = rangDe.has(b) ? rangDe.get(b) : (b === SANS_PERSONNE ? Infinity : ordre.length);
      if (ra !== rb) return ra < rb ? -1 : 1;
      return a.localeCompare(b);
    });
    const n = couloirs.length;
    couloirs.forEach((cle, i) => {
      const sous = sousColonnes(jour.get(cle));
      for (const [id, { rang, sur }] of sous) {
        const gauche = Math.round(((i + rang / sur) / n) * 1000);
        const droite = 1000 - Math.round(((i + (rang + 1) / sur) / n) * 1000);
        places.set(id, { gauche, droite });
      }
    });
  }
  return places;
}

/** Classe CSS qui porte la place d'un bloc. */
export function classeDeCouloir({ gauche, droite }) {
  return `mdh-c-${gauche}-${droite}`;
}

/**
 * Règles CSS des places utilisées par ces events. Elles visent le cadre que
 * FullCalendar positionne (style en ligne `left` / `right`), d'où `!important`.
 * @param {Array<{ classNames?: string[] }>} events
 * @returns {string}
 */
export function cssDesCouloirs(events = []) {
  const vues = new Set();
  for (const e of events) {
    for (const c of e.classNames || []) if (CLASSE.test(c)) vues.add(c);
  }
  return [...vues].sort().map((c) => {
    const [, gauche, droite] = c.match(CLASSE);
    return `.fc .fc-timegrid-event-harness:has(> .${c}),.fc .fc-timegrid-bg-harness:has(> .${c})`
      + `{left:${gauche / 10}% !important;right:${droite / 10}% !important}`;
  }).join('\n');
}

/** Minutes depuis minuit d'une heure « HH:MM[:SS] » ; null si illisible. */
export function minutesDe(heure) {
  const m = /^(\d{1,2}):(\d{2})/.exec(heure || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
