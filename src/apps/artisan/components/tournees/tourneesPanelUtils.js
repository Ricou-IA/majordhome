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
