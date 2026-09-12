// src/lib/tournee/trajets-core.js
// ============================================================================
// Temps de trajet entre points, avec cache persistant — version INJECTABLE.
// Module « pur au sens Deno » : aucun import d'alias Vite ni de client global.
// Le client supabase, le token Mapbox, fetch et le logger sont passés à la
// fabrique, pour que le MÊME code tourne dans le navigateur
// (src/shared/services/trajets.service.js) et dans l'edge slots-propose
// (copie supabase/functions/_shared/tournee/, synchronisée et testée).
// Testé : node --test scripts/tournee/trajets-core.test.mjs
//
// Le cache n'est PAS une optimisation : le quota gratuit Mapbox Matrix est de
// 100 000 éléments/mois. Sans cache, le moteur serait muet au bout de
// quelques centaines de calculs.
//
// ⚠️ MATRICE PARTIELLE, VOLONTAIRE : cette fonction ne calcule JAMAIS les
// paires candidat↔candidat. `placerCandidat` (creneaux.js) n'évalue jamais
// qu'un seul candidat ajouté à une tournée existante — les distances entre
// deux candidats ne sont donc jamais lues par le séquenceur. La matrice utile
// est (noyau) × (noyau + candidats) dans les deux sens, où le noyau = dépôt +
// arrêts déjà posés. Un appelant qui voudrait séquencer plusieurs candidats
// ENSEMBLE devra rappeler la fonction avec ces candidats inclus dans `noyau`.
//
// ⚠️ ASYMÉTRIE D'ORG (cf. migration 20260829_1_tournees_socle.sql) :
// `majordhome.travel_cache.org_id` est FK vers `core.organizations(id)` — donc
// l'org CORE, PAS l'org majordhome. Le paramètre est nommé `coreOrgId`.
// ============================================================================

import { cleCoord, haversineKm } from './geo.js';
import { estimerParVolDOiseau } from './matrice.js';

/**
 * Fabrique un chargeur de matrice.
 *
 * @param {object} deps
 * @param {object} deps.client      client supabase-js (navigateur : `supabase` ; edge : client admin)
 * @param {string} deps.coreOrgId   org CORE (FK de travel_cache)
 * @param {string} deps.token       token Mapbox ; vide → repli vol d'oiseau signalé (`estime: true`)
 * @param {Function} [deps.fetchImpl=globalThis.fetch]
 * @param {{ error: Function }} [deps.logger=console]
 * @returns {(params: { noyau: Array<{lat,lng}>, candidats: Array<{lat,lng}> }) =>
 *   Promise<{ data: Map<string, number>, estime: boolean, error: null }>}
 */
