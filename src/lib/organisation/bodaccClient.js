// src/lib/organisation/bodaccClient.js
// Annonces légales d'une entreprise (BODACC, données ouvertes de la DILA) depuis le navigateur : CORS ouvert,
// pas de clé. La lecture de la réponse est dans bodacc.js (pur, testé).
import { lireImmatriculation } from './bodacc.js';

const DELAI_MS = 8_000;
// Le capital n'est porté que par les annonces de création et de modification : on en lit assez pour le trouver.
const NOMBRE_D_ANNONCES = 40;

/**
 * RCS et capital social lus dans les annonces d'un SIREN. Lève si le service ne répond pas : l'appelant dit
 * alors que les deux champs restent à saisir, il ne bloque rien.
 * @param {string} siren  9 chiffres
 * @param {AbortSignal} [signal]
 * @returns {Promise<import('./bodacc.js').ImmatriculationBodacc>}
 */
export async function lireImmatriculationBodacc(siren, signal) {
  const net = String(siren ?? '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(net)) throw new Error('SIREN invalide');

  const url = new URL('https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records');
  url.searchParams.set('where', `registre like "${net}"`);
  url.searchParams.set('select', 'dateparution,listepersonnes');
  url.searchParams.set('order_by', 'dateparution desc');
  url.searchParams.set('limit', String(NOMBRE_D_ANNONCES));

  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(new Error('délai dépassé')), DELAI_MS);
  const relayer = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', relayer);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`annonces légales ${res.status}`);
    return lireImmatriculation(await res.json(), net);
  } finally {
    clearTimeout(minuteur);
    signal?.removeEventListener('abort', relayer);
  }
}
