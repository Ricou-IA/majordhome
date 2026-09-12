// src/lib/tournee/proposer-contrat.js
// ============================================================================
// Question INVERSE de l'onglet Tournées : pour CE contrat, quelles journées ?
// Module PUR (Node, Vite, Deno). Testé : node --test scripts/tournee/proposer-contrat.test.mjs
//
// L'onglet répond « pour cette journée, quels contrats ? » (proposerPourJournee).
// Ici on itère sur jours × techniciens éligibles et on demande au MÊME moteur
// (placerCandidat) où le contrat se glisse, puis on classe par minutes ajoutées
// à la journée, trajets compris. Rien n'est recalculé ailleurs : chaque créneau
// porte de quoi s'expliquer (voisins, trajets, heure) — l'écran et l'agent
// l'affichent, personne ne refait le calcul.
//
// Règles (spec 2026-09-12 §4.3) :
//   1. Éligibilité = compétence (catégories du contrat ⊆ specialties ; vide =
//      polyvalent) ∧ contrainte technicianId.
//   2. Dans l'horizon ferme, toute journée du technicien est candidate (vide ou
//      amorcée). Au-delà, seules les journées DÉJÀ amorcées le sont — même règle
//      que l'onglet : on ne crée pas de tournée d'un seul entretien loin devant.
//   3. Aucun créneau nulle part → « nouvelles journées » : les journées vides
//      au-delà de l'horizon ferme, signalées à part, jamais mélangées aux
//      créneaux d'une tournée existante.
// ============================================================================
import { placerCandidat, chargeExistante } from './creneaux.js';
import { construireArretsExistants } from './arrets.js';
import { cleCoord } from './geo.js';

const MIDI = 12 * 60;
const HORIZON_OUVERTURE_DEFAUT = 45;
const NOUVELLES_JOURNEES_MAX = 3;

/**
 * Techniciens éligibles pour un contrat : toutes les catégories d'équipement du
 * contrat doivent figurer dans `specialties`. Liste vide = polyvalent (choix
 * assumé : rien ne casse au déploiement, la restriction se pose dans Settings →
 * Équipe).
 *
 * @param {{ categories?: string[] }} contrat
 * @param {Array<{ id: string, specialties?: string[] }>} techniciens
 */
export function techniciensEligibles(contrat, techniciens) {
  const categories = (contrat?.categories || []).filter(Boolean);
  return (techniciens || []).filter((t) => {
    const sp = t.specialties || [];
    if (sp.length === 0) return true;
    return categories.every((c) => sp.includes(c));
  });
}

