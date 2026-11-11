// Lien MonsieurDPE sur la fiche client — module PUR (aucun import React / Supabase), testé par
// scripts/dpe-lien.test.mjs. Spec : docs/superpowers/specs/2026-11-11-lien-monsieurdpe-fiche-client-design.md
//
// Règle qui tient tout le module : la machine PROPOSE des DPE, elle n'en rattache jamais un. Aucune fonction
// d'ici ne choisit un candidat, même quand il est seul.

const FORME_NUMERO = /^[0-9A-Za-z]{13}$/;

/** @param {unknown} n @returns {boolean} */
export function numeroDpeValide(n) {
  return typeof n === 'string' && FORME_NUMERO.test(n.trim());
}

/** « dpe maison individuelle » → « Maison individuelle ». @param {unknown} brut @returns {string | null} */
function typeLisible(brut) {
  if (typeof brut !== 'string' || !brut.trim()) return null;
  const t = brut.trim().replace(/^dpe\s+/i, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const texte = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const nombre = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Met en forme la réponse de l'action « chercher » de l'edge function dpe-lien.
 * Trie du plus récent au plus ancien, ignore les lignes sans numéro valide, ne présélectionne rien.
 * `indistinguables` : deux candidats au moins ne diffèrent que par leur numéro et leur date — l'écran doit
 * alors inviter à ouvrir chaque DPE sur l'observatoire ADEME pour trancher (étage, nom).
 *
 * @param {{ adresse?: { libelle?: string } | null, batiment_trouve?: boolean, candidats?: unknown[] } | null | undefined} data
 * @returns {{ adresseTrouvee: string | null, batimentTrouve: boolean,
 *   candidats: Array<{ numero: string, date: string | null, etiquette: string | null, surface: number | null, type: string | null, fiabilite: string | null }>,
 *   indistinguables: boolean }}
 */
export function formaterCandidats(data) {
  const lignes = Array.isArray(data?.candidats) ? data.candidats : [];
  const candidats = lignes
    .filter((l) => l && typeof l === 'object' && numeroDpeValide(l.identifiant_dpe))
    .map((l) => ({
      numero: l.identifiant_dpe.trim(),
      date: texte(l.date_etablissement_dpe),
      etiquette: texte(l.etiquette_dpe),
      surface: nombre(l.surface_habitable_logement),
      type: typeLisible(l.type_batiment),
      fiabilite: texte(l.fiabilite_geocodage),
    }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const signatures = candidats.map((c) => `${c.etiquette}|${c.surface}|${c.type}`);
  return {
    adresseTrouvee: texte(data?.adresse?.libelle),
    batimentTrouve: data?.batiment_trouve === true,
    candidats,
    indistinguables: new Set(signatures).size < signatures.length,
  };
}

const MESSAGES = {
  module_ferme: "Le lien MonsieurDPE n'est pas activé pour votre organisation.",
  droit_requis: "Vous n'avez pas le droit de modifier les fiches clients : la recherche de DPE vous est fermée.",
  action_inconnue: 'Action non reconnue par le service MonsieurDPE.',
  client_introuvable: "Ce client n'a pas été retrouvé dans votre organisation.",
  adresse_incomplete: "L'adresse du client est incomplète : il faut au moins la rue et la commune.",
  client_sans_numero: "Aucun numéro de DPE n'est enregistré sur cette fiche.",
  numero_mal_forme: 'Ce numéro de DPE ne fait pas 13 caractères (chiffres et lettres).',
  numero_absent: "Ce numéro n'est pas dans le corpus MonsieurDPE (DPE tertiaire, neuf, ou antérieur à juillet 2021) : l'analyse complète n'est pas disponible.",
  corpus_indisponible: 'Le corpus MonsieurDPE ne répond pas pour le moment. Réessayez dans quelques minutes.',
  partenaire_indisponible: "MonsieurDPE n'a pas pu ouvrir l'analyse pour le moment. Réessayez dans quelques minutes.",
  enregistrement_impossible: "L'accès n'a pas pu être enregistré. Réessayez, et prévenez-nous si cela se reproduit.",
};
const MESSAGE_GENERIQUE = 'Le service MonsieurDPE a rencontré une erreur. Réessayez dans quelques minutes.';

/**
 * Le message français d'un code rendu par l'edge function (ou d'une erreur qui le porte en `message`).
 * @param {unknown} code
 * @returns {string}
 */
export function messageErreurDpeLien(code) {
  const cle = typeof code === 'string' ? code : typeof code?.message === 'string' ? code.message : '';
  return MESSAGES[cle] || MESSAGE_GENERIQUE;
}

/**
 * Où en est le lien pour ce client. Un accès déjà émis prime sur la vérification.
 * @param {{ dpeNumber?: string | null, verification?: { present?: boolean } | null, acces?: { report_url?: string } | null }} p
 * @returns {'sans_numero' | 'mal_forme' | 'a_verifier' | 'absent_du_corpus' | 'pret' | 'emis'}
 */
export function etatDuLien({ dpeNumber, verification, acces }) {
  const numero = typeof dpeNumber === 'string' ? dpeNumber.trim() : '';
  if (!numero) return 'sans_numero';
  if (!numeroDpeValide(numero)) return 'mal_forme';
  if (acces?.report_url) return 'emis';
  if (!verification) return 'a_verifier';
  return verification.present === true ? 'pret' : 'absent_du_corpus';
}

/**
 * Le lien profond vers un DPE sur l'observatoire ADEME (pour départager deux logements d'un immeuble).
 * @param {unknown} numero
 * @returns {string | null}
 */
export function lienObservatoire(numero) {
  return numeroDpeValide(numero) ? `https://observatoire-dpe-audit.ademe.fr/afficher-dpe/${numero.trim()}` : null;
}
