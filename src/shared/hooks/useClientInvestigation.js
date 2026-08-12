/**
 * useClientInvestigation.js — Interroge la donnée bâtiment publique d'un client
 * ============================================================================
 * Enrobe le module pur `src/lib/dpeApi.js` dans React Query.
 *
 * LECTURE SEULE, ZÉRO ÉCRITURE EN BASE : rien n'est persisté côté Supabase
 * (décision produit 2026-08-12 — on mesure d'abord si la donnée est exploitable).
 * Le seul état conservé est un compteur de taux de réponse en `sessionStorage`,
 * suffixé par `userId` conformément à la règle multi-tenant des clés locales.
 *
 * `enabled` est piloté par l'ouverture du panneau : aucune requête n'est tirée
 * tant que personne n'a cliqué sur « Investiguer ».
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { investigateAddress, buildAddressQuery, PROXIMITY_RADIUS_M } from '@/lib/dpeApi';
import { investigationKeys } from './cacheKeys';
import { logger } from '@/lib/logger';

const TALLY_PREFIX = 'mdh:investigation-tally';
const EMPTY_TALLY = { total: 0, withData: 0 };

const tallyKey = (userId) => `${TALLY_PREFIX}:${userId || 'anon'}`;

/** Rayon exploitable, ou le défaut. Voir la garde dans la valeur de retour. */
const safeRadius = (v) => (Number.isFinite(v) && v > 0 ? v : PROXIMITY_RADIUS_M);

/**
 * Le compteur est indexé PAR ADRESSE, pas incrémenté à chaque appel : sinon un
 * simple re-render ou un retour sur la fiche gonflerait le taux de réponse et
 * on prendrait une mauvaise décision sur la généralisation.
 */
function readRaw(userId) {
  try {
    const raw = sessionStorage.getItem(tallyKey(userId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    logger.warn('[investigation] compteur illisible', err);
    return {};
  }
}

function summarize(map) {
  const values = Object.values(map);
  return {
    total: values.length,
    withData: values.filter(Boolean).length,
  };
}

export function readInvestigationTally(userId) {
  return summarize(readRaw(userId));
}

function recordOutcome(userId, addressKey, hasData) {
  const map = readRaw(userId);
  // Une adresse déjà comptée avec un résultat ne redescend pas à 0
  map[addressKey] = Boolean(map[addressKey]) || Boolean(hasData);
  try {
    sessionStorage.setItem(tallyKey(userId), JSON.stringify(map));
  } catch (err) {
    logger.warn('[investigation] compteur non enregistré', err);
  }
  return summarize(map);
}

/**
 * @param {object} client - Fiche client (`address`, `postal_code`, `city`)
 * @param {{enabled?: boolean}} options - `enabled` = panneau ouvert
 */
export function useClientInvestigation(client, { enabled = false } = {}) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const userId = user?.id;

  const addressKey = buildAddressQuery({
    address: client?.address,
    postalCode: client?.postal_code,
    city: client?.city,
  });

  const [tally, setTally] = useState(EMPTY_TALLY);

  // La recherche par voisinage est un GESTE de l'utilisateur, jamais un repli
  // automatique : un DPE à 51 m est celui du voisin. Remise à zéro dès que
  // l'adresse change, pour ne pas élargir en douce sur la fiche suivante.
  const [includeNearby, setIncludeNearby] = useState(false);
  const [nearbyRadius, setNearbyRadius] = useState(PROXIMITY_RADIUS_M);
  useEffect(() => {
    setIncludeNearby(false);
    setNearbyRadius(PROXIMITY_RADIUS_M);
  }, [addressKey]);

  // sessionStorage n'est lisible qu'après montage (et peut être indisponible)
  useEffect(() => {
    setTally(readInvestigationTally(userId));
  }, [userId]);

  const query = useQuery({
    queryKey: investigationKeys.byAddress(
      orgId,
      addressKey,
      includeNearby ? `nearby:${nearbyRadius}` : 'exact'
    ),
    queryFn: ({ signal }) =>
      investigateAddress(
        {
          address: client?.address,
          postalCode: client?.postal_code,
          city: client?.city,
        },
        { signal, includeNearby, radiusM: nearbyRadius }
      ),
    enabled: enabled && !!orgId && !!addressKey,
    staleTime: 30 * 60 * 1000, // la donnée DPE ne bouge pas dans une session
    retry: 1,
  });

  const result = query.data ?? null;

  useEffect(() => {
    // On ne compte que les verdicts francs. Une panne réseau n'est pas une
    // absence de donnée : la compter fausserait le taux de réponse à la baisse.
    if (!addressKey || !result) return;
    if (result.status !== 'ok' && result.status !== 'no_dpe') return;
    setTally(recordOutcome(userId, addressKey, result.records.length > 0));
  }, [result, addressKey, userId]);

  const resetTally = useCallback(() => {
    try {
      sessionStorage.removeItem(tallyKey(userId));
    } catch (err) {
      logger.warn('[investigation] compteur non réinitialisé', err);
    }
    setTally(EMPTY_TALLY);
  }, [userId]);

  return {
    result,
    isLoading: query.isFetching,
    // `investigateAddress` ne throw pas : une erreur ressort dans result.status
    error: query.error,
    hasAddress: !!addressKey,
    refetch: query.refetch,
    tally,
    resetTally,
    includeNearby,
    nearbyRadius,
    // Garde sur le rayon : ces deux fonctions finissent branchées sur des
    // `onClick`, et un `onClick={searchNearby}` passerait l'événement React en
    // 1ᵉʳ argument. Un objet dans l'URL donne `geo_distance=lon,lat,[object
    // Object]` → HTTP 400, et le panneau affiche « Service indisponible » alors
    // que la panne est chez nous. On ignore toute valeur non numérique.
    searchNearby: (radiusM) => {
      setNearbyRadius(safeRadius(radiusM));
      setIncludeNearby(true);
    },
    setNearbyRadius: (radiusM) => setNearbyRadius(safeRadius(radiusM)),
  };
}
