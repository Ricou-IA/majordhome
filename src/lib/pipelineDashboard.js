/**
 * pipelineDashboard.js — les chiffres du Dashboard du pipeline.
 * ============================================================================
 * Module PUR (aucun import React / Supabase). Deux lectures qui ne se mélangent
 * JAMAIS dans un ratio (Eric, 2026-11-17) :
 *
 *  1. ÉVÉNEMENTS de la période — ce qui s'est passé pendant ces mois-là : leads
 *     reçus, RDV commerciaux datés de la période, devis émis, ventes signées,
 *     CA signé. Le RDV de novembre et la vente de novembre ne concernent pas le
 *     même lead : aucun taux n'est calculé entre ces colonnes.
 *
 *  2. CYCLE DE VIE des leads reçus pendant la période :
 *     - « gagnés à 30 jours » = part des leads reçus signés dans les 30 jours
 *       suivant leur arrivée. Ne dépend pas du passage en Perdu (pas toujours
 *       fait) ; chaque mois est mesuré au même âge, donc comparable au suivant.
 *       Un mois n'est définitif que 30 jours après sa fin.
 *     - délai de signature = médiane (arrivée du lead → signature) des ventes de
 *       la période, hors leads saisis alors que leur devis existait déjà (ils
 *       « signent le jour même » sans rien mesurer).
 *
 * « Gagné » a la même définition que le Kanban : le lead a une carte dans la
 * colonne Gagné de `majordhome_kanban_cards` (devis Pennylane validé, sinon
 * statut du lead). Le CA est le montant de cette carte.
 * ============================================================================
 */

import { plusRecente } from './leadCardDate.js';

/** Fenêtre du taux de gain, en jours après l'arrivée du lead. */
export const HORIZON_GAIN_JOURS = 30;
/** Un devis en attente sans contact depuis plus de N jours est « sans relance ». */
export const SEUIL_RELANCE_JOURS = 21;
/** Identifiant de la ligne des leads sans commercial. */
export const NON_ASSIGNE = '';

// ---------------------------------------------------------------------------
// Dates (tout en `YYYY-MM-DD` / `YYYY-MM`, sans fuseau)
// ---------------------------------------------------------------------------

