// src/shared/services/trajets.service.js
// ============================================================================
// Temps de trajet entre points, avec cache persistant.
//
// Depuis le 2026-09-12, l'algorithme (cache travel_cache d'abord, Mapbox Matrix
// ensuite, vol d'oiseau en repli, matrice PARTIELLE noyau × candidats) vit dans
// src/lib/tournee/trajets-core.js, injectable — pour que l'edge slots-propose
// exécute EXACTEMENT le même calcul que l'écran. Ce service n'est plus que le
// branchement navigateur : client supabase de l'app, token Mapbox public,
// logger de l'app. Les gotchas (quota, matrice partielle, asymétrie d'org
// coreOrgId) sont documentés en tête de trajets-core.js.
// ============================================================================

import { supabase } from '@lib/supabaseClient';
import { MAPBOX_CONFIG } from '@lib/mapbox';
import { logger } from '@lib/logger';
import { creerChargeurMatrice } from '@/lib/tournee/trajets-core.js';

export const trajetsService = {
  /**
   * Charge les temps de trajet noyau↔noyau et noyau↔candidats — JAMAIS
   * candidats↔candidats (cf. trajets-core.js).
   *
   * @param {object} params
   * @param {string} params.coreOrgId org CORE (`core.organizations.id`) — PAS
   *   l'org majordhome (FK de `travel_cache`).
   * @param {Array<{lat:number,lng:number}>} params.noyau dépôt + arrêts déjà posés
   * @param {Array<{lat:number,lng:number}>} params.candidats points à évaluer
   * @returns {Promise<{ data: Map<string,number>, estime: boolean, error: any }>}
   */
  chargerMatrice({ coreOrgId, noyau, candidats }) {
    const charger = creerChargeurMatrice({
      client: supabase, coreOrgId, token: MAPBOX_CONFIG.accessToken, logger,
    });
    return charger({ noyau, candidats });
  },
};
