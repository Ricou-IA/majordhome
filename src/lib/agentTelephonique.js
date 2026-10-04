// src/lib/agentTelephonique.js
// ============================================================================
// Agent téléphonique — règle de RECONNAISSANCE d'un client (outil `verifier_client`).
// Spec : docs/superpowers/specs/2026-10-04-agent-telephonique-verifier-client-design.md
//
// Module PUR (aucun import React/Supabase/alias), copié pour Deno par
// `npm run sync:tournee-engine` (_shared/agentTelephonique.js) : l'edge
// agent-verifier-client exécute exactement ce code. Testé par
// `node --test scripts/agent-telephonique.test.mjs`.
//
// Principe : la fiche ne quitte jamais le serveur. L'appelant dit nom, commune,
// adresse, téléphone ; les candidats sont les fiches qui portent ce téléphone ;
// un client est VÉRIFIÉ si un et un seul candidat correspond aussi en nom,
// commune et adresse. Le motif d'échec reste interne (journal), jamais à l'agent.
// ============================================================================

/**
 * Téléphone FR ramené à 10 chiffres (`06…`). `+33` / `0033` / `33` → `0` ; 9 chiffres
 * (zéro perdu à l'import Excel) → `0` préfixé. `null` si le résultat n'a pas 10 chiffres.
 * @param {string|null|undefined} brut
 * @returns {string|null}
 */
export function normaliserTelephone(brut) {
  if (!brut) return null;
  let d = String(brut).replace(/\D/g, '');
  if (d.startsWith('0033')) d = '0' + d.slice(4);
  else if (d.startsWith('33') && d.length === 11) d = '0' + d.slice(2);
  else if (d.length === 9) d = '0' + d;
  return /^0\d{9}$/.test(d) ? d : null;
}

/**
 * Texte comparable : minuscules, sans accents, ponctuation et tirets → espaces, espaces réduits.
 * @param {string|null|undefined} s
 * @returns {string}
 */