/** @param {string|null|undefined} valeur date ou horodatage ISO @returns {string|null} `YYYY-MM-DD` */
export function jourDe(valeur) {
  if (!valeur) return null;
  const s = String(valeur).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** @returns {string|null} `YYYY-MM` */
export function moisDe(valeur) {
  const j = jourDe(valeur);
  return j ? j.slice(0, 7) : null;
}

const enUtc = (jour) => {
  const [a, m, j] = jour.split('-').map(Number);
  return Date.UTC(a, m - 1, j);
};

/** Nombre de jours de `debut` à `fin` (négatif si `fin` précède `debut`), `null` si une date manque. */
export function joursEntre(debut, fin) {
  const d = jourDe(debut);
  const f = jourDe(fin);
  if (!d || !f) return null;
  return Math.round((enUtc(f) - enUtc(d)) / 86_400_000);
}

/** Décale un mois `YYYY-MM` de `n` mois (n négatif = vers le passé). */
export function decalerMois(mois, n) {
  const [a, m] = mois.split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Dernier jour d'un mois `YYYY-MM`. */
export function finDeMois(mois) {
  const [a, m] = mois.split('-').map(Number);
  return `${mois}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Les `n` mois qui se terminent à `dernier` (inclus), du plus ancien au plus récent. */
export function derniersMois(dernier, n) {
  return Array.from({ length: n }, (_, i) => decalerMois(dernier, i - (n - 1)));
}

/** La période de même longueur qui précède immédiatement `mois` (triés). */
export function periodePrecedente(mois) {
  const tries = [...mois].sort();
  return tries.map((m) => decalerMois(m, -tries.length));
}

/**
 * Où en est la mesure « gagnés à 30 jours » d'une période.
 * @returns {'en_cours'|'provisoire'|'definitif'}
 */
export function etatCohorte(mois, aujourdhui) {
  const fin = finDeMois([...mois].sort().at(-1));
  const ecart = joursEntre(fin, aujourdhui);
  if (ecart === null || ecart <= 0) return 'en_cours';
  return ecart < HORIZON_GAIN_JOURS ? 'provisoire' : 'definitif';
}

/** Médiane d'une liste de nombres, `null` si vide. */
export function mediane(valeurs) {
  if (!valeurs.length) return null;
  const t = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(t.length / 2);
  return t.length % 2 ? t[milieu] : (t[milieu - 1] + t[milieu]) / 2;
}

// ---------------------------------------------------------------------------
// Index : un enregistrement par lead, enrichi de ses cartes
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LeadIndexe
 * @property {Object} lead
 * @property {string} commercialId   `assigned_user_id` ou NON_ASSIGNE
 * @property {string|null} recuLe    jour d'arrivée du lead
 * @property {boolean} gagne
 * @property {string|null} gagneLe   jour de signature
 * @property {number} montantGagne
 * @property {string|null} premierDevisLe
 * @property {Object[]} cartes
 */

/**
 * @param {Object[]} leads lignes de `majordhome_leads`
 * @param {Object[]} cards lignes de `majordhome_kanban_cards`
 * @returns {Map<string, LeadIndexe>}
 */
export function indexerLeads(leads, cards) {
  const cartesParLead = new Map();
  for (const c of cards || []) {
    if (!cartesParLead.has(c.lead_id)) cartesParLead.set(c.lead_id, []);
    cartesParLead.get(c.lead_id).push(c);
  }
  const index = new Map();
  for (const lead of leads || []) {
    const cartes = cartesParLead.get(lead.id) || [];
    const carteGagne = cartes.find((c) => c.column_key === 'gagne') || null;
    const premierDevisLe = cartes.map((c) => jourDe(c.first_quote_date)).filter(Boolean).sort()[0] || null;
    index.set(lead.id, {
      lead,
      commercialId: lead.assigned_user_id || NON_ASSIGNE,
      recuLe: jourDe(lead.created_date),
      gagne: !!carteGagne,
      gagneLe: carteGagne
        ? jourDe(lead.won_date)
          || jourDe(carteGagne.quotes_validated_at)
          || (lead.status_is_won === true ? jourDe(lead.status_changed_at) : null)
        : null,
      montantGagne: carteGagne ? Number(carteGagne.total_amount) || 0 : 0,
      premierDevisLe,
      cartes,
    });
  }
  return index;
}

/**
 * Org sans Pennylane : les devis émis se lisent sur le lead (date d'envoi + montant).
 * @param {Object[]} leads
 * @returns {Array<{ lead_id: string, quote_date: string, amount_ht: number }>}
 */
export function devisDepuisLeads(leads) {
  return (leads || [])
    .filter((l) => jourDe(l.quote_sent_date))
    .map((l) => ({ lead_id: l.id, quote_date: jourDe(l.quote_sent_date), amount_ht: Number(l.order_amount_ht) || 0 }));
}

// ---------------------------------------------------------------------------
// Mesure d'une période pour un ensemble de leads
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Mesure
 * @property {number} leads          leads reçus pendant la période
 * @property {number} rdv            RDV commerciaux datés de la période (hors annulés)
 * @property {number} devis          devis émis pendant la période
 * @property {number} montantDevis   montant HT de ces devis
 * @property {number} ventes         affaires signées pendant la période
 * @property {number} ca             CA HT de ces affaires
 * @property {number} gagnes30       leads reçus pendant la période et signés à 30 jours
 * @property {number|null} tauxGagnes30  gagnes30 / leads (0-100), `null` si aucun lead ou période en cours
 * @property {'en_cours'|'provisoire'|'definitif'} etat
 * @property {number|null} delaiSignature  médiane en jours, `null` si aucune vente mesurable
 * @property {number} ventesMesurees  nombre de ventes entrant dans le délai
 */

/**
 * @param {Object} p
 * @param {Map<string, LeadIndexe>} p.index
 * @param {Array<{ lead_id: string, scheduled_date: string }>} p.rdvs
 * @param {Array<{ lead_id: string, quote_date: string, amount_ht: number }>} p.devis
 * @param {string[]} p.mois
 * @param {string} p.aujourdhui
 * @param {(l: LeadIndexe) => boolean} [p.garder]
 * @returns {Mesure}
 */
export function mesurer({ index, rdvs, devis, mois, aujourdhui, garder = () => true }) {
  const dans = new Set(mois);
  const etat = etatCohorte(mois, aujourdhui);
  const m = { leads: 0, rdv: 0, devis: 0, montantDevis: 0, ventes: 0, ca: 0, gagnes30: 0, tauxGagnes30: null, etat, delaiSignature: null, ventesMesurees: 0 };
  const delais = [];

  for (const l of index.values()) {
    if (!garder(l)) continue;
    if (dans.has(moisDe(l.recuLe))) {
      m.leads += 1;
      const delai = l.gagne ? joursEntre(l.recuLe, l.gagneLe) : null;
      if (delai !== null && delai <= HORIZON_GAIN_JOURS) m.gagnes30 += 1;
    }
    if (l.gagne && dans.has(moisDe(l.gagneLe))) {
      m.ventes += 1;
      m.ca += l.montantGagne;
      // Lead saisi alors que le devis existait déjà : il ne mesure aucun délai.
      const devisDejaLa = l.premierDevisLe && l.recuLe && l.premierDevisLe <= l.recuLe;
      const delai = joursEntre(l.recuLe, l.gagneLe);
      if (!devisDejaLa && delai !== null && delai >= 0) delais.push(delai);
    }
  }
  for (const r of rdvs || []) {
    const l = index.get(r.lead_id);
    if (l && garder(l) && dans.has(moisDe(r.scheduled_date))) m.rdv += 1;
  }
  for (const d of devis || []) {
    const l = index.get(d.lead_id);
    if (l && garder(l) && dans.has(moisDe(d.quote_date))) {
      m.devis += 1;
      m.montantDevis += Number(d.amount_ht) || 0;
    }
  }

  if (m.leads > 0 && etat !== 'en_cours') m.tauxGagnes30 = (m.gagnes30 / m.leads) * 100;
  m.delaiSignature = mediane(delais);
  m.ventesMesurees = delais.length;
  return m;
}

const aDeLActivite = (m) => m.leads + m.rdv + m.devis + m.ventes > 0;

// ---------------------------------------------------------------------------
// Portefeuille ouvert (état du jour, indépendant de la période)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LignePortefeuille
 * @property {number} aContacter         cartes « Nouveau »
 * @property {number} rdvAReplanifier    cartes « RDV planifié » sans RDV actif au planning
 * @property {number} devisEnAttente     cartes « Devis envoyé »
 * @property {number} montantEnAttente   montant HT de ces cartes
 * @property {number} devisSansRelance   parmi elles, sans contact depuis plus de SEUIL_RELANCE_JOURS
 */

const lignePortefeuilleVide = () => ({ aContacter: 0, rdvAReplanifier: 0, devisEnAttente: 0, montantEnAttente: 0, devisSansRelance: 0 });

/** Jours depuis le dernier contact daté d'une carte « Devis envoyé » ; `null` si aucun contact n'est daté. */
function joursSansRelance(l, c, aujourdhui) {
  const dernierContact = plusRecente([
    l.lead.last_followup_date, l.lead.last_interaction_at, l.lead.quote_sent_date, c.first_quote_date,
  ]);
  return joursEntre(dernierContact, aujourdhui);
}

/** Nom affiché d'un lead : société, sinon nom et prénom. */
const nomDuLead = (lead) => (lead.company_name || '').trim()
  || [lead.last_name, lead.first_name].map((v) => (v || '').trim()).filter(Boolean).join(' ')
  || 'Sans nom';

/** Nombre de relances prioritaires montrées sur la page d'accueil. */
export const NB_RELANCES_PRIORITAIRES = 3;

/**
 * Les devis en attente sans relance depuis plus de SEUIL_RELANCE_JOURS (même critère que
 * `devisSansRelance`), hors projets MT-LT : plus gros montant d'abord, puis plus ancien contact
 * (un devis sans aucun contact daté passe après ceux qui en ont un, à montant égal).
 * @returns {Array<{ leadId: string, nom: string, montant: number, jours: number|null }>}
 */
function relancesPrioritaires(leadsIndexes, aujourdhui, garder) {
  const liste = [];
  for (const l of leadsIndexes) {
    if (!garder(l) || l.lead.is_long_term_project) continue;
    for (const c of l.cartes) {
      if (c.column_key !== 'devis_envoye') continue;
      const jours = joursSansRelance(l, c, aujourdhui);
      if (jours !== null && jours <= SEUIL_RELANCE_JOURS) continue;
      liste.push({ leadId: l.lead.id, nom: nomDuLead(l.lead), montant: Number(c.total_amount) || 0, jours });
    }
  }
  return liste
    .sort((a, b) => b.montant - a.montant || (b.jours ?? -1) - (a.jours ?? -1))
    .slice(0, NB_RELANCES_PRIORITAIRES);
}

/** Ajoute à `ligne` ce que le lead `l` laisse en attente aujourd'hui. Les projets MT-LT ont leur propre suivi. */
function ajouterAuPortefeuille(ligne, l, aujourdhui) {
  if (l.lead.is_long_term_project) return;
  for (const c of l.cartes) {
    if (c.column_key === 'nouveau') ligne.aContacter += 1;
    else if (c.column_key === 'rdv_planifie' && !c.has_active_rdv) ligne.rdvAReplanifier += 1;
    else if (c.column_key === 'devis_envoye') {
      ligne.devisEnAttente += 1;
      ligne.montantEnAttente += Number(c.total_amount) || 0;
      const age = joursSansRelance(l, c, aujourdhui);
      // Aucun contact daté : on ne peut pas dire qu'il a été relancé.
      if (age === null || age > SEUIL_RELANCE_JOURS) ligne.devisSansRelance += 1;
    }
  }
}

const aQuelqueChoseATraiter = (p) => p.aContacter + p.rdvAReplanifier + p.devisEnAttente > 0;

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

/**
 * @param {Object} p
 * @param {Object[]} p.leads
 * @param {Object[]} p.cards
 * @param {Object[]} p.rdvs
 * @param {Object[]} p.devis
 * @param {Array<{ id: string, full_name: string }>} p.commercials
 * @param {Array<{ id: string, name: string }>} p.sources
 * @param {string[]} p.mois              mois sélectionnés (`YYYY-MM`)
 * @param {string} p.aujourdhui          `YYYY-MM-DD`
 * @param {string[]} [p.sourceIds]       filtre sources (vide = toutes)
 * @param {string|null} [p.seulCommercialId]  restreint tout au portefeuille d'un commercial (rôle commercial)
 * @param {number} [p.nbMois]            profondeur de la vue par mois
 */
export function buildPipelineDashboard({
  leads, cards, rdvs, devis, commercials = [], sources = [],
  mois, aujourdhui, sourceIds = [], seulCommercialId = null, nbMois = 6,
}) {
  const periode = [...mois].sort();
  const precedente = periodePrecedente(periode);
  const index = indexerLeads(leads, cards);

  const sourcesGardees = new Set(sourceIds);
  const dansLePerimetre = (l) =>
    (sourcesGardees.size === 0 || sourcesGardees.has(l.lead.source_id))
    && (seulCommercialId === null || l.commercialId === seulCommercialId);

  const base = { index, rdvs, devis, aujourdhui };
  const mesure = (m, garder) => mesurer({ ...base, mois: m, garder: (l) => dansLePerimetre(l) && garder(l) });
  const tous = () => true;

  // --- Commerciaux : ceux qui ont de l'activité sur la période ou la précédente
  const nomCommercial = new Map(commercials.map((c) => [c.id, c.full_name]));
  const idsCommerciaux = new Set();
  for (const l of index.values()) if (dansLePerimetre(l)) idsCommerciaux.add(l.commercialId);
  const libelle = (id) => (id === NON_ASSIGNE ? 'Non assigné' : nomCommercial.get(id) || 'Commercial retiré');

  const commerciaux = [...idsCommerciaux]
    .map((id) => {
      const du = (l) => l.commercialId === id;
      return { id, nom: libelle(id), actuel: mesure(periode, du), precedent: mesure(precedente, du) };
    })
    .filter((c) => aDeLActivite(c.actuel) || aDeLActivite(c.precedent))
    .sort((a, b) => (a.id === NON_ASSIGNE) - (b.id === NON_ASSIGNE) || b.actuel.ca - a.actuel.ca || b.actuel.leads - a.actuel.leads || a.nom.localeCompare(b.nom));

  // --- Vue par mois : entreprise, puis chaque commercial
  const moisAffiches = derniersMois(periode.at(-1), nbMois);
  const parMoisPour = (garder) => moisAffiches.map((m) => ({ mois: m, ...mesure([m], garder) }));
  const parMois = { tous: parMoisPour(tous), parCommercial: {} };
  for (const id of idsCommerciaux) parMois.parCommercial[id] = parMoisPour((l) => l.commercialId === id);

  // --- Sources (lecture identique, sur la période)
  const nomSource = new Map(sources.map((s) => [s.id, s.name]));
  const idsSources = new Set();
  for (const l of index.values()) if (dansLePerimetre(l)) idsSources.add(l.lead.source_id || '');
  const lignesSources = [...idsSources]
    .map((id) => ({
      id,
      nom: id ? nomSource.get(id) || 'Source retirée' : 'Sans source',
      actuel: mesure(periode, (l) => (l.lead.source_id || '') === id),
    }))
    .filter((s) => aDeLActivite(s.actuel))
    .sort((a, b) => b.actuel.ca - a.actuel.ca || b.actuel.leads - a.actuel.leads || a.nom.localeCompare(b.nom));

  // --- Portefeuille ouvert, aujourd'hui
  const lignesPortefeuille = new Map();
  const totalPortefeuille = lignePortefeuilleVide();
  for (const l of index.values()) {
    if (!dansLePerimetre(l)) continue;
    if (!lignesPortefeuille.has(l.commercialId)) lignesPortefeuille.set(l.commercialId, lignePortefeuilleVide());
    ajouterAuPortefeuille(lignesPortefeuille.get(l.commercialId), l, aujourdhui);
    ajouterAuPortefeuille(totalPortefeuille, l, aujourdhui);
  }
  const portefeuille = [...lignesPortefeuille.entries()]
    .map(([id, ligne]) => ({ id, nom: libelle(id), ...ligne }))
    .filter(aQuelqueChoseATraiter)
    .sort((a, b) => (a.id === NON_ASSIGNE) - (b.id === NON_ASSIGNE) || b.devisSansRelance - a.devisSansRelance || b.devisEnAttente - a.devisEnAttente || a.nom.localeCompare(b.nom));

  // --- CA signé sur 12 mois
  const tendance = derniersMois(periode.at(-1), 12).map((m) => {
    const x = mesure([m], tous);
    return { mois: m, ca: x.ca, ventes: x.ventes, leads: x.leads };
  });

  return {
    periode: { mois: periode, precedente },
    entreprise: { actuel: mesure(periode, tous), precedent: mesure(precedente, tous) },
    commerciaux,
    parMois,
    sources: lignesSources,
    portefeuille: {
      lignes: portefeuille,
      total: totalPortefeuille,
      relancesPrioritaires: relancesPrioritaires(index.values(), aujourdhui, dansLePerimetre),
    },
    tendance,
  };
}

/**
 * Premier jour à charger pour couvrir la période, sa précédente et les 12 mois de tendance.
 * @param {string[]} mois @returns {string} `YYYY-MM-DD`
 */
export function debutDesDonnees(mois) {
  const periode = [...mois].sort();
  const candidats = [periodePrecedente(periode)[0], decalerMois(periode.at(-1), -11)];
  return `${candidats.sort()[0]}-01`;
}
