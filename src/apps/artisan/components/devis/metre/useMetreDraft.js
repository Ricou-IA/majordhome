// src/apps/artisan/components/devis/metre/useMetreDraft.js
// Saisie en cours du métré, par utilisateur ET par dossier (filet anti-perte, pas un enregistrement).
// Dossier = devis modifié, sinon lead, sinon carte SAV (CreateDevisModal). Sans dossier, pas de brouillon :
// une clé commune « sans-lead » faisait ressortir le relevé d'un dossier sur le devis d'un autre.
// Le brouillon survit à l'ajout au devis ; il est effacé quand le métré est enregistré avec le devis.
// Un brouillon de plus de 30 jours est ignoré et retiré (brouillonValide, src/lib/fumisterie/brouillon.js).
import { useCallback, useEffect, useState } from 'react';
import { logger } from '@lib/logger';
import { brouillonValide } from '@/lib/fumisterie/brouillon.js';

const key = (userId, dossier) => `fum-metre-draft:${userId || 'anon'}:${dossier}`;

/** Efface le brouillon d'un dossier, tout de suite (après l'enregistrement du métré, ou « Supprimer le brouillon »). */
export function effacerBrouillonMetre(userId, dossier) {
  if (!dossier) return;
  try { localStorage.removeItem(key(userId, dossier)); } catch (e) { logger.warn('[useMetreDraft] effacement', e); }
}

function lire(userId, dossier) {
  if (!dossier) return null;
  try {
    const raw = localStorage.getItem(key(userId, dossier));
    const d = raw ? JSON.parse(raw) : null;
    if (d && !brouillonValide(d)) { effacerBrouillonMetre(userId, dossier); return null; }
    return d;
  } catch (e) { logger.warn('[useMetreDraft] lecture', e); return null; }
}

export function useMetreDraft(userId, dossier) {
  const [draft, setDraft] = useState(() => lire(userId, dossier));
  useEffect(() => {
    if (!dossier || !draft) return;
    try { localStorage.setItem(key(userId, dossier), JSON.stringify(draft)); } catch (e) { logger.warn('[useMetreDraft] écriture', e); }
  }, [draft, userId, dossier]);
  // Synchrone : la fenêtre peut se fermer (démontage) dans le même geste, l'effet ne passerait plus.
  const clear = useCallback(() => { effacerBrouillonMetre(userId, dossier); setDraft(null); }, [userId, dossier]);
  return { draft, setDraft, clear };
}
