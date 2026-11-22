// src/lib/importClients/normaliser.js
// Mise en forme d'une valeur du fichier selon le champ visé — module PUR (imports relatifs seulement), testé par
// scripts/import-clients/normaliser.test.mjs.
// Une valeur vide donne { valeur: null, illisible: false } (sauf « oui / non » : vide = oui). Une valeur non
// reconnue donne { valeur: null, illisible: true } : elle n'est jamais devinée.

import { emailsValides } from '../emailUtils.js';
import { cleanPhone } from '../phoneUtils.js';
import { cleEntete } from './champs.js';

const OUI = new Set(['oui', 'o', 'yes', 'y', 'vrai', 'true', '1', 'ok', 'accord', 'accepte']);
const NON = new Set(['non', 'n', 'no', 'faux', 'false', '0', 'refus', 'refuse']);

// Formes comparées après cleEntete (minuscules, sans accent) et retrait du « s » final de chaque mot (pluriel).
const MOTS_TYPE_CLIENT = {
  particulier: ['particulier', 'prive', 'privee', 'personne', 'personne physique', 'client particulier', 'residentiel',
    'proprietaire', 'locataire', 'm', 'mme', 'mlle', 'monsieur', 'madame'],
  entreprise: ['entreprise', 'societe', 'pro', 'professionnel', 'professionnelle', 'personne morale', 'artisan', 'commerce',
    'commercant', 'sarl', 'sas', 'sasu', 'eurl', 'sa', 'sci', 'snc', 'ei', 'association', 'syndic', 'copropriete'],
  public: ['public', 'publique', 'secteur public', 'collectivite', 'mairie', 'commune', 'administration', 'etat',
    'departement', 'region', 'hopital', 'hopitaux', 'ecole'],
};
const TYPES_CLIENT = Object.fromEntries(Object.entries(MOTS_TYPE_CLIENT).flatMap(([valeur, mots]) => mots.map((m) => [m, valeur])));
const auSingulier = (cle) => cle.split(' ').map((mot) => (mot.length > 1 ? mot.replace(/s$/, '') : mot)).join(' ');

function typeClient(texte) {
  const cle = cleEntete(texte.replace(/\./g, '')); // « S.A.R.L. », « M. »
  const valeur = TYPES_CLIENT[cle] || TYPES_CLIENT[auSingulier(cle)];
  return valeur ? ok(valeur) : ILLISIBLE;
}

const TYPES_LOGEMENT = {
  maison: 'maison',
  appartement: 'appartement', appart: 'appartement',
  local: 'local_commercial', 'local commercial': 'local_commercial',
  immeuble: 'immeuble',
  autre: 'autre',
};

const VIDE = { valeur: null, illisible: false };
const ILLISIBLE = { valeur: null, illisible: true };
const ok = (valeur) => ({ valeur, illisible: false });

const groupesDeDeux = (dix) => ok(dix.match(/\d{2}/g).join(' '));

// Un numéro est lu seulement s'il ne porte que des chiffres, espaces, points, tirets, parenthèses et un « + » de tête.
// Deux numéros dans la cellule, « poste 12 », un numéro trop court ou du texte : illisible, jamais gardé tel quel.
const FORME_NUMERO = /^\+?[\d\s.\-()]+$/;

function telephone(texte) {
  if (!/\d/.test(texte) || !FORME_NUMERO.test(texte)) return ILLISIBLE;
  const lu = texte.replace(/^(\+\s*33|0033)\s*\(0\)/, '$1');
  const chiffres = lu.replace(/\D/g, '');
  const fr = chiffres.match(/^(?:0033|33)(\d{9})$/);
  if (fr) return groupesDeDeux('0' + fr[1]);
  const international = lu.startsWith('+') || lu.startsWith('00');
  if (!international && /^[1-9]\d{8}$/.test(chiffres)) return groupesDeDeux('0' + chiffres);
  if (!international && /^0\d{9}$/.test(chiffres)) return groupesDeDeux(chiffres);
  if (international && !/^(?:\+\s*33|0033)/.test(lu) && chiffres.length >= 8 && chiffres.length <= 15) {
    const nettoye = cleanPhone(lu.replace(/[.\-()]/g, ' '));
    return nettoye ? ok(nettoye.replace(/\s+/g, ' ')) : ILLISIBLE;
  }
  return ILLISIBLE;
}

function codePostal(texte) {
  // « 81600 CEDEX », « 81600 Cedex 2 » : les cinq chiffres de tête suivis d'autre chose qu'un chiffre.
  const cedex = texte.match(/^(\d{5})\D/);
  if (cedex) return ok(cedex[1]);
  const sansEspaces = texte.replace(/\s+/g, '');
  return ok(/^\d{4}$/.test(sansEspaces) ? '0' + sansEspaces : sansEspaces);
}

function enumeration(texte, table) {
  const valeur = table[cleEntete(texte)];
  return valeur ? ok(valeur) : ILLISIBLE;
}

/**
 * Met en forme la valeur brute d'une cellule pour le champ visé.
 * @param {{ cle: string, type: string }} champ champ du catalogue (CHAMPS)
 * @param {*} brut valeur lue dans le fichier
 * @returns {{ valeur: string|number|boolean|null, illisible: boolean }}
 */
export function normaliserValeur(champ, brut) {
  const texte = String(brut ?? '').trim();
  if (!texte) return champ.type === 'oui_non' ? ok(true) : VIDE;

  switch (champ.type) {
    case 'telephone': return telephone(texte);
    case 'code_postal': return codePostal(texte);
    case 'email': return emailsValides(texte) ? ok(texte.toLowerCase()) : ILLISIBLE;
    case 'oui_non': {
      const k = cleEntete(texte);
      if (OUI.has(k)) return ok(true);
      if (NON.has(k)) return ok(false);
      return ILLISIBLE;
    }
    case 'enum': return champ.cle === 'type_client' ? typeClient(texte) : enumeration(texte, TYPES_LOGEMENT);
    case 'nombre': {
      // Surface en m² : plus de 0 et moins de 100 000, arrondie au centième (une formule rend 85.33333333333333,
      // une colonne mal pointée un numéro de téléphone) — sinon la base refuserait tout le lot.
      const m = texte.match(/^(\d+(?:[.,]\d+)?)\s*(?:m²|m2)?$/i);
      if (!m) return ILLISIBLE;
      const surface = Math.round(parseFloat(m[1].replace(',', '.')) * 100) / 100;
      return surface > 0 && surface < 100000 ? ok(surface) : ILLISIBLE;
    }
    case 'entier': {
      const annee = /^\d{4}$/.test(texte) ? parseInt(texte, 10) : NaN;
      return annee >= 1000 && annee <= 2100 ? ok(annee) : ILLISIBLE;
    }
    default: return ok(texte);
  }
}
