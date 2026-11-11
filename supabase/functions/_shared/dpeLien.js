// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/dpeLien.js — ne pas éditer.
// Lien MonsieurDPE sur la fiche client — module PUR (aucun import React / Supabase), testé par
// scripts/dpe-lien.test.mjs. Spec : docs/superpowers/specs/2026-11-11-lien-monsieurdpe-fiche-client-design.md
//
// Règle qui tient tout le module : la machine PROPOSE des DPE, elle n'en rattache jamais un. Aucune fonction
// d'ici ne choisit un candidat, même quand il est seul.

import { VERSION_CARTE } from './dpeCorpus.js';

/** Délai avant de retenter un rattachement tombé sur une panne. */
const DELAI_NOUVEL_ESSAI_MS = 60 * 60 * 1000;

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
  sans_rapport_complet: "MonsieurDPE n'a pas d'analyse complète pour ce DPE : son détail n'a pas été archivé, ou son étiquette est dérivée de l'immeuble entier.",
  corpus_indisponible: 'Le corpus MonsieurDPE ne répond pas pour le moment. Réessayez dans quelques minutes.',
  partenaire_indisponible: "MonsieurDPE n'a pas pu ouvrir l'analyse pour le moment. Réessayez dans quelques minutes.",
  enregistrement_impossible: "L'accès n'a pas pu être enregistré. Réessayez, et prévenez-nous si cela se reproduit.",
  numero_protege: "Un numéro de DPE a été posé à la main sur cette fiche : la recherche automatique ne le remplace pas.",
  numero_ecarte: "Ce DPE a été écarté pour ce client (« Ce n'est pas le bon »).",
  module_communication_inactif: "L'envoi d'e-mails (module Communication) n'est pas ouvert pour votre organisation.",
  no_from_email: "L'adresse d'expédition des e-mails n'est pas configurée : Paramètres → Emails.",
  client_sans_email: "Aucune adresse e-mail sur la fiche du client.",
  template_missing: "Le modèle d'e-mail « Rapport MonsieurDPE » n'existe pas encore : créez-le dans Paramètres → Emails.",
  pdf_indisponible: "MonsieurDPE n'a pas pu fournir le PDF du rapport. Réessayez dans quelques minutes.",
  resend_failed: "L'e-mail n'a pas pu partir. Réessayez, et prévenez-nous si cela se reproduit.",
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
 * @param {{ dpeNumber?: string | null, verification?: { present?: boolean, rapport_complet?: boolean } | null, acces?: { report_url?: string } | null }} p
 * @returns {'sans_numero' | 'mal_forme' | 'a_verifier' | 'absent_du_corpus' | 'sans_rapport_complet' | 'pret' | 'emis'}
 */
export function etatDuLien({ dpeNumber, verification, acces }) {
  const numero = typeof dpeNumber === 'string' ? dpeNumber.trim() : '';
  if (!numero) return 'sans_numero';
  if (!numeroDpeValide(numero)) return 'mal_forme';
  if (acces?.report_url) return 'emis';
  if (!verification) return 'a_verifier';
  if (verification.present !== true) return 'absent_du_corpus';
  // `rapport_complet` absent se lit « possible » : la porte partenaire tranche de toute façon.
  return verification.rapport_complet === false ? 'sans_rapport_complet' : 'pret';
}

/**
 * Le lien profond vers un DPE sur l'observatoire ADEME (pour départager deux logements d'un immeuble).
 * @param {unknown} numero
 * @returns {string | null}
 */
export function lienObservatoire(numero) {
  return numeroDpeValide(numero) ? `https://observatoire-dpe-audit.ademe.fr/afficher-dpe/${numero.trim()}` : null;
}

// ============================================================================
// Refonte 2026-11-12 (spec 2026-11-12-logement-monsieurdpe-fiche-client-design.md) : ce que la fiche fait à
// l'ouverture, et la disponibilité de l'envoi du rapport au client.
// ============================================================================

