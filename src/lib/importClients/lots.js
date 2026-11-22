// src/lib/importClients/lots.js
// Découpage en lots, exécution reprenable, contrôle d'une ligne avant envoi et messages d'erreur de l'import de
// clients — module PUR (imports relatifs seulement), testé par scripts/import-clients/lots.test.mjs.

import { CHAMPS } from './champs.js';

/** Fiches envoyées par appel d'écriture (mesuré : 70 à 215 ms par lot de 200). */
export const TAILLE_LOT = 200;

/** Fiches retirées par appel de retrait (la production a plus de clés étrangères que le harnais ; un appel est coupé à 8 s). */
export const TAILLE_LOT_RETRAIT = 100;

/**
 * Découpe une liste en lots de taille fixe, sans perte ni doublon.
 * @template T
 * @param {T[]} lignes
 * @param {number} [taille]
 * @returns {T[][]}
 */
export function decouperEnLots(lignes, taille = TAILLE_LOT) {
  const lots = [];
  for (let i = 0; i < lignes.length; i += taille) lots.push(lignes.slice(i, i + taille));
  return lots;
}

// ── Ce que `clients_import_batch` accepte (migration 20261121_13), clé par clé ──────────────────────────────
// Toute différence entre ces règles et la RPC fait refuser un lot entier : les deux se modifient ensemble.

const INVALIDE = Symbol('invalide');
const CATEGORIES = ['particulier', 'entreprise', 'public']; // enum majordhome.client_category
const LOGEMENTS = ['maison', 'appartement', 'local_commercial', 'immeuble', 'autre']; // enum majordhome.housing_type

/**
 * Lecture de `clients_import_texte` : chaîne ou nombre, espaces de bord retirés (btrim), vide ⇒ null ; un nombre
 * non fini part en `null` dans le JSON ; tout autre type est refusé.
 */
function texteBase(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.replace(/^ +| +$/g, '') || null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  return INVALIDE;
}

const REGLES = {
  display_name: (t) => t !== null,
  client_category: (t) => t === null || CATEGORIES.includes(t),
  housing_type: (t) => t === null || LOGEMENTS.includes(t),
  surface: (t) => t === null || /^[0-9]{1,9}([.,][0-9]{1,4})?$/.test(t),
  construction_year: (t) => t === null || /^[0-9]{1,4}$/.test(t),
};
const CONSENTEMENTS = ['mail_optin', 'sms_optin'];

/**
 * Colonne d'une ligne que `clients_import_batch` refuserait (`row_invalid`), ou null si la ligne passe.
 * @param {Record<string, unknown> | null | undefined} ligne
 * @returns {string | null}
 */
export function verifierLigne(ligne) {
  if (!ligne || typeof ligne !== 'object' || Array.isArray(ligne)) return 'import_line';
  const n = ligne.import_line;
  if (!Number.isInteger(n) || n < 1 || n > 999999999) return 'import_line';
  if (!('display_name' in ligne)) return 'display_name';
  for (const [colonne, v] of Object.entries(ligne)) {
    if (colonne === 'import_line') continue;
    if (CONSENTEMENTS.includes(colonne)) {
      if (v !== undefined && v !== null && typeof v !== 'boolean') return colonne;
      continue;
    }
    const t = texteBase(v);
    if (t === INVALIDE) return colonne;
    const regle = REGLES[colonne];
    if (regle && !regle(t)) return colonne;
  }
  return null;
}

// ── Messages ─────────────────────────────────────────────────────────────────────────────────────────────────

const MESSAGES = {
  unauthenticated: 'Votre session a expiré : reconnectez-vous.',
  org_admin_required: 'Réservé à l\'administrateur de l\'entreprise.',
  import_not_found: 'Cet import est introuvable.',
  import_closed: 'Cet import est déjà terminé.',
  rows_invalid: 'Une ligne du fichier n\'a pas pu être écrite : aucune fiche de ce lot n\'a été créée.',
  row_invalid: 'Une ligne du fichier n\'a pas pu être écrite : aucune fiche de ce lot n\'a été créée.',
  file_name_required: 'Le nom du fichier est manquant.',
  removal_incomplete: 'Le retrait n\'a pas pu aller au bout : rien n\'a été retiré par cet appel. Réessayez.',
};

