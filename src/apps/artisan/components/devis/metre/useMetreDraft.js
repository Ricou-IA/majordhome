// src/apps/artisan/components/devis/metre/useMetreDraft.js
// Saisie en cours du métré, par utilisateur ET par dossier (filet anti-perte, pas un enregistrement).
// Dossier = lead, sinon carte SAV, sinon devis modifié (CreateDevisModal). Sans dossier, pas de brouillon :
// une clé commune « sans-lead » faisait ressortir le relevé d'un dossier sur le devis d'un autre.
// Le brouillon survit à l'injection ; il est effacé quand le métré est enregistré avec le devis.
import { useCallback, useEffect, useState } from 'react';
import { logger } from '@lib/logger';

const key = (userId, dossier) => `fum-metre-draft:${userId || 'anon'}:${dossier}`;

function lire(userId, dossier) {
  if (!dossier) return null;
  try { const raw = localStorage.getItem(key(userId, dossier)); return raw ? JSON.parse(raw) : null; } catch (e) { logger.warn('[useMetreDraft] lecture', e); return null; }
}

/** Efface le brouillon d'un dossier (après l'enregistrement du métré). */
export function effacerBrouillonMetre(userId, dossier) {
  if (!dossier) return;
  try { localStorage.removeItem(key(userId, dossier)); } catch (e) { logger.warn('[useMetreDraft] effacement', e); }
}

export function useMetreDraft(userId, dossier) {
  const [draft, setDraft] = useState(() => lire(userId, dossier));
  useEffect(() => {
    if (!dossier) return;
    try { if (draft) localStorage.setItem(key(userId, dossier), JSON.stringify(draft)); else localStorage.removeItem(key(userId, dossier)); } catch (e) { logger.warn('[useMetreDraft] écriture', e); }
  }, [draft, userId, dossier]);
  const clear = useCallback(() => setDraft(null), []);
  return { draft, setDraft, clear };
}
