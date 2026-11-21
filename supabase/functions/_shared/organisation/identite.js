// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/organisation/identite.js — ne pas éditer.
// src/lib/organisation/identite.js
// ============================================================================
// Identité d'une entreprise : la SEULE définition des champs, des formats et des contrôles.
// Module PUR (aucun import) : testé par scripts/organisation-identite.test.mjs, destiné à être
// copié tel quel dans HésiaSun (spec 2026-11-21-identite-entreprise-saisie-unique-hesiasun-design.md).
//
// Deux formes d'une même valeur :
//   - la forme de SAISIE, celle que Majord'home enregistre et imprime (« 100 288 224 00015 ») ;
//   - la forme d'ENVOI, sans espaces, celle qui voyage vers un autre produit.
// ============================================================================

/** À incrémenter à tout changement de champ ou de règle : la version voyage dans chaque envoi. */
export const VERSION_IDENTITE = 1;

/** Formes juridiques proposées. */
export const LEGAL_FORMS = ['SAS', 'SAS à associé unique', 'SARL', 'EURL', 'SA', 'SCI', 'EI', 'Autre'];

/**
 * Les quinze champs de l'identité, dans l'ordre des écrans.
 * @type {{ cle: string, libelle: string, max?: number, obligatoire?: boolean }[]}
 */
export const CHAMPS_IDENTITE = [
  { cle: 'brand_name', libelle: 'Nom commercial', max: 80, obligatoire: true },
  { cle: 'legal_name', libelle: 'Raison sociale', max: 120 },
  { cle: 'legal_form', libelle: 'Forme juridique' },
  { cle: 'capital', libelle: 'Capital social' },
  { cle: 'siret', libelle: 'SIRET' },
  { cle: 'tva_intra', libelle: 'N° TVA intracommunautaire' },
  { cle: 'rcs', libelle: 'RCS', max: 80 },
  { cle: 'insurance', libelle: 'Mention assurance', max: 200 },
  { cle: 'address', libelle: 'Adresse', max: 200 },
  { cle: 'postal_code', libelle: 'Code postal' },
  { cle: 'city', libelle: 'Ville', max: 80 },
  { cle: 'phone', libelle: 'Téléphone' },
  { cle: 'website_url', libelle: 'Site web' },
  { cle: 'signatory_name', libelle: 'Signataire', max: 80 },
  { cle: 'signatory_role', libelle: 'Fonction du signataire', max: 60 },
];

/** Champs de l'onglet Identité (le chemin de l'image de signature n'est pas un champ d'identité partagé). */
export const CLES_IDENTITE = ['brand_name', 'legal_name', 'legal_form', 'capital', 'siret', 'rcs', 'tva_intra', 'insurance', 'signatory_name', 'signatory_role'];
/** Champs de l'onglet Coordonnées. */
export const CLES_COORDONNEES = ['address', 'postal_code', 'city', 'phone', 'website_url'];
/** Obligatoires à l'ÉCRAN de Coordonnées (pas à l'envoi : une entreprise en cours d'installation s'envoie quand même). */
const OBLIGATOIRES_ECRAN = new Set(['brand_name', 'address', 'postal_code', 'city', 'phone']);

const texte = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const chiffres = (v) => texte(v).replace(/\D/g, '');

// ─── Formats de saisie ──────────────────────────────────────────────────────

/**
 * SIRET par groupes 3-3-3-5 (« 100 288 224 00015 »), tronqué à 14 chiffres.
 * @param {unknown} brut
 * @returns {string}
 */
export function formatSiret(brut) {
  const d = chiffres(brut).slice(0, 14);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9), d.slice(9)].filter(Boolean).join(' ');
}

/**
 * TVA intracommunautaire affichée « FR kk SSSSSSSSS ».
 * @param {unknown} brut
 * @returns {string}
 */
export function formatTva(brut) {
  const net = texte(brut).replace(/\s/g, '').toUpperCase();
  if (!net) return '';
  const d = (net.startsWith('FR') ? net.slice(2) : net).replace(/\D/g, '').slice(0, 11);
  if (!d) return 'FR';
  return d.length <= 2 ? `FR ${d}` : `FR ${d.slice(0, 2)} ${d.slice(2)}`;
}

/**
 * Téléphone français par paires (« 05 12 34 56 78 »), tronqué à 10 chiffres.
 * @param {unknown} brut
 * @returns {string}
 */
export function formatTelephone(brut) {
  return (chiffres(brut).slice(0, 10).match(/.{1,2}/g) || []).join(' ');
}

