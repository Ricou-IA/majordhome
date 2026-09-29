// ============================================================================
// Auto-RDV — l'offre faite au client — module PUR (aucun import React / Supabase).
// Spec 2026-09-29 « auto-RDV d'entretien mensuel » § 4.2. Partagé navigateur /
// Deno (copie par `npm run sync:tournee-engine`, consommé par l'edge `auto-rdv`).
//
// Règles gravées (décisions Eric, 2026-09-29 / 30) :
// - le client choisit une DEMI-JOURNÉE (reglages.demi_journee), jamais une heure ;
// - horizon = mois en cours, prolongé au mois suivant s'il reste < 7 jours ;
// - une journée est proposable si elle porte un secteur (étiquette ou déduit des
//   entretiens déjà posés) et n'est pas figée — une journée vide sans étiquette
//   n'est pas proposée (l'étiquetage machine des journées vides = cron) ;
// - **la journée entière est réordonnancée avec le contrat en plus** (Eric,
//   2026-09-30 : « on pourrait attendre du modèle qu'il configure mieux la
//   journée avec les critères ») : chaque entretien déjà posé glisse dans SA
//   souplesse (time_flex_minutes, ancré sur l'heure annoncée), les figés ne
//   bougent pas, le contrat est contraint à la demi-journée choisie, budget et
//   retour au dépôt (tolérance) vérifiés par `sequencerTournee`. Les décalages
//   des voisins sont renvoyés et ÉCRITS avec la pose (RPC, tout ou rien).
// ============================================================================

import { deduireSecteur } from './etat.js';
import { construireArretsPourConsolidation, minutesVersHeure } from './arrets.js';
import { sequencerTournee } from './sequence.js';
import { cleCoord } from './geo.js';

const STATUTS_EXCLUS = new Set(['cancelled', 'no_show']);