const joursEntre = (a, b) => Math.round(
  (new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000,
);
const jourSemaine = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const hhmmEnMinutes = (s) => {
  if (!s) return null;
  const [h, m] = String(s).split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};

/** Une journée est-elle candidate ? Incrémente `raisons` quand elle ne l'est pas. */
function journeeRetenue(j, { aujourdhui, reglages, contraintes, raisons }) {
  const ecart = joursEntre(aujourdhui, j.date);
  if (ecart < 0) return false; // le passé n'est ni un créneau ni un rejet
  if (contraintes.dateFrom && j.date < contraintes.dateFrom) { raisons.contrainte += 1; return false; }
  if (contraintes.dateTo && j.date > contraintes.dateTo) { raisons.contrainte += 1; return false; }
  if ((contraintes.datesExclues || []).includes(j.date)) { raisons.contrainte += 1; return false; }
  if ((contraintes.joursSemaineExclus || []).includes(jourSemaine(j.date))) { raisons.contrainte += 1; return false; }
  if (ecart > reglages.horizon_ferme_jours && !j.estAmorcee) { raisons.horizon += 1; return false; }
  return true;
}

/** Contrainte de période → fenêtre d'ARRIVÉE (l'heure annoncée au client). */
function fenetreArriveePour(contraintes) {
  if (contraintes.periode === 'matin') return { max: MIDI - 1 };
  if (contraintes.periode === 'apres_midi') return { min: MIDI };
  return undefined;
}

/**
 * @param {object} p
 * @param {{ id: string, dureeMinutes: number, lat: number|null, lng: number|null, categories: string[] }} p.contrat
 * @param {Array} p.journees   cf. loaders.js::chargerJournees — une par technicien × date,
 *   `{ date, technicienId, technicienNom, couleur, amplitude, budgetMinutes, rdvs, estAmorcee }`
 * @param {Array<{ id: string, nom: string, specialties?: string[] }>} p.techniciens
 * @param {{ lat: number, lng: number }} p.depot
 * @param {object} p.reglages  construireReglages(settings) — horizon_ferme_jours,
 *   horizon_ouverture_jours, pause_minutes, pause_fenetre
 * @param {{ technicianId?: string, dateFrom?: string, dateTo?: string,
 *   periode?: 'matin'|'apres_midi', joursSemaineExclus?: number[], datesExclues?: string[] }} [p.contraintes]
 * @param {(a: string, b: string) => number} p.trajet  minutes entre deux clés `cleCoord`
 * @param {string} p.aujourdhui  YYYY-MM-DD
 * @param {number} [p.maxResults=4]
 * @param {boolean} [p.estime=false]  au moins un trajet est estimé (vol d'oiseau) — propagé sur chaque créneau
 * @returns {{
 *   creneaux: Array<{ date, technicianId, technicianNom, couleur, debutMinutes, finMinutes,
 *     coutMinutes, detourMinutes, attenteMinutes, avant: object|null, apres: object|null, estime: boolean }>,
 *   nouvellesJournees: Array<{ date, technicianId, technicianNom }>,
 *   raisonsRejet: Record<string, number>,
 *   techniciensEligibles: string[],
 * }}
 */
export function proposerPourContrat({
  contrat, journees, techniciens, depot, reglages, contraintes = {}, trajet, aujourdhui,
  maxResults = 4, estime = false,
}) {
  const raisons = { competence: 0, horizon: 0, contrainte: 0, creneau: 0, budget: 0, pause: 0, position: 0 };
  const competents = techniciensEligibles(contrat, techniciens);
  raisons.competence = (techniciens || []).length - competents.length;
  const eligibles = competents.filter((t) => !contraintes.technicianId || t.id === contraintes.technicianId);
  const eligibleIds = new Set(eligibles.map((t) => t.id));
  const nomPar = new Map((techniciens || []).map((t) => [t.id, t.nom]));

  const candidat = { id: contrat.id, key: cleCoord(contrat), dureeMinutes: contrat.dureeMinutes || 0 };
  const depotKey = cleCoord(depot);
  const pause = {
    minutes: reglages.pause_minutes,
    fenetre: [reglages.pause_fenetre[0] * 60, reglages.pause_fenetre[1] * 60],
  };
  const fenetreArrivee = fenetreArriveePour(contraintes);
  const horizonOuverture = reglages.horizon_ouverture_jours ?? HORIZON_OUVERTURE_DEFAUT;

  const creneaux = [];
  const vides = [];
  for (const j of journees || []) {
    if (!eligibleIds.has(j.technicienId)) continue;
    const ecart = joursEntre(aujourdhui, j.date);
    if (ecart > reglages.horizon_ferme_jours && ecart <= horizonOuverture
        && !j.estAmorcee && (j.rdvs || []).length === 0) {
      vides.push({ date: j.date, technicianId: j.technicienId, technicianNom: j.technicienNom ?? nomPar.get(j.technicienId) ?? null });
    }
    if (!journeeRetenue(j, { aujourdhui, reglages, contraintes, raisons })) continue;

    const arrets = construireArretsExistants(j.rdvs, depot);
    const chargeDeja = chargeExistante(arrets, { trajet, depotKey });
    const place = placerCandidat({
      arrets, candidat, trajet, depotKey, amplitude: j.amplitude, fenetreArrivee,
      budgetMinutes: j.budgetMinutes, pause, chargeDeja,
    });
    if (!place.faisable) {
      raisons[place.raison] = (raisons[place.raison] || 0) + 1;
      continue;
    }

    const parId = new Map((j.rdvs || []).map((r) => [r.id, r]));
    const voisin = (id, bord) => {
      if (!id) return null;
      const r = parId.get(id);
      const debut = hhmmEnMinutes(r?.scheduled_start);
      const v = { id, label: r?.client_name || id, ville: r?.city || null };
      if (bord === 'avant') v.finMinutes = debut == null ? null : debut + (r?.duration_minutes || 0);
      else v.debutMinutes = debut;
      return v;
    };
    creneaux.push({
      date: j.date,
      technicianId: j.technicienId,
      technicianNom: j.technicienNom ?? nomPar.get(j.technicienId) ?? null,
      couleur: j.couleur ?? null,
      debutMinutes: place.arriveeMinutes,
      finMinutes: place.departMinutes,
      coutMinutes: place.coutMinutes,
      detourMinutes: place.detourMinutes,
      attenteMinutes: place.attenteMinutes,
      avant: voisin(place.avantId, 'avant'),
      apres: voisin(place.apresId, 'apres'),
      estime,
    });
  }

  creneaux.sort((a, b) => a.coutMinutes - b.coutMinutes
    || a.date.localeCompare(b.date)
    || a.debutMinutes - b.debutMinutes);
  const retenus = creneaux.slice(0, maxResults);
  const nouvellesJournees = retenus.length === 0
    ? vides.sort((a, b) => a.date.localeCompare(b.date)).slice(0, NOUVELLES_JOURNEES_MAX)
    : [];
  return { creneaux: retenus, nouvellesJournees, raisonsRejet: raisons, techniciensEligibles: [...eligibleIds] };
}
