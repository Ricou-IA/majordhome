/**
 * AutoRdvMois.jsx — la prise de rendez-vous en ligne, mois en cours
 * ============================================================================
 * Compteurs des invitations du mois (majordhome_auto_rdv_invitations) : mails
 * envoyés, pages ouvertes, rendez-vous pris, sans créneau, à appeler. Ce que le
 * cron a rendu inutile d'appeler, et ce qui reste à appeler.
 * ============================================================================
 */

import { MailCheck } from 'lucide-react';
import { useInvitationsDuMois } from '@hooks/useTournees';

const CASES = [
  ['invitees', 'Invités par mail'],
  ['ouvertes', 'Pages ouvertes'],
  ['prises', 'Rendez-vous pris'],
  ['sans_creneau', 'Sans créneau'],
  ['a_appeler', 'À appeler'],
];

export function AutoRdvMois({ coreOrgId }) {
  const { compteurs, isLoading, error } = useInvitationsDuMois(coreOrgId);
  const mois = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <MailCheck className="w-4 h-4 text-secondary-500" />
        <h3 className="text-sm font-medium text-gray-900">Prise de rendez-vous en ligne, {mois}</h3>
      </div>
      {error && <p className="text-sm text-red-600">Invitations illisibles : {error.message}</p>}
      {!error && isLoading && <p className="text-sm text-gray-500">Chargement…</p>}
      {!error && !isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {CASES.map(([k, label]) => (
            <div key={k} className="rounded-md bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-xl font-semibold text-gray-900">{compteurs[k]}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