/** `YYYY-MM-DD` d'une Date UTC. */
function iso(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Bornes de l'offre pour un jour donné : de `aujourdhui + delaiMinJours` au
 * dernier jour du mois d'`aujourdhui`. **Fin de mois** : s'il reste moins de
 * `prolongerSiResteMoins` jours (7, comme l'expiration du lien), l'offre s'étend
 * au dernier jour du mois SUIVANT — sinon un lien ouvert le 29 ne propose rien
 * (vécu le 2026-09-29). Ça n'expose que des journées déjà amorcées ou étiquetées
 * (`journeesProposables`), jamais une journée vierge du mois suivant.
 *
 * @param {string} aujourdhui  `YYYY-MM-DD` (Europe/Paris côté appelant)
 * @param {{ delaiMinJours?: number, prolongerSiResteMoins?: number }} [opts]
 * @returns {{ debut: string, fin: string }}
 */
export function bornesMois(aujourdhui, { delaiMinJours = 2, prolongerSiResteMoins = 7 } = {}) {
  const [y, m, d] = aujourdhui.split('-').map(Number);
  const debut = new Date(Date.UTC(y, m - 1, d + Math.max(0, delaiMinJours)));
  const dernierJour = new Date(Date.UTC(y, m, 0)).getUTCDate(); // jour 0 du mois suivant = dernier jour du mois
  const prolonger = dernierJour - d < prolongerSiResteMoins;
  const fin = new Date(Date.UTC(y, prolonger ? m + 1 : m, 0));
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

/** Minutes depuis minuit d'une heure `HH:MM[:SS]`. */
function minutesDe(hhmm) {
  const s = String(hhmm || '');
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
}

/**
 * Contexte de séquencement d'une journée depuis les réglages de l'org.
 * @param {object} journee  `{ amplitude, budgetMinutes }`
 * @param {object} reglages
 * @param {{ lat: number, lng: number }} depot
 * @param {Function} trajet
 */
function contexteSequencement(journee, reglages, depot, trajet) {
  return {
    depotKey: cleCoord(depot) ?? '',
    trajet,
    amplitude: journee.amplitude,
    budgetMinutes: (journee.budgetMinutes || 0) + (reglages.depassement_journee_minutes ?? 0),
    pause: {
      minutes: reglages.pause_minutes ?? 0,
      fenetre: [(reglages.pause_fenetre?.[0] ?? 12) * 60, (reglages.pause_fenetre?.[1] ?? 14) * 60],
    },
    toleranceRetourMinutes: reglages.tolerance_retour_depot_minutes ?? 0,
    figesSontDesFaits: true,
  };
}

/**
 * Place le contrat dans une demi-journée en RÉORDONNANÇANT la journée : les
 * entretiens déjà posés glissent dans leur souplesse (ancrée sur l'heure
 * annoncée), les figés restent, le contrat est contraint à la demi-journée.
 *
 * @param {{ journee: object, contrat: { id: string, lat: number|null, lng: number|null, dureeMinutes: number }, demi: { code: string, debut: number, fin: number }, depot: { lat: number, lng: number }, reglages: object, trajet: Function }} p
 * @returns {{ faisable: boolean, raison: string|null, arriveeMinutes: number|null, departMinutes: number|null, coutMinutes: number|null,
 *   decalages: Array<{ id: string, attendu: string, scheduled_start: string, scheduled_end: string, duration_minutes: number }> }}
 *   `raison` ∈ position · demi_journee · fenetre · budget · amplitude · trajet.
 */
export function placerParSequencement({ journee, contrat, demi, depot, reglages, trajet }) {
  const key = cleCoord(contrat);
  if (!key) return { faisable: false, raison: 'position', arriveeMinutes: null, departMinutes: null, coutMinutes: null, decalages: [] };
  const duree = contrat.dureeMinutes || 0;
  const rdvs = (journee.rdvs || []).filter((r) => !STATUTS_EXCLUS.has(r.status));
  const flexDefaut = reglages.souplesse_defaut_minutes ?? 0;
  const arrets = construireArretsPourConsolidation(rdvs, depot, {
    souplesse: true, flexDefaut, amplitude: journee.amplitude, demiJournee: reglages.demi_journee,
  });
  // Le contrat : n'importe où dans la demi-journée, à condition d'y FINIR.
  const finMax = Math.min(demi.fin, journee.amplitude?.fin ?? demi.fin) - duree;
  if (finMax < demi.debut) {
    return { faisable: false, raison: 'demi_journee', arriveeMinutes: null, departMinutes: null, coutMinutes: null, decalages: [] };
  }
  const candidat = { id: contrat.id, key, dureeMinutes: duree, fenetre: { debut: demi.debut, fin: finMax }, prevu: demi.debut };
  const ctx = contexteSequencement(journee, reglages, depot, trajet);

  const sans = sequencerTournee({ ...ctx, arrets });
  const avec = sequencerTournee({ ...ctx, arrets: [...arrets, candidat] });
  if (!avec.faisable) {
    return { faisable: false, raison: avec.raison || 'fenetre', arriveeMinutes: null, departMinutes: null, coutMinutes: null, decalages: [] };
  }
  const moi = avec.planning.find((p) => p.id === contrat.id);
  if (!moi) return { faisable: false, raison: 'fenetre', arriveeMinutes: null, departMinutes: null, coutMinutes: null, decalages: [] };

  // Trajet maximum : le DÉTOUR ajouté entre les deux voisins clients (dépôt exempté).
  const max = reglages.trajet_max_entre_clients_minutes ?? null;
  if (max != null) {
    const parId = new Map(arrets.map((a) => [a.id, a]));
    const i = avec.ordre.indexOf(contrat.id);
    const avant = i > 0 ? parId.get(avec.ordre[i - 1]) : null;
    const apres = i < avec.ordre.length - 1 ? parId.get(avec.ordre[i + 1]) : null;
    const allee = avant?.key ? trajet(avant.key, key) : 0;
    const retour = apres?.key ? trajet(key, apres.key) : 0;
    const evite = avant?.key && apres?.key ? trajet(avant.key, apres.key) : 0;
    const tropLoin = (avant && apres) ? (allee + retour - evite > max) : ((avant && allee > max) || (apres && retour > max));
    if (tropLoin) return { faisable: false, raison: 'trajet', arriveeMinutes: null, departMinutes: null, coutMinutes: null, decalages: [] };
  }

  // Décalages : les voisins adaptables dont l'heure ordonnancée diffère de l'heure posée.
  const rdvParId = new Map(rdvs.map((r) => [r.id, r]));
  const decalages = [];
  for (const p of avec.planning) {
    if (p.id === contrat.id) continue;
    const r = rdvParId.get(p.id);
    const a = arrets.find((x) => x.id === p.id);
    if (!r || !a?.tolerance) continue; // figé ou non adaptable : ne bouge pas
    const prevu = minutesDe(r.scheduled_start);
    if (p.arriveeMinutes === prevu) continue;
    decalages.push({
      id: r.id,
      attendu: String(r.scheduled_start || '').slice(0, 5),
      scheduled_start: minutesVersHeure(p.arriveeMinutes),
      scheduled_end: minutesVersHeure(p.arriveeMinutes + a.dureeMinutes),
      duration_minutes: a.dureeMinutes,
    });
  }
  const coutMinutes = (avec.chargeMinutes ?? 0) - (sans.faisable ? (sans.chargeMinutes ?? 0) : 0);
  return {
    faisable: true, raison: null, arriveeMinutes: moi.arriveeMinutes, departMinutes: moi.departMinutes, coutMinutes, decalages,
  };
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
 * tronqués à `maxCreneaux`. Chaque créneau porte l'empreinte de la journée et les
 * décalages de voisins que la pose devra écrire.
 *
 * @param {{ contrat: { id: string, dureeMinutes: number, lat: number|null, lng: number|null }, proposables: Array<{ journee: object, secteur: string }>, depot: { lat: number, lng: number }, reglages: object, trajet: Function, secteurContrat?: string|null, maxCreneaux?: number }} p
 * @returns {{ creneaux: Array<{ id: string, date: string, demi: string, technicienId: string, technicienNom: string, secteur: string, propre: boolean, debutMinutes: number, finMinutes: number, debut: string, fin: string, coutMinutes: number, empreinte: string, decalages: Array<object> }>, refus: Record<string, number> }}
 */
export function creneauxPourContrat({ contrat, proposables, depot, reglages, trajet, secteurContrat = null, maxCreneaux = 6 }) {
  const demis = demiJournees(reglages);
  const refus = {};
  const creneaux = [];
  const meme = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  for (const { journee: j, secteur } of proposables || []) {
    const empreinte = empreinteJournee(j.rdvs);
    for (const demi of demis) {
      const r = placerParSequencement({ journee: j, contrat, demi, depot, reglages, trajet });
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
        propre: meme(secteur, secteurContrat),
        debutMinutes: r.arriveeMinutes,
        finMinutes: r.departMinutes,
        debut: hhmm(r.arriveeMinutes),
        fin: hhmm(r.departMinutes),
        coutMinutes: r.coutMinutes,
        empreinte,
        decalages: r.decalages,
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
