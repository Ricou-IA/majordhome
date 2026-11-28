// src/apps/artisan/components/devis/metre/useFabricantPrefere.js
// Dernier fabricant de fumisterie choisi pour l'organisation, présélectionné au métré suivant (pas de
// défaut fixe dans les réglages pour l'instant, décision du 2026-11-28). Clé suffixée par l'org.
import { useCallback, useState } from 'react';
import { logger } from '@lib/logger';

const cle = (orgId) => `fum-fabricant:${orgId || 'sans-org'}`;

export function useFabricantPrefere(orgId) {
  const [choix, setChoix] = useState(() => {
    try { return localStorage.getItem(cle(orgId)); } catch (e) { logger.warn('[useFabricantPrefere] lecture', e); return null; }
  });
  const choisir = useCallback((supplierId) => {
    setChoix(supplierId);
    try { localStorage.setItem(cle(orgId), supplierId); } catch (e) { logger.warn('[useFabricantPrefere] écriture', e); }
  }, [orgId]);
  return [choix, choisir];
}