/**
 * « exemple.fr » devient « https://exemple.fr » ; une adresse complète est laissée telle quelle.
 * @param {unknown} url
 * @returns {string}
 */
export function prefixerHttps(url) {
  const v = texte(url).trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/**
 * N° de TVA intracommunautaire français déduit du SIRET, sans espaces (« FR75100288224 »), ou '' sans SIRET
 * complet. Clé = (12 + 3 × (SIREN mod 97)) mod 97. Jamais saisi : il ne peut pas diverger de l'entreprise.
 * @param {unknown} siret
 * @returns {string}
 */
export function tvaDepuisSiret(siret) {
  const d = chiffres(siret);
  if (d.length !== 14) return '';
  const siren = d.slice(0, 9);
  const cle = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(cle).padStart(2, '0')}${siren}`;
}

/**
 * Forme de saisie (celle que Majord'home enregistre) d'une valeur, quelle que soit sa forme d'origine.
 * @param {string} cle
 * @param {unknown} valeur
 * @returns {string}
 */
export function formaterPourSaisie(cle, valeur) {
  if (cle === 'siret') return formatSiret(valeur);
  if (cle === 'tva_intra') return formatTva(valeur);
  if (cle === 'phone') return formatTelephone(valeur);
  return texte(valeur);
}

// ─── Contrôles ──────────────────────────────────────────────────────────────

const FORMATS = {
  siret: (v) => (chiffres(v).length === 14 && /^[\d\s]+$/.test(v) ? null : 'Format attendu : 14 chiffres (ex. 123 456 789 00012)'),
  tva_intra: (v) => (/^FR\s?\d{2}\s?\d{9}$/.test(v) ? null : 'Format attendu : FR + 2 chiffres + 9 chiffres'),
  postal_code: (v) => (/^\d{5}$/.test(v) ? null : '5 chiffres attendus'),
  phone: (v) => (chiffres(v).length === 10 ? null : 'Téléphone français à 10 chiffres'),
  website_url: (v) => (/^https?:\/\/\S+$/i.test(prefixerHttps(v)) ? null : 'Adresse invalide (ex. https://votre-entreprise.fr ou votre-entreprise.fr)'),
};

function controler(valeurs, cles, obligatoires) {
  const erreurs = {};
  for (const champ of CHAMPS_IDENTITE) {
    if (!cles.includes(champ.cle)) continue;
    const v = texte(valeurs?.[champ.cle]);
    if (!v.trim()) {
      if (obligatoires.has(champ.cle)) erreurs[champ.cle] = 'Obligatoire';
      continue;
    }
    if (champ.max && v.length > champ.max) erreurs[champ.cle] = `Maximum ${champ.max} caractères`;
    else if (FORMATS[champ.cle]) {
      const refus = FORMATS[champ.cle](v.trim());
      if (refus) erreurs[champ.cle] = refus;
    }
  }
  return erreurs;
}

/**
 * Contrôle d'ÉCRAN des champs d'un onglet : formats, longueurs et champs obligatoires.
 * @param {Record<string, unknown>} valeurs
 * @param {string[]} cles  champs de l'onglet (CLES_IDENTITE ou CLES_COORDONNEES)
 * @returns {Record<string, string>}  message par champ refusé, objet vide si tout va bien
 */
export function validerSaisie(valeurs, cles) {
  return controler(valeurs, cles, OBLIGATOIRES_ECRAN);
}

/**
 * Identité prête à voyager : les quinze champs, sans espaces dans les numéros, chaînes vides comprises.
 * @param {Record<string, unknown>|null|undefined} settings  réglages de l'organisation
 * @returns {{ version: number, identite: Record<string, string> }}
 */
export function identitePourEnvoi(settings) {
  const s = settings || {};
  const identite = {};
  for (const { cle } of CHAMPS_IDENTITE) {
    const v = texte(s[cle]).trim();
    if (cle === 'siret' || cle === 'phone') identite[cle] = v.replace(/\s/g, '');
    else if (cle === 'tva_intra') identite[cle] = v.replace(/\s/g, '').toUpperCase();
    else if (cle === 'website_url') identite[cle] = prefixerHttps(v);
    else identite[cle] = v;
  }
  return { version: VERSION_IDENTITE, identite };
}

/**
 * Contrôle d'ENVOI : formats et longueurs seulement, seul le nom commercial est obligatoire.
 * @param {Record<string, unknown>} identite  forme d'envoi (identitePourEnvoi(...).identite)
 * @returns {Record<string, string>}
 */
export function validerEnvoi(identite) {
  return controler(identite, CHAMPS_IDENTITE.map((c) => c.cle), new Set(['brand_name']));
}
