// src/lib/importClients/controles.js
// Contrôle d'une fiche, classement des lignes (prête, doublon, écartée) et bilan — module PUR (imports relatifs
// seulement), testé par scripts/import-clients/controles.test.mjs.
// Un doublon avec la base se cherche par index construits une seule fois : jamais de balayage complet par ligne.

import { CHAMPS } from './champs.js';
import { normaliserValeur } from './normaliser.js';
import { buildClientDisplayName } from '../clientDisplayName.js';
import { buildClientDuplicateProbe, matchClientDuplicates, phoneTailKey } from '../clientDuplicateMatch.js';
import { normalizeEmailKey, normalizeNameKey } from '../leadDuplicateMatch.js';

/** Libellé affichable de la raison d'une ligne non importée. */
export const LIBELLE_RAISON = {
  sans_nom: 'Ni nom ni société',
  doublon_fichier: 'Déjà présent plus haut dans le fichier',
  doublon_fort: 'Déjà dans vos clients',
  doublon_faible: 'Homonyme écarté',
};

const CATEGORIES = ['particulier', 'entreprise', 'public'];

const vide = (v) => v === null || v === undefined || v === '';

/**
 * Transforme un candidat (sortie d'appliquerCorrespondance) en fiche prête à écrire.
 * Une valeur illisible laisse le champ vide et reste lisible dans les notes internes ; les accords e-mail et SMS
 * valent « oui » quand ils sont absents ou illisibles (colonnes non nulles).
 * @param {{ numero: number, valeurs: Record<string, string>, notesAjoutees: string[] }} candidate
 * @returns {{ numero: number, fiche: Record<string, unknown>, ecartee: boolean, raison: ''|'sans_nom', corrections: Array<{ libelle: string, valeur: string }> }}
 */
export function controlerFiche(candidate) {
  const { numero, valeurs = {}, notesAjoutees = [] } = candidate;
  const fiche = {};
  const corrections = [];
  for (const champ of CHAMPS) {
    const brut = valeurs[champ.cle];
    const { valeur, illisible } = normaliserValeur(champ, brut ?? '');
    if (illisible) corrections.push({ libelle: champ.libelle, valeur: String(brut).trim() });
    fiche[champ.colonne] = champ.type === 'oui_non' ? (illisible ? true : valeur) : (valeur ?? null);
  }

  if (fiche.last_name) fiche.last_name = fiche.last_name.toUpperCase();
  if (fiche.first_name) fiche.first_name = fiche.first_name.toUpperCase();
  if (!CATEGORIES.includes(fiche.client_category)) {
    fiche.client_category = fiche.company_name ? 'entreprise' : 'particulier';
  }
  fiche.display_name = buildClientDisplayName({
    firstName: fiche.first_name, lastName: fiche.last_name, companyName: fiche.company_name, clientCategory: fiche.client_category,
  });

  const parties = [fiche.internal_notes, ...notesAjoutees, ...corrections.map((c) => `${c.libelle} d'origine : ${c.valeur}`)]
    .filter((p) => !vide(p) && String(p).trim());
  fiche.internal_notes = parties.length ? parties.join('\n') : null;

  const ecartee = !fiche.display_name;
  return { numero, fiche, ecartee, raison: ecartee ? 'sans_nom' : '', corrections };
}

const cleRef = (ref) => (vide(ref) ? '' : String(ref).trim().toLowerCase());
const cleNom = (k) => (k ? `${k.last}|${k.first}` : null);
const cp = (v) => (vide(v) ? '' : String(v).trim());

function ajouter(index, cle, valeur) {
  if (!cle) return;
  const liste = index.get(cle);
  if (liste) liste.push(valeur); else index.set(cle, [valeur]);
}

/** Index des clients existants : téléphones, e-mail, nom de famille, ancien numéro. */
function indexerExistants(clients) {
  const tel = new Map(); const mail = new Map(); const nom = new Map(); const ref = new Map();
  for (const c of clients) {
    for (const k of new Set([phoneTailKey(c.phone), phoneTailKey(c.phone_secondary)])) ajouter(tel, k, c);
    ajouter(mail, normalizeEmailKey(c.email), c);
    const n = normalizeNameKey('x', c.last_name);
    ajouter(nom, n && n.last, c);
    ajouter(ref, cleRef(c.external_ref), c);
  }
  return { tel, mail, nom, ref };
}

/** Rapprochements d'une fiche avec la base : fiches confirmées par matchClientDuplicates, plus l'ancien numéro. */
function doublonsAvecBase(fiche, index) {
  const probe = buildClientDuplicateProbe({
    phone: fiche.phone, phoneSecondary: fiche.phone_secondary, email: fiche.email,
    firstName: fiche.first_name, lastName: fiche.last_name, postalCode: fiche.postal_code,
  });
  const candidats = new Set();
  if (probe) {
    for (const k of probe.phoneKeys) for (const c of index.tel.get(k) || []) candidats.add(c);
    for (const c of (probe.emailKey && index.mail.get(probe.emailKey)) || []) candidats.add(c);
    const n = normalizeNameKey('x', fiche.last_name);
    for (const c of (n && index.nom.get(n.last)) || []) candidats.add(c);
  }
  const trouves = probe ? matchClientDuplicates([...candidats], probe) : [];
  const ref = cleRef(fiche.external_ref);
  if (ref) {
    for (const c of index.ref.get(ref) || []) {
      const deja = trouves.find((m) => m.id === c.id);
      if (deja) deja.raisonAncienNumero = true;
      else trouves.push({ ...c, matchReasons: [], isStrong: false, raisonAncienNumero: true });
    }
  }
  return trouves;
}

