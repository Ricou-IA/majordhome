// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/tournee/auto-rdv.js — ne pas éditer.
// ============================================================================
// Auto-RDV — l'offre faite au client — module PUR (aucun import React / Supabase).
// Spec 2026-09-29 « auto-RDV d'entretien mensuel » § 4.2. Partagé navigateur /
// Deno (copie par `npm run sync:tournee-engine`, consommé par l'edge `auto-rdv`).
//
// Règles gravées (décisions Eric, 2026-09-29) :
// - le client choisit une DEMI-JOURNÉE (reglages.demi_journee), jamais une heure ;
// - horizon = mois en cours, borne dure : aucune journée du mois suivant ;
// - une journée est proposable si elle porte un secteur (étiquette ou déduit des
//   entretiens déjà posés) et n'est pas figée — une journée vide sans étiquette
//   n'est pas proposée (l'étiquetage machine des journées vides = cron) ;
// - l'arrivée ET le départ du contrat tiennent dans la demi-journée, et la pose
//   ne déplace aucun voisin (pas de souplesse « écrite » depuis la page client).
// ============================================================================

import { deduireSecteur } from './etat.js';
import { construireArretsExistants } from './arrets.js';
import { placerCandidat, chargeExistante } from './creneaux.js';
import { cleCoord } from './geo.js';

const STATUTS_EXCLUS = new Set(['cancelled', 'no_show']);