export function normaliserTexte(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Distance de Levenshtein (insertion, suppression, substitution).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Nom de famille : égal une fois normalisé (espaces ignorés), ou à une lettre près
 * (faute de transcription) à partir de 5 lettres.
 * @param {string} dit
 * @param {string} fiche
 * @returns {boolean}
 */
export function correspondNom(dit, fiche) {
  const a = normaliserTexte(dit).replace(/ /g, '');
  const b = normaliserTexte(fiche).replace(/ /g, '');
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 5 && levenshtein(a, b) <= 1;
}

/**
 * Commune comparable : « St » → « saint », « Lisle Sur Tarn » ≡ « Lisle-sur-Tarn ».
 * @param {string|null|undefined} s
 * @returns {string}
 */
export function normaliserCommune(s) {
  return normaliserTexte(s)
    .replace(/\bste\b/g, 'sainte')
    .replace(/\bst\b/g, 'saint')
    .replace(/ /g, '');
}

/**
 * Commune : égale une fois normalisée, ou à une lettre près à partir de 5 lettres.
 * @param {string} dit
 * @param {string} fiche
 * @returns {boolean}
 */
export function correspondCommune(dit, fiche) {
  const a = normaliserCommune(dit);
  const b = normaliserCommune(fiche);
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 5 && levenshtein(a, b) <= 1;
}

const ABREVIATIONS = {
  rte: 'route', r: 'rue', av: 'avenue', ave: 'avenue', bd: 'boulevard', bld: 'boulevard', blvd: 'boulevard',
  ch: 'chemin', chem: 'chemin', imp: 'impasse', pl: 'place', all: 'allee', che: 'chemin', lot: 'lotissement',
  res: 'residence', fbg: 'faubourg', hameau: 'hameau', ld: 'lieu dit', lieudit: 'lieu dit',
};
const SUFFIXES = new Set(['bis', 'ter', 'quater', 'b', 't']);

/**
 * Découpe une adresse en { numero, suffixe, voie } normalisés. Les abréviations de type
 * de voie sont développées ; le complément « bis/ter » est séparé du numéro (« 7bis » ou « 7 bis »).
 * @param {string|null|undefined} brut
 * @returns {{ numero: string|null, suffixe: string|null, voie: string }}
 */
export function analyserAdresse(brut) {
  const mots = normaliserTexte(brut).split(' ').filter(Boolean);
  let numero = null;
  let suffixe = null;
  if (mots.length) {
    const m = /^(\d+)([a-z]*)$/.exec(mots[0]);
    if (m) {
      numero = String(Number(m[1]));
      mots.shift();
      if (m[2] && SUFFIXES.has(m[2])) suffixe = m[2] === 'b' ? 'bis' : m[2] === 't' ? 'ter' : m[2];
      else if (mots.length && SUFFIXES.has(mots[0])) {
        const s = mots.shift();
        suffixe = s === 'b' ? 'bis' : s === 't' ? 'ter' : s;
      }
    }
  }
  const voie = mots.map((w) => ABREVIATIONS[w] || w).join(' ');
  return { numero, suffixe, voie };
}

/**
 * Adresse : même numéro de voie (absent des deux côtés accepté — lieux-dits) et nom de
 * voie proche (Levenshtein ≤ 20 % de la plus longue). Le suffixe bis/ter n'est pas exigé
 * (souvent omis à l'oral ou à la saisie), mais deux suffixes différents se contredisent.
 * @param {string} dit
 * @param {string} fiche
 * @returns {boolean}
 */
export function correspondAdresse(dit, fiche) {
  const a = analyserAdresse(dit);
  const b = analyserAdresse(fiche);
  if (!a.voie || !b.voie) return false;
  if (a.numero !== b.numero) return false;
  if (a.suffixe && b.suffixe && a.suffixe !== b.suffixe) return false;
  const va = a.voie.replace(/ /g, '');
  const vb = b.voie.replace(/ /g, '');
  return levenshtein(va, vb) <= Math.floor(Math.max(va.length, vb.length) * 0.2);
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * Date telle qu'on la dit au téléphone : « jeudi 15 octobre » (« 1er » le premier du mois).
 * @param {string} isoDate  `YYYY-MM-DD`
 * @returns {string}
 */
export function jourParle(isoDate) {
  const [y, m, d] = String(isoDate || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const jour = JOURS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${jour} ${d === 1 ? '1er' : d} ${MOIS[m - 1]}`;
}

/** « 8 h », « 13 h 30 » depuis des minutes depuis minuit. */
function heureParlee(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/**
 * Créneau tel qu'on le dit au téléphone : la demi-journée et ses bornes — jamais
 * l'heure calculée (le client choisit une demi-journée, l'heure reste provisoire).
 * @param {{ date: string, demi: string }} creneau
 * @param {Array<{ code: string, debut: number, fin: number }>} demis  `demiJournees(reglages)`
 * @returns {{ jour: string, demi: string, plage: string }}
 */
export function creneauParle(creneau, demis) {
  const d = (demis || []).find((x) => x.code === creneau.demi);
  return {
    jour: jourParle(creneau.date),
    demi: creneau.demi === 'matin' ? 'le matin' : "l'après-midi",
    plage: d ? `entre ${heureParlee(d.debut)} et ${heureParlee(d.fin)}` : '',
  };
}

/**
 * @typedef {{ nom: string, commune: string, adresse: string, telephone: string }} EntreeAppelant
 * @typedef {{ client_id: string, last_name: string, address: string, city: string }} Candidat
 * @typedef {'telephone_invalide'|'telephone_inconnu'|'nom'|'commune'|'adresse'|'doublon'} MotifEchec
 */

/**
 * Verdict sur les candidats (fiches portant déjà le téléphone dit). Ordre des motifs =
 * premier critère qui élimine le DERNIER candidat restant — usage interne uniquement.
 * @param {EntreeAppelant} entree
 * @param {Candidat[]} candidats
 * @returns {{ verifie: boolean, candidat: Candidat|null, motif: MotifEchec|null }}
 */
export function verifierCandidats(entree, candidats) {
  if (!normaliserTelephone(entree?.telephone)) return { verifie: false, candidat: null, motif: 'telephone_invalide' };
  let restants = Array.isArray(candidats) ? candidats : [];
  if (!restants.length) return { verifie: false, candidat: null, motif: 'telephone_inconnu' };
  /** @type {Array<[MotifEchec, (c: Candidat) => boolean]>} */
  const filtres = [
    ['nom', (c) => correspondNom(entree.nom, c.last_name)],
    ['commune', (c) => correspondCommune(entree.commune, c.city)],
    ['adresse', (c) => correspondAdresse(entree.adresse, c.address)],
  ];
  for (const [motif, garde] of filtres) {
    restants = restants.filter(garde);
    if (!restants.length) return { verifie: false, candidat: null, motif };
  }
  if (restants.length > 1) return { verifie: false, candidat: null, motif: 'doublon' };
  return { verifie: true, candidat: restants[0], motif: null };
}