export function creerChargeurMatrice({ client, coreOrgId, token, fetchImpl = globalThis.fetch, logger: log = console }) {
  // Plafond Mapbox : nombre TOTAL de coordonnées distinctes dans l'URL d'un
  // appel Matrix — pas le nombre de paires source×destination demandées (ça,
  // c'est le quota d'éléments/mois, distinct).
  const MAX_COORDS_MAPBOX = 25;

  /**
   * Un appel Matrix orienté : `sourcesKeys` → `destinationsKeys` (jamais les
   * deux sens dans le même appel — `chargerMatrice` fait deux appels distincts
   * pour couvrir l'aller et le retour). Les deux listes peuvent se chevaucher
   * (cas noyau×noyau) : chaque clé n'est listée qu'une fois dans l'URL,
   * sources/destinations pointent vers les mêmes index. Écrit les résultats
   * dans `paires` (mutation) et les persiste dans le cache.
   *
   * Pattern sources/destinations repris de
   * `src/apps/artisan/components/territoire/useMapZones.js::fetchDrivingTimesMatrix`
   * (points fixes en tête de la liste de coordonnées, points variables après,
   * indices recalculés par position).
   *
   * @returns {Promise<boolean>} true si l'appel a échoué (repli vol d'oiseau nécessaire)
   */
  async function fetchMatrixLot({ sourcesKeys, destinationsKeys, token, coreOrgId, paires }) {
    const cles = [...new Set([...sourcesKeys, ...destinationsKeys])];
    const index = new Map(cles.map((k, i) => [k, i]));
    const coords = cles.map((k) => { const [lat, lng] = k.split(','); return `${lng},${lat}`; }).join(';');
    const srcIdx = sourcesKeys.map((k) => index.get(k)).join(';');
    const dstIdx = destinationsKeys.map((k) => index.get(k)).join(';');

    try {
      const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}`
        + `?destinations=${dstIdx}&sources=${srcIdx}&annotations=duration&access_token=${token}`;
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const aEcrire = [];
      json.durations?.forEach((ligne, li) => {
        const from = sourcesKeys[li];
        ligne.forEach((sec, ci) => {
          const to = destinationsKeys[ci];
          // Comparaison par CLÉ (pas par index) : sourcesKeys et destinationsKeys
          // peuvent être deux listes différentes (ex. noyau → lot candidats), un
          // même index n'y désigne pas le même point.
          if (from === to || sec == null) return;
          const minutes = Math.round(sec / 60);
          paires.set(`${from}|${to}`, minutes);
          aEcrire.push({ org_id: coreOrgId, from_key: from, to_key: to, minutes });
        });
      });
      if (aEcrire.length) {
        const { error } = await client
          .from('majordhome_travel_cache')
          .upsert(aEcrire, { onConflict: 'org_id,from_key,to_key' });
        if (error) log.error('[trajets] ecriture cache impossible', error);
      }
      return false;
    } catch (err) {
      log.error('[trajets] Mapbox indisponible — repli vol d oiseau', err);
      return true;
    }
  }

    /**
     * Charge les temps de trajet noyau↔noyau et noyau↔candidats — JAMAIS
     * candidats↔candidats (cf. bloc de commentaire en tête de fichier : le
     * séquenceur n'évalue jamais deux candidats l'un contre l'autre).
     *
     * Point de sortie UNIQUE (return en toute fin de fonction) : quel que soit
     * le chemin emprunté (moins de 2 points, cache entièrement chaud, Mapbox
     * indisponible, succès partiel ou total…), le résultat traverse toujours la
     * même vérification finale avant d'être renvoyé — cf. étape 5 du corps.
     *
     * @param {object} params
     * @param {string} params.coreOrgId org CORE (`core.organizations.id`) — PAS
     *   l'org majordhome. `majordhome.travel_cache.org_id` est FK vers
     *   `core.organizations`, qui ne connaît pas l'org majordhome : y écrire
     *   l'org majordhome ferait échouer l'upsert du cache sur une violation FK.
     * @param {Array<{lat:number,lng:number}>} params.noyau points structurants
     *   (dépôt + arrêts déjà posés de la journée). Doit rester petit (≤ 9 en
     *   usage réel) — un noyau ≥ 25 points est un cas anormal (cf. plus bas) où
     *   la fonction refuse de fabriquer des chiffres et bascule en repli.
     * @param {Array<{lat:number,lng:number}>} params.candidats points à évaluer
     *   pour une insertion. Jamais comparés entre eux : pour séquencer plusieurs
     *   candidats ensemble, rappeler la fonction avec eux inclus dans `noyau`.
     * @returns {Promise<{ data: Map<string,number>, estime: boolean, error: any }>}
     *   `estime` est volontairement grossier : `true` signifie qu'AU MOINS UNE
     *   valeur de `data` est approximative (vol d'oiseau), jamais lesquelles.
     *   L'appelant/l'interface n'a besoin que de savoir qu'il doit le dire à
     *   l'utilisateur — pas de distinguer une paire exacte d'une paire estimée.
     */
  return async function chargerMatrice({ noyau, candidats }) {
    const clesNoyau = [...new Set(noyau.map(cleCoord).filter(Boolean))];
    // Un point déjà dans le noyau n'est pas redemandé comme candidat (le
    // noyau×noyau le couvre déjà).
    const clesCandidats = [...new Set(candidats.map(cleCoord).filter(Boolean))]
      .filter((c) => !clesNoyau.includes(c));
    const toutesLesCles = [...new Set([...clesNoyau, ...clesCandidats])];
    const paires = new Map();
    let estime = false;

    // 1) Paires utiles au séquenceur : noyau→(noyau ∪ candidats) et
    //    candidats→noyau. Jamais candidats→candidats. Avec moins de 2 clés
    //    au total (ou un noyau vide face à des candidats), structurellement
    //    vide — aucune garde spéciale requise, les boucles ne produisent
    //    simplement rien dans ce cas.
    const pairesUtiles = [];
    for (const a of clesNoyau) {
      for (const b of toutesLesCles) {
        if (a !== b) pairesUtiles.push([a, b]);
      }
    }
    for (const c of clesCandidats) {
      for (const n of clesNoyau) {
        pairesUtiles.push([c, n]);
      }
    }

    // 2) Cache — seulement s'il y a au moins une paire utile à chercher. Pas
    //    un raccourci de sortie (aucun `return` ici) : juste une garde qui
    //    évite un `.in()` vide et l'appel réseau quand il n'y a
    //    structurellement rien à demander. Le flux continue toujours vers
    //    l'étape 5 puis le retour unique.
    if (pairesUtiles.length > 0) {
      const { data: cache, error: cacheError } = await client
        .from('majordhome_travel_cache')
        .select('from_key, to_key, minutes')
        .eq('org_id', coreOrgId)
        .in('from_key', toutesLesCles)
        .in('to_key', toutesLesCles);
      if (cacheError) log.error('[trajets] lecture cache impossible', cacheError);
      for (const r of cache || []) paires.set(`${r.from_key}|${r.to_key}`, r.minutes);
    }

    // 3) Paires manquantes PARMI LES PAIRES UTILES SEULEMENT.
    const manquantes = pairesUtiles.filter(([a, b]) => !paires.has(`${a}|${b}`));

    // 4) Mapbox Matrix — seulement s'il reste des paires manquantes après le
    //    cache. Idem étape 2 : garde de travail utile, pas un raccourci de
    //    sortie — un appel relancé pour la même journée (même noyau, mêmes
    //    candidats, cache entièrement chaud) ne déclenche ici aucun appel
    //    Mapbox et rejoint directement l'étape 5.
    if (manquantes.length > 0) {
      // `token` vient de la fabrique (creerChargeurMatrice).

      if (clesNoyau.length >= MAX_COORDS_MAPBOX) {
        // Cas anormal : même un seul candidat ne rentre plus aux côtés du
        // noyau dans une requête. Pas de chiffres fabriqués depuis un
        // découpage bancal du noyau lui-même — on flag et on journalise,
        // l'interface doit pouvoir le dire.
        log.error(`[trajets] noyau de ${clesNoyau.length} points >= limite Mapbox (${MAX_COORDS_MAPBOX}) — repli vol d oiseau`);
        estime = true;
      } else if (!token) {
        log.error('[trajets] token Mapbox absent — repli vol d oiseau');
        estime = true;
      } else {
        const manque = (a, b) => !paires.has(`${a}|${b}`);

        // 4a) noyau × noyau — un seul appel, et seulement si une paire interne manque.
        const noyauIncomplet = clesNoyau.length >= 2
          && clesNoyau.some((a) => clesNoyau.some((b) => a !== b && manque(a, b)));
        if (noyauIncomplet) {
          const echec = await fetchMatrixLot({ sourcesKeys: clesNoyau, destinationsKeys: clesNoyau, token, coreOrgId, paires });
          if (echec) estime = true;
        }

        // 4b) noyau ↔ candidats — seulement les candidats ayant encore une
        //     paire manquante avec le noyau (dans un sens ou l'autre). Lots
        //     dimensionnés pour que noyau + lot <= 25, noyau ENTIER réinjecté
        //     dans CHAQUE appel (pattern useMapZones.js::fetchDrivingTimesMatrix).
        const candidatsAFetcher = clesCandidats.filter((c) =>
          clesNoyau.some((n) => manque(n, c) || manque(c, n))
        );
        const tailleLot = MAX_COORDS_MAPBOX - clesNoyau.length;
        for (let i = 0; i < candidatsAFetcher.length; i += tailleLot) {
          const lot = candidatsAFetcher.slice(i, i + tailleLot);
          const echecAller = await fetchMatrixLot({ sourcesKeys: clesNoyau, destinationsKeys: lot, token, coreOrgId, paires });
          const echecRetour = await fetchMatrixLot({ sourcesKeys: lot, destinationsKeys: clesNoyau, token, coreOrgId, paires });
          if (echecAller || echecRetour) estime = true;
        }
      }

      // 4c) Ce qui manque encore est estimé — et l'UI doit le dire (cf. spec
      //     §10). Rendu redondant par l'étape 5 (round 2) : gardé tel quel,
      //     cette redondance ne coûte rien (cf. rapport fix round 2).
      if (estime) {
        const parCle = new Map([...noyau, ...candidats].filter(cleCoord).map((p) => [cleCoord(p), p]));
        for (const [a, b] of manquantes) {
          if (paires.has(`${a}|${b}`)) continue;
          const pa = parCle.get(a);
          const pb = parCle.get(b);
          if (pa && pb) paires.set(`${a}|${b}`, estimerParVolDOiseau(haversineKm(pa, pb)));
        }
      }
    }

    // 5) GARANTIE STRUCTURELLE (pas défensive) : POINT DE PASSAGE OBLIGÉ avant
    //    l'unique retour de la fonction, y compris sur les chemins triviaux
    //    ci-dessus (moins de 2 clés, cache entièrement chaud) — sur ces
    //    chemins, `pairesUtiles` y est soit vide, soit déjà entièrement
    //    couverte par le cache, donc cette boucle ne trouve rien à faire et
    //    `estime` reste `false`, sans qu'aucun raisonnement sur « le chemin
    //    d'à côté est correct aujourd'hui » n'ait à être vrai pour ça — c'est
    //    précisément ce qui a cassé trois fois dans ce fichier (rounds 1-2) :
    //    une propriété vraie par construction d'un chemin voisin, jusqu'à ce
    //    que ce chemin change. On ne cherche PAS à énumérer les chemins
    //    d'échec possibles de Mapbox (lot manquant, payload malformé sur un
    //    200, `durations` absent/incomplet, durée `null` pour une route
    //    injoignable, ou une cause qu'on n'a pas encore imaginée) : on
    //    compare simplement le résultat réel (`paires`) à l'ensemble des
    //    paires attendues (`pairesUtiles`, calculé en 1) et on comble ce qui
    //    manque encore, quelle qu'en soit la cause.
    const parCleFinal = new Map([...noyau, ...candidats].filter(cleCoord).map((p) => [cleCoord(p), p]));
    for (const [a, b] of pairesUtiles) {
      if (paires.has(`${a}|${b}`)) continue;
      estime = true;
      const pa = parCleFinal.get(a);
      const pb = parCleFinal.get(b);
      if (pa && pb) {
        paires.set(`${a}|${b}`, estimerParVolDOiseau(haversineKm(pa, pb)));
      } else {
        log.error(`[trajets] paire "${a}|${b}" sans coordonnees exploitables — impossible a estimer par vol d oiseau`);
      }
    }

    return { data: paires, estime, error: null };
  };
}
