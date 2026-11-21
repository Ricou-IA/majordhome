// src/lib/organisation/annuaireClient.js
// Appel de l'annuaire des entreprises (recherche-entreprises.api.gouv.fr) depuis le navigateur :
// CORS ouvert, pas de clé. La lecture de la réponse est dans annuaire.js (pur, testé).
import { lireSuggestions } from './annuaire.js';

const DELAI_MS = 8_000;
const NOMBRE_DE_PROPOSITIONS = 6;

/**
 * Jusqu'à six entreprises pour un nom, un SIREN ou un SIRET (espaces tolérés).
 * Moins de trois caractères : liste vide sans appel. Lève si l'annuaire ne répond pas.
 * @param {string} requete
 * @param {AbortSignal} [signal]
 * @returns {Promise<import('./annuaire.js').EntrepriseAnnuaire[]>}
 */
export async function chercherEntreprises(requete, signal) {
  const brut = String(requete ?? '').trim();
  if (brut.length < 3) return [];
  // Un numéro tapé par groupes (« 100 288 224 00015 ») est envoyé sans espaces.
  const q = /^[\d\s]+$/.test(brut) ? brut.replace(/\s/g, '') : brut;

  const url = new URL('https://recherche-entreprises.api.gouv.fr/search');
  url.searchParams.set('q', q);
  url.searchParams.set('page', '1');
  url.searchParams.set('per_page', String(NOMBRE_DE_PROPOSITIONS));

  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(new Error('délai dépassé')), DELAI_MS);
  const relayer = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', relayer);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    // 404 : rien de connu pour cette saisie (l'API répond ainsi à certains numéros).
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`annuaire ${res.status}`);
    return lireSuggestions(await res.json(), q);
  } finally {
    clearTimeout(minuteur);
    signal?.removeEventListener('abort', relayer);
  }
}
