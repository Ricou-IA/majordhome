/**
 * useContractZone.js
 * ============================================================================
 * Détection de la zone tarifaire d'un contrat à partir de l'adresse client.
 *
 * Logique (par ordre de priorité) :
 *   1. Si le contrat a un zone_id non-défaut stocké → on l'utilise
 *   2. Sinon, détection Mapbox (temps de trajet Gaillac → client)
 *   3. Fallback sync : matching par département (CP)
 *   4. Fallback final : zone par défaut (Hors Zone)
 *
 * Hiérarchie métier : Client (adresse) → Zone → Équipement → Prix
 * ============================================================================
 */

import { useEffect, useMemo, useState } from 'react';
import { detectZoneForAddress, detectZoneFromPostalCode } from '@services/pricing.service';

export function useContractZone(client, contract, zones) {
  const [asyncZone, setAsyncZone] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(null);

  // 1. Zone stockée non-défaut → priorité absolue
  const storedZone = useMemo(() => {
    if (!contract?.zone_id || !zones?.length) return null;
    const z = zones.find((x) => x.id === contract.zone_id);
    return z && !z.is_default ? z : null;
  }, [contract?.zone_id, zones]);

  // 2. Détection async Mapbox depuis adresse client
  // On calcule TOUJOURS la durée (info utile), même si la zone est déjà stockée
  // - asyncZone n'écrase pas storedZone (cf. activeZone plus bas)
  // - durationMinutes est affiché pour info dans l'UI
  useEffect(() => {
    if (!client?.postal_code || !zones?.length) {
      setAsyncZone(null);
      setDurationMinutes(null);
      return;
    }

    let cancelled = false;
    setIsDetecting(true);

    (async () => {
      try {
        const result = await detectZoneForAddress(
          client.address || '',
          client.postal_code,
          client.city || '',
          zones
        );
        if (cancelled) return;
        setAsyncZone(result.zone);
        setDurationMinutes(result.durationMinutes);
      } catch (err) {
        console.warn('[useContractZone] detection error:', err);
      } finally {
        if (!cancelled) setIsDetecting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client?.address, client?.postal_code, client?.city, zones]);

  // 3. Fallback sync département (si Mapbox pas encore résolu)
  const fallbackZone = useMemo(() => {
    if (!client?.postal_code || !zones?.length) return null;
    return detectZoneFromPostalCode(client.postal_code, zones);
  }, [client?.postal_code, zones]);

  // 4. Zone effective — on privilégie la détection dynamique pour que tout
  //    changement d'adresse cascade automatiquement sur la zone/tarif du contrat.
  //    storedZone ne sert que de fallback tant que l'async n'a pas répondu.
  const activeZone =
    asyncZone ||
    storedZone ||
    fallbackZone ||
    (zones?.length ? zones.find((z) => z.is_default && z.is_active) : null) ||
    null;

  return { activeZone, isDetecting, durationMinutes };
}
