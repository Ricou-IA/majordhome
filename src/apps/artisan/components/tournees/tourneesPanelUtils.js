// tourneesPanelUtils.js - Majord'home Artisan
// ============================================================================
// Petits formatteurs de présentation partagés entre RemplirJourneePanel,
// PropositionRow, useJourneePose et les cartes du tableau de bord. Aucune règle
// métier ici (le calcul vit dans src/lib/tournee/) — uniquement de la mise en
// forme texte et le lien vers une journée du Planning.
// ============================================================================

/**
 * Traduction des motifs de rejet du moteur (`creneaux.js::placerCandidat`).
 * Ils portent tous sur le CANDIDAT qu'on essaie d'insérer, jamais sur la
 * journée elle-même : depuis creneaux.js, une journée déjà posée n'est plus
 * jugée « infaisable », elle est.
 */
export const RAISON_LABELS = {
  creneau: 'aucun créneau libre assez grand entre deux rendez-vous',
  budget: 'le temps de travail de la journée serait dépassé',
  pause: 'il ne resterait plus de quoi déjeuner',
  position: 'ce client n’est pas géolocalisé',
};

/**
 * Lien vers une journée de technicien dans le Planning : le calendrier s'ouvre
 * sur la date et le panneau de remplissage sur la journée (lu par Planning.jsx).
 * Source unique — tableau de bord des entretiens, alertes, journées à arbitrer.
 */
export function lienJourneePlanning({ date, technicienId }) {
  return `/planning?journee=${date}&tech=${technicienId}`;
}

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
