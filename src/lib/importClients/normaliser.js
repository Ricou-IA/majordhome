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

const TYPES_CLIENT = {
  particulier: 'particulier',
  entreprise: 'entreprise', societe: 'entreprise', pro: 'entreprise', professionnel: 'entreprise',
  public: 'public', collectivite: 'public', mairie: 'public', administration: 'public',
};

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
    case 'enum': return enumeration(texte, champ.cle === 'type_client' ? TYPES_CLIENT : TYPES_LOGEMENT);
    case 'nombre': {
      const m = texte.match(/^(\d+(?:[.,]\d+)?)\s*(?:m²|m2)?$/i);
      return m ? ok(parseFloat(m[1].replace(',', '.'))) : ILLISIBLE;
    }
    case 'entier': return /^\d{4}$/.test(texte) ? ok(parseInt(texte, 10)) : ILLISIBLE;
    default: return ok(texte);
  }
}
