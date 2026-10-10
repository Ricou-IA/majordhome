// src/apps/artisan/pages/settings/team/memberPresentation.js
// ============================================================================
// Vocabulaire et mise en forme partagés entre la synthèse (TeamManagement) et
// la fiche membre (MemberModal). Module pur, sans React : évite d'exporter des
// constantes depuis un fichier composant (react-refresh).
// ============================================================================

export const getRoleColor = (role) => {
  switch (role) {
    case 'org_admin':   return 'bg-purple-100 text-purple-700';
    case 'team_leader': return 'bg-blue-100 text-blue-700';
    case 'commercial':  return 'bg-amber-100 text-amber-700';
    case 'technicien':  return 'bg-green-100 text-green-700';
    default:            return 'bg-secondary-100 text-secondary-700';
  }
};

export const getInitials = (name) => {
  if (!name) return '?';
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
};

// Porte `team_members.include_in_routing`. L'ancien interrupteur sans libellé
// n'était lisible qu'au survol : Eric ne savait pas où indiquer qu'un
// technicien est un sous-traitant ponctuel (2026-09-29). Le vocabulaire est
// celui de l'usage, pas celui du moteur.
export const PLANIFICATION_OPTIONS = [
  { value: 'machine', label: 'Par la machine' },
  { value: 'main', label: 'À la main (sous-traitant ponctuel)' },
];

export const PLANIFICATION_HELP = {
  machine: 'Salarié : proposé par les tournées et l’auto-RDV.',
  main: 'Jamais proposé par la machine ; assignable dans le Planning (installations).',
};

export const planificationDe = (includeInRouting) => ((includeInRouting ?? true) ? 'machine' : 'main');

export const DAILY_WORK_MINUTES_HELP =
  'Trajets + interventions, pause exclue. Distinct des horaires, qui bornent seulement les heures de placement.';

/** « 8 h », « 7 h 30 » — pour la synthèse. */
export const formatBudget = (minutes) => {
  const m = minutes ?? 480;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')}`;
};