const DELAI = 'La base a mis trop de temps à répondre. Réessayez dans un instant.';
const RESEAU = 'Connexion interrompue. Vérifiez votre réseau, puis reprenez.';
const EN_COURS = 'Ces lignes sont déjà en cours d\'écriture par un autre envoi. Reprenez dans un instant.';

const libelleColonne = (colonne) => CHAMPS.find((c) => c.colonne === colonne)?.libelle || colonne;
const contient = (texte, code) => new RegExp(`\\b${code}\\b`).test(texte);

/**
 * Phrase lisible pour une erreur de la base d'import. Le code est lu dans `error.message` (mot entier, il peut être
 * entouré d'autres textes), le détail d'une ligne refusée dans `error.details` (« ligne N : colonne »), le code
 * PostgreSQL dans `error.code` ; un message inconnu est rendu tel quel.
 * @param {{ message?: string, details?: string, code?: string } | Error | null | undefined} error
 * @returns {string}
 */
export function messageErreurImport(error) {
  const message = error?.message || '';
  const details = typeof error?.details === 'string' ? error.details : '';
  const code = error?.code;

  if (contient(message, 'row_invalid')) {
    const m = details.match(/ligne (\d+) : ([a-z_]+)/);
    if (m) return `Ligne ${m[1]} du fichier : la valeur « ${libelleColonne(m[2])} » est refusée. Aucune fiche de ce lot n'a été créée.`;
  }
  if (code === '57014' || code === '55P03') return DELAI;
  if (code === '23505' && `${message} ${details}`.includes('clients_import_line_key')) return EN_COURS;
  if (error instanceof TypeError || /Failed to fetch|NetworkError/.test(message)) return RESEAU;
  if (!message) return 'Erreur inconnue';
  for (const cle of Object.keys(MESSAGES)) {
    if (contient(message, cle)) return MESSAGES[cle];
  }
  return message;
}

/**
 * Envoie les lots l'un après l'autre à partir du lot `depuis`, et s'arrête au premier refus.
 * `envoyer` résout avec `{ created, skipped }` ou REJETTE ; `prochain` est l'indice du premier lot non confirmé
 * (le lot refusé compris : la base ignore les lignes déjà écrites, on peut le renvoyer).
 * @param {{ lots: unknown[][], depuis: number, envoyer: (lot: unknown[], index: number) => Promise<{ created?: number, skipped?: number }> }} params
 * @returns {Promise<{ created: number, skipped: number, faits: number, prochain: number, erreur: unknown }>}
 */
export async function executerLots({ lots, depuis, envoyer }) {
  let created = 0;
  let skipped = 0;
  let prochain = depuis;
  while (prochain < lots.length) {
    let rendu;
    try {
      rendu = await envoyer(lots[prochain], prochain);
    } catch (erreur) {
      return { created, skipped, faits: created + skipped, prochain, erreur };
    }
    created += rendu?.created ?? 0;
    skipped += rendu?.skipped ?? 0;
    prochain += 1;
  }
  return { created, skipped, faits: created + skipped, prochain, erreur: null };
}

/**
 * Lit la réponse d'un appel de retrait. Une réponse nulle ou sans nombres `retirees` / `restantes` n'est PAS un
 * succès : le retrait n'est pas confirmé, on rejette plutôt que de conclure « rien à retirer ».
 * @param {{ retirees?: number, conservees?: number, restantes?: number } | null | undefined} lot
 * @returns {{ retirees: number, conservees: number, restantes: number }}
 */
export function lireReponseRetrait(lot) {
  if (!lot || !Number.isFinite(lot.retirees) || !Number.isFinite(lot.restantes)) {
    throw new Error("Réponse inattendue de la base : le retrait n'est pas confirmé.");
  }
  return { retirees: lot.retirees, conservees: Number.isFinite(lot.conservees) ? lot.conservees : 0, restantes: lot.restantes };
}
