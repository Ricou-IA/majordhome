// src/apps/artisan/components/devis/metre/useMetreDraft.js
// Saisie en cours du métré, par utilisateur ET par lead (réseau garanti : ce n'est qu'un filet
// anti-perte). Sans lead dans la clé, le brouillon d'un chantier ressortait sur le devis d'un autre.
import { useCallback, useEffect, useState } from 'react';
import { logger } from '@lib/logger';

const key = (userId, leadId) => `fum-metre-draft:${userId || 'anon'}:${leadId || 'sans-lead'}`;

export function useMetreDraft(userId, leadId) {
  const [draft, setDraft] = useState(() => {
    try { const raw = localStorage.getItem(key(userId, leadId)); return raw ? JSON.parse(raw) : null; } catch (e) { logger.warn('[useMetreDraft] lecture', e); return null; }
  });
  useEffect(() => {
    try { if (draft) localStorage.setItem(key(userId, leadId), JSON.stringify(draft)); else localStorage.removeItem(key(userId, leadId)); } catch (e) { logger.warn('[useMetreDraft] écriture', e); }
  }, [draft, userId, leadId]);
  const clear = useCallback(() => setDraft(null), []);
  return { draft, setDraft, clear };
}
