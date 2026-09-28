// src/apps/artisan/components/devis/metre/useMetreDraft.js
// Saisie en cours du métré, par utilisateur (réseau garanti : ce n'est qu'un filet anti-perte).
import { useCallback, useEffect, useState } from 'react';
import { logger } from '@lib/logger';

const key = (userId) => `fum-metre-draft:${userId || 'anon'}`;

export function useMetreDraft(userId) {
  const [draft, setDraft] = useState(() => {
    try { const raw = localStorage.getItem(key(userId)); return raw ? JSON.parse(raw) : null; } catch (e) { logger.warn('[useMetreDraft] lecture', e); return null; }
  });
  useEffect(() => {
    try { if (draft) localStorage.setItem(key(userId), JSON.stringify(draft)); else localStorage.removeItem(key(userId)); } catch (e) { logger.warn('[useMetreDraft] écriture', e); }
  }, [draft, userId]);
  const clear = useCallback(() => setDraft(null), []);
  return { draft, setDraft, clear };
}