/**
 * Adresse de la fiche, normalisée pour détecter un changement (casse, accents, espaces). Null si incomplète :
 * rue obligatoire, et code postal ou commune.
 * @param {{ address?: string|null, postal_code?: string|null, city?: string|null } | null | undefined} client
 * @returns {string | null}
 */
export function adresseNormalisee(client) {
  const p = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const rue = p(client?.address);
  const cp = p(client?.postal_code);
  const ville = p(client?.city);
  if (!rue || (!cp && !ville)) return null;
  return [rue, cp, ville].filter(Boolean).join(' ');
}

/**
 * Que faire à l'ouverture de la fiche ? Une seule décision par montage, appliquée par l'edge dpe-lien.
 * - `rattacher` : chercher le DPE à l'adresse (première fois, ou adresse changée sur un rattachement auto) ;
 * - `actualiser` : relire la carte du numéro de la fiche (numéro tapé à la main, carte absente ou périmée) ;
 * - `signaler_adresse` : l'adresse a changé depuis un rattachement choisi ou saisi — on garde et on le dit ;
 * - `rien`.
 * @param {{ adresseFiche: string|null, dpeNumberFiche?: string|null, peutModifier: boolean,
 *   clientDpe: { dpe_number?: string|null, origine?: string|null, etat?: string|null, adresse_tentee?: string|null,
 *   carte?: object|null, version_carte?: number|null, tente_le?: string|null } | null, maintenant?: Date }} p
 * @returns {'rien' | 'rattacher' | 'actualiser' | 'signaler_adresse'}
 */
export function actionALouverture({ adresseFiche, dpeNumberFiche, peutModifier, clientDpe, maintenant = new Date() }) {
  if (!peutModifier) return 'rien';
  const numeroFiche = (dpeNumberFiche || '').trim();
  if (!clientDpe) {
    if (numeroFiche) return 'actualiser';
    return adresseFiche ? 'rattacher' : 'rien';
  }
  const numeroLigne = (clientDpe.dpe_number || '').trim();
  if (numeroFiche !== numeroLigne) return 'actualiser';

  const adresseChangee = Boolean(adresseFiche && clientDpe.adresse_tentee && clientDpe.adresse_tentee !== adresseFiche);
  if (adresseChangee) {
    if (!numeroLigne || clientDpe.origine === 'auto') return 'rattacher';
    return 'signaler_adresse';
  }
  if (numeroLigne && (!clientDpe.carte || (clientDpe.version_carte ?? 0) < VERSION_CARTE)) return 'actualiser';
  // Une panne (géocodeur, corpus) n'est pas une réponse : on retente, mais pas plus d'une fois par heure.
  if (!numeroLigne && clientDpe.etat === 'erreur') {
    const tente = Date.parse(clientDpe.tente_le || '');
    if (!Number.isFinite(tente) || maintenant.getTime() - tente >= DELAI_NOUVEL_ESSAI_MS) return 'rattacher';
  }
  return 'rien';
}

/**
 * Le bouton « Envoyer le rapport au client » : visible avec le module Communication et le droit de modifier
 * la fiche ; grisé avec sa raison quand un prérequis manque. L'edge refuse de toute façon les mêmes cas.
 * @param {{ communicationActive: boolean, peutModifier: boolean, emailClient?: string|null,
 *   rapportComplet: boolean, expediteurConfigure: boolean }} p
 * @returns {{ visible: boolean, actif: boolean, raison: string | null }}
 */
export function disponibiliteEnvoi({ communicationActive, peutModifier, emailClient, rapportComplet, expediteurConfigure }) {
  if (!communicationActive || !peutModifier) return { visible: false, actif: false, raison: null };
  const non = (raison) => ({ visible: true, actif: false, raison });
  if (!(emailClient || '').trim()) return non("Aucune adresse e-mail sur la fiche du client.");
  if (!rapportComplet) return non("MonsieurDPE n'a pas d'analyse complète pour ce DPE.");
  if (!expediteurConfigure) return non("L'adresse d'expédition des e-mails n'est pas configurée : Paramètres → Emails.");
  return { visible: true, actif: true, raison: null };
}