/** « Fort » : même téléphone ou e-mail, même ancien numéro, ou même nom + prénom sans code postal contradictoire. */
function estFort(m, codePostalFiche) {
  if (m.isStrong || m.raisonAncienNumero) return true;
  if (!m.matchReasons.includes('name')) return false;
  const autre = cp(m.postal_code);
  return !codePostalFiche || !autre || codePostalFiche === autre;
}

/** Mémoire des lignes déjà vues dans le fichier, pour y repérer les doublons. */
function nouvelleMemoireFichier() {
  const parRef = new Map(); const parNom = new Map();
  return {
    chercher(ref, nom, tels, mail, codePostal) {
      if (ref && parRef.has(ref)) return parRef.get(ref);
      for (const v of (nom && parNom.get(nom)) || []) {
        if (tels.some((t) => v.tels.includes(t)) || (mail && mail === v.mail) || (codePostal && codePostal === v.codePostal)) return v.numero;
      }
      return null;
    },
    retenir(numero, ref, nom, tels, mail, codePostal) {
      if (ref && !parRef.has(ref)) parRef.set(ref, numero);
      ajouter(parNom, nom, { numero, tels, mail, codePostal });
    },
  };
}

/**
 * Classe chaque candidat : prête, doublon (fichier, base forte ou faible) ou écartée. Ordre des tests : doublon dans
 * le fichier (la première ligne gagne), puis doublon avec les clients existants, sinon prête.
 * @param {Array<{ numero: number, valeurs: Record<string, string>, notesAjoutees: string[] }>} candidates dans l'ordre du fichier
 * @param {Array<object>} clientsExistants clients de l'entreprise (first_name, last_name, phone, phone_secondary, email, postal_code, external_ref)
 * @returns {Array<{ numero: number, fiche: Record<string, unknown>, statut: 'prete'|'doublon_fort'|'doublon_faible'|'doublon_fichier'|'ecartee', raison: string, doublons: Array<object>, corrections: Array<{ libelle: string, valeur: string }> }>}
 */
export function classerLignes(candidates, clientsExistants) {
  const index = indexerExistants(clientsExistants || []);
  const memoire = nouvelleMemoireFichier();
  return candidates.map((candidate) => {
    const { numero, fiche, ecartee, corrections } = controlerFiche(candidate);
    if (ecartee) return { numero, fiche, statut: 'ecartee', raison: 'sans_nom', doublons: [], corrections };

    const ref = cleRef(fiche.external_ref);
    const nom = cleNom(normalizeNameKey(fiche.first_name, fiche.last_name));
    const tels = [...new Set([phoneTailKey(fiche.phone), phoneTailKey(fiche.phone_secondary)].filter(Boolean))];
    const mail = normalizeEmailKey(fiche.email);
    const codePostal = cp(fiche.postal_code);

    const dejaVue = memoire.chercher(ref, nom, tels, mail, codePostal);
    memoire.retenir(numero, ref, nom, tels, mail, codePostal);
    if (dejaVue !== null) {
      return { numero, fiche, statut: 'doublon_fichier', raison: 'doublon_fichier', doublons: [{ numero: dejaVue }], corrections };
    }

    const doublons = doublonsAvecBase(fiche, index);
    if (doublons.length) {
      const statut = doublons.some((m) => estFort(m, codePostal)) ? 'doublon_fort' : 'doublon_faible';
      return { numero, fiche, statut, raison: statut, doublons, corrections };
    }
    return { numero, fiche, statut: 'prete', raison: '', doublons: [], corrections };
  });
}

/**
 * Une ligne est-elle écrite, compte tenu des choix de l'utilisateur ?
 * @param {{ numero: number, statut: string }} ligneClassee
 * @param {{ importer: Set<number>, ecarter: Set<number> }} choix numéros de ligne
 * @returns {boolean}
 */
export function aImporter(ligneClassee, choix) {
  const { numero, statut } = ligneClassee;
  if (statut === 'prete') return true;
  if (statut === 'doublon_fort') return choix.importer.has(numero);
  if (statut === 'doublon_faible') return !choix.ecarter.has(numero);
  return false;
}

/**
 * Bilan affiché à l'écran : importées + doublons écartés + écartées = lues, toujours.
 * @param {Array<{ numero: number, statut: string }>} classees
 * @param {{ importer: Set<number>, ecarter: Set<number> }} choix
 * @returns {{ lues: number, importees: number, doublons_ecartes: number, ecartees: number }}
 */
export function bilan(classees, choix) {
  const lues = classees.length;
  const importees = classees.filter((l) => aImporter(l, choix)).length;
  const ecartees = classees.filter((l) => l.statut === 'ecartee').length;
  return { lues, importees, doublons_ecartes: lues - importees - ecartees, ecartees };
}

/**
 * Lignes à envoyer à l'écriture : numéro de ligne du fichier plus les colonnes de la fiche (jamais d'organisation).
 * @param {Array<{ numero: number, fiche: Record<string, unknown>, statut: string }>} classees
 * @param {{ importer: Set<number>, ecarter: Set<number> }} choix
 * @returns {Array<Record<string, unknown>>}
 */
export function lignesPourEcriture(classees, choix) {
  return classees.filter((l) => aImporter(l, choix)).map((l) => ({ import_line: l.numero, ...l.fiche }));
}