/** `YYYY-MM-DD` d'une Date UTC. */
function iso(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Bornes de l'offre pour un jour donné : de `aujourdhui + delaiMinJours` au
 * dernier jour du mois d'`aujourdhui`. Si le délai déborde du mois, `debut > fin`
 * et aucune journée n'est proposable (le mois est fini).
 *
 * @param {string} aujourdhui  `YYYY-MM-DD` (Europe/Paris côté appelant)
 * @param {{ delaiMinJours?: number }} [opts]
 * @returns {{ debut: string, fin: string }}
 */
export function bornesMois(aujourdhui, { delaiMinJours = 2 } = {}) {
  const [y, m, d] = aujourdhui.split('-').map(Number);
  const debut = new Date(Date.UTC(y, m - 1, d + Math.max(0, delaiMinJours)));
  const fin = new Date(Date.UTC(y, m, 0)); // jour 0 du mois suivant = dernier jour du mois
  return { debut: iso(debut), fin: iso(fin) };
}

/**
 * Les deux demi-journées de l'org, en minutes depuis minuit.
 * @param {{ demi_journee?: { matin?: [number, number], apres_midi?: [number, number] } }} reglages
 * @returns {Array<{ code: 'matin'|'apres_midi', debut: number, fin: number }>}
 */
export function demiJournees(reglages) {
  const dj = reglages?.demi_journee || {};
  const matin = dj.matin || [8, 12];
  const aprem = dj.apres_midi || [13, 18];
  return [
    { code: 'matin', debut: matin[0] * 60, fin: matin[1] * 60 },
    { code: 'apres_midi', debut: aprem[0] * 60, fin: aprem[1] * 60 },
  ];
}

/**
 * Empreinte d'une journée : `id@HH:MM` de ses RDV non annulés, triés par id.
 * ⚠️ Même formule que la RPC `auto_rdv_poser` (string_agg … ORDER BY id) :
 * si l'une change, l'autre aussi, sinon toute pose est refusée `journee_modifiee`.
 *
 * @param {Array<{ id: string, scheduled_start?: string, status?: string }>|null|undefined} rdvs
 * @returns {string}
 */
export function empreinteJournee(rdvs) {
  return (rdvs || [])
    .filter((r) => !STATUTS_EXCLUS.has(r.status))
    .map((r) => `${r.id}@${String(r.scheduled_start || '').slice(0, 5)}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join(',');
}

/**
 * Journées qu'on peut proposer au client : dans les bornes, non figées, et
 * porteuses d'un secteur (étiquette `journees_secteur.grand_secteur`, sinon
 * secteur déduit des entretiens déjà posés).
 *
 * @param {{ journees: Array<object>, etiquettes: Array<{ date: string, team_member_id: string, grand_secteur?: string|null, figee_at?: string|null }>, bornes: { debut: string, fin: string } }} p
 * @returns {Array<{ journee: object, secteur: string, figee: false }>}
 */
export function journeesProposables({ journees, etiquettes, bornes }) {
  const parCle = new Map((etiquettes || []).map((e) => [`${e.date}|${e.team_member_id}`, e]));
  const out = [];
  for (const j of journees || []) {
    if (j.date < bornes.debut || j.date > bornes.fin) continue;
    const e = parCle.get(`${j.date}|${j.technicienId}`);
    if (e?.figee_at) continue;
    const secteur = (e?.grand_secteur && String(e.grand_secteur).trim()) || deduireSecteur(j.rdvs);
    if (!secteur) continue;
    out.push({ journee: j, secteur, figee: false });
  }
  return out;
}

/**
 * Place un candidat dans une demi-journée précise : `placerCandidat` borné à
 * l'arrivée dans la demi-journée, puis refus si le départ en sort ou si la pose
 * supposait un voisin déplacé.
 *
 * @param {{ arrets: Array<object>, candidat: { id: string, key: string|null, dureeMinutes: number }, demi: { code: string, debut: number, fin: number }, ctx: { trajet: Function, depotKey: string, amplitude: { debut: number, fin: number }, budgetMinutes: number, pause: { minutes: number, fenetre: [number, number] }, trajetMaxMinutes?: number|null } }} p
 * @returns {{ faisable: boolean, raison: string|null, arriveeMinutes: number|null, departMinutes: number|null, coutMinutes: number|null }}
 */
export function placerDansDemiJournee({ arrets, candidat, demi, ctx }) {
  const chargeDeja = chargeExistante(arrets, { trajet: ctx.trajet, depotKey: ctx.depotKey });
  const place = placerCandidat({
    arrets,
    candidat,
    trajet: ctx.trajet,
    depotKey: ctx.depotKey,
    amplitude: ctx.amplitude,
    budgetMinutes: ctx.budgetMinutes,
    pause: ctx.pause,
    chargeDeja,
    fenetreArrivee: { min: demi.debut, max: demi.fin - candidat.dureeMinutes },
    trajetMaxMinutes: ctx.trajetMaxMinutes ?? null,
  });
  if (!place.faisable) {
    return { faisable: false, raison: place.raison || 'creneau', arriveeMinutes: null, departMinutes: null, coutMinutes: null };
  }
  if (place.departMinutes > demi.fin) {
    return { faisable: false, raison: 'demi_journee', arriveeMinutes: place.arriveeMinutes, departMinutes: place.departMinutes, coutMinutes: place.coutMinutes };
  }
  if ((place.decalages || []).length > 0) {
    return { faisable: false, raison: 'decalage', arriveeMinutes: place.arriveeMinutes, departMinutes: place.departMinutes, coutMinutes: place.coutMinutes };
  }
  return { faisable: true, raison: null, arriveeMinutes: place.arriveeMinutes, departMinutes: place.departMinutes, coutMinutes: place.coutMinutes };
}

/** `HH:MM` depuis des minutes depuis minuit. */
function hhmm(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Les créneaux (journée × demi-journée) où le contrat s'insère encore, triés :
 * secteur du contrat d'abord, puis date, puis matin avant après-midi, puis coût ;
 * tronqués à `maxCreneaux`.
 *
 * @param {{ contrat: { id: string, dureeMinutes: number, lat: number|null, lng: number|null }, proposables: Array<{ journee: object, secteur: string }>, depot: { lat: number, lng: number }, reglages: object, trajet: Function, secteurContrat?: string|null, maxCreneaux?: number }} p
 * @returns {{ creneaux: Array<{ id: string, date: string, demi: string, technicienId: string, technicienNom: string, secteur: string, propre: boolean, debutMinutes: number, finMinutes: number, debut: string, fin: string, coutMinutes: number, empreinte: string }>, refus: Record<string, number> }}
 */
export function creneauxPourContrat({ contrat, proposables, depot, reglages, trajet, secteurContrat = null, maxCreneaux = 6 }) {
  const depotKey = cleCoord(depot) ?? '';
  const candidat = { id: contrat.id, key: cleCoord(contrat), dureeMinutes: contrat.dureeMinutes };
  const pause = {
    minutes: reglages.pause_minutes ?? 0,
    fenetre: [(reglages.pause_fenetre?.[0] ?? 12) * 60, (reglages.pause_fenetre?.[1] ?? 14) * 60],
  };
  const flexDefaut = reglages.souplesse_defaut_minutes ?? 0;
  const demis = demiJournees(reglages);
  const refus = {};
  const creneaux = [];
  for (const { journee: j, secteur } of proposables || []) {
    // Tolérance PONCTUELLE (souplesse non demandée) : la page client n'écrit
    // jamais de décalage, donc le moteur ne doit pas en supposer — sinon il
    // préfère glisser le voisin de 9 h plutôt que poser après lui, et refuse.
    // Même choix que le remplissage de journée (classerParCreneaux).
    const arrets = construireArretsExistants(j.rdvs, depot, {
      flexDefaut, amplitude: j.amplitude, demiJournee: reglages.demi_journee,
    });
    const ctx = {
      trajet, depotKey, amplitude: j.amplitude,
      budgetMinutes: (j.budgetMinutes || 0) + (reglages.depassement_journee_minutes ?? 0),
      pause, trajetMaxMinutes: reglages.trajet_max_entre_clients_minutes ?? null,
    };
    const empreinte = empreinteJournee(j.rdvs);
    for (const demi of demis) {
      const r = placerDansDemiJournee({ arrets, candidat, demi, ctx });
      if (!r.faisable) {
        refus[r.raison] = (refus[r.raison] || 0) + 1;
        continue;
      }
      creneaux.push({
        id: `${j.date}|${j.technicienId}|${demi.code}`,
        date: j.date,
        demi: demi.code,
        technicienId: j.technicienId,
        technicienNom: j.technicienNom,
        secteur,
        propre: !!secteurContrat && secteur === secteurContrat,
        debutMinutes: r.arriveeMinutes,
        finMinutes: r.departMinutes,
        debut: hhmm(r.arriveeMinutes),
        fin: hhmm(r.departMinutes),
        coutMinutes: r.coutMinutes,
        empreinte,
      });
    }
  }
  const rangDemi = { matin: 0, apres_midi: 1 };
  creneaux.sort((a, b) => (
    (b.propre - a.propre)
    || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    || (rangDemi[a.demi] - rangDemi[b.demi])
    || (a.coutMinutes - b.coutMinutes)
  ));
  return { creneaux: creneaux.slice(0, maxCreneaux), refus };
}
