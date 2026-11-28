// src/lib/aspirateur/ecran.js
// Module PUR : règles d'affichage de l'aspirateur sur la fiche fournisseur (bloc « Site et catalogue », propositions).
// Le composant ne calcule rien : état du bloc, réglages, groupes et libellés viennent d'ici.
// Testé : node --test scripts/aspirateur/ecran.test.mjs
import { messageAspirateur } from './codes.js';
import { libelleDocument } from './propositions.js';

const NATURES = ['public_ht', 'public_ttc', 'net_ht'];

export const NATURES_PRIX = Object.freeze([
  { value: 'net_ht', label: 'Prix net HT (le prix que nous payons)' },
  { value: 'public_ht', label: 'Prix public HT' },
  { value: 'public_ttc', label: 'Prix public TTC' },
]);

/** Réglages de l'aspirateur d'une fiche fournisseur. @param {unknown} connectorConfig */
export function reglagesAspirateur(connectorConfig) {
  const a = connectorConfig && typeof connectorConfig === 'object' ? /** @type {any} */ (connectorConfig).aspirateur : null;
  return {
    naturePrix: a && NATURES.includes(a.nature_prix) ? a.nature_prix : null,
    marques: Array.isArray(a?.marques) ? a.marques.filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim()) : [],
  };
}

/**
 * Configuration du connecteur avec les réglages de l'aspirateur, sans perdre aucune autre clé.
 * @param {unknown} existant @param {{ naturePrix: string | null, marques: string[] }} reglages
 */
export function configAvecAspirateur(existant, { naturePrix, marques }) {
  const base = existant && typeof existant === 'object' && !Array.isArray(existant) ? { ...existant } : {};
  const avant = base.aspirateur && typeof base.aspirateur === 'object' ? base.aspirateur : {};
  base.aspirateur = {
    ...avant,
    nature_prix: NATURES.includes(naturePrix) ? naturePrix : null,
    marques: (marques || []).map((m) => String(m).trim()).filter(Boolean),
  };
  return base;
}

const httpsValide = (u) => { try { return new URL(String(u)).protocol === 'https:'; } catch { return false; } };

/**
 * État du bloc. `etat` = réponse de aspiration_recette_etat (undefined tant qu'elle est inconnue) ; `travail` = dernier
 * travail de ce fournisseur (ou null).
 * @param {{ etat: { connue?: boolean } | undefined, travail: { genre: string, statut: string, code_erreur?: string | null } | null,
 *   reglages: { naturePrix: string | null }, siteUrl: string | null }} entree
 * @returns {{ libelle: string, ton: 'neutre' | 'info' | 'ok' | 'attente' | 'alerte', erreur: string | null, confirmer: boolean,
 *   bouton: { libelle: string, actif: boolean, raison: string | null } }}
 */
export function etatDuBloc({ etat, travail, reglages, siteUrl }) {
  const bouton = (raison = null, actif = true) => ({ libelle: 'Aspirer le site', actif, raison });
  if (!httpsValide(siteUrl)) return { libelle: 'Aucun site renseigné', ton: 'neutre', erreur: null, confirmer: false, bouton: bouton(messageAspirateur('site_absent')) };
  if (travail?.statut === 'en_cours') {
    return { libelle: travail.genre === 'apprentissage' ? 'Apprentissage du site en cours' : 'Aspiration en cours', ton: 'info', erreur: null, confirmer: false, bouton: bouton(null, false) };
  }
  if (travail?.statut === 'attente_confirmation') {
    return { libelle: 'Recette à confirmer', ton: 'attente', erreur: null, confirmer: true, bouton: bouton(null, false) };
  }
  if (etat === undefined) return { libelle: 'Lecture de l’état…', ton: 'neutre', erreur: null, confirmer: false, bouton: bouton(null, false) };
  const erreur = travail?.statut === 'echec' ? messageAspirateur(travail.code_erreur) : null;
  const raison = reglages?.naturePrix ? null : messageAspirateur('nature_prix_absente');
  if (etat.connue) return { libelle: 'Recette connue', ton: erreur ? 'alerte' : 'ok', erreur, confirmer: false, bouton: bouton(raison) };
  return { libelle: 'Site jamais exploré : la première aspiration apprend le site', ton: erreur ? 'alerte' : 'neutre', erreur, confirmer: false, bouton: bouton(raison) };
}

/** Propositions groupées par référence, dans l'ordre d'arrivée. @param {Array<Record<string, any>>} lignes */
export function grouperPropositions(lignes) {
  const groupes = new Map();
  for (const l of lignes || []) {
    if (!groupes.has(l.reference)) groupes.set(l.reference, { reference: l.reference, nom: l.reference, lignes: [] });
    const g = groupes.get(l.reference);
    g.lignes.push(l);
    if (l.genre === 'nouvel_article' && l.valeur?.nom) g.nom = l.valeur.nom;
  }
  return [...groupes.values()];
}

/** @param {number} n */
function euros(n) {
  const [ent, dec] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}${ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} €`;
}

/** @param {unknown} v @param {{ unit?: string | null, type?: string } | undefined} champ */
function valeurLue(v, champ) {
  if (v === true) return 'oui';
  if (v === false) return 'non';
  const t = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
  return champ?.unit && typeof v === 'number' ? `${t} ${champ.unit}` : t;
}

/**
 * Libellé d'une proposition. @param {Record<string, any>} p
 * @param {Array<{ key: string, label?: string, unit?: string | null, type?: string }>} champs
 */
export function libelleProposition(p, champs) {
  switch (p.genre) {
    case 'caracteristique': {
      const champ = (champs || []).find((c) => c.key === p.cle);
      const suite = p.ancienne_valeur === null || p.ancienne_valeur === undefined ? '(vide jusqu’ici)' : `(remplace ${valeurLue(p.ancienne_valeur, champ)})`;
      return `${champ?.label || p.cle} : ${valeurLue(p.valeur, champ)} ${suite}`;
    }
    case 'nouvel_article':
      return `Nouvel article : ${p.valeur?.nom || p.reference}${p.valeur?.marque ? ` · ${p.valeur.marque}` : ''}`;
    case 'document':
      return `Document : ${libelleDocument(p.cle)}`;
    case 'photo':
      return 'Photo de l’appareil';
    case 'prix_achat': {
      const v = p.valeur || {};
      const base = typeof v.achat_ht === 'number' ? `Prix d’achat : ${euros(v.achat_ht)} HT` : `Prix public : ${euros(v.public_ht ?? 0)} HT`;
      return typeof p.ancienne_valeur === 'number' ? `${base} (remplace ${euros(p.ancienne_valeur)})` : base;
    }
    default:
      return String(p.genre || '');
  }
}
