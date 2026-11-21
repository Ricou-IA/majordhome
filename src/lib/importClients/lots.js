// src/lib/importClients/lots.js
// Découpage en lots, exécution reprenable et messages d'erreur de l'import de clients — module PUR (aucun import),
// testé par scripts/import-clients/lots.test.mjs.

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

/**
 * Phrase lisible pour une erreur de la base d'import. Le code est lu dans `error.message`, comme mot entier
 * (il peut être entouré d'autres textes) ; un message inconnu est rendu tel quel.
 * @param {{ message?: string } | null | undefined} error
 * @returns {string}
 */
export function messageErreurImport(error) {
  const message = error?.message;
  if (!message) return 'Erreur inconnue';
  for (const code of Object.keys(MESSAGES)) {
    if (new RegExp(`\\b${code}\\b`).test(message)) return MESSAGES[code];
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
