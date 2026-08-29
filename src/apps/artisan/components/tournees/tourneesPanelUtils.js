// tourneesPanelUtils.js - Majord'home Artisan
// ============================================================================
// Petits formatteurs de présentation partagés entre RemplirJourneePanel,
// PropositionRow et useJourneePose. Aucune règle métier ici (le calcul vit
// dans src/lib/tournee/) — uniquement de la mise en forme texte.
// ============================================================================

/** Traduction des 3 raisons brutes du moteur (`sequencerTournee`/`classerCandidats`). */
export const RAISON_LABELS = {
  budget: 'le temps de travail dépasse déjà le budget de la journée',
  amplitude: 'le retour au dépôt dépasse déjà l’amplitude horaire',
  fenetre: 'une fenêtre horaire promise n’est déjà plus respectée',
};

/** Minutes depuis minuit -> "HH:MM". */
export function minutesEnHHMM(total) {
  const arrondi = Math.round(total);
  const h = Math.floor(arrondi / 60) % 24;
  const m = arrondi % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `error` d'ensureEntretienCard peut être une string ('client_requis') OU un objet Supabase. */
export function messageErreur(err, fallback) {
  if (!err) return fallback;
  return typeof err === 'string' ? err : (err.message || fallback);
}

/**
 * Minutes -> durée lisible : "45 min", "3 h", "2 h 30".
 * Les cartes affichaient "300 min libres" / "360 min libres" : à ce format,
 * comparer deux journées demande une division mentale à chaque carte.
 */
export function formatDuree(minutes) {
  const total = Math.round(minutes ?? 0);
  if (!Number.isFinite(total)) return '—';
  const signe = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${signe}${m} min`;
  if (m === 0) return `${signe}${h} h`;
  return `${signe}${h} h ${String(m).padStart(2, '0')}`;
}
