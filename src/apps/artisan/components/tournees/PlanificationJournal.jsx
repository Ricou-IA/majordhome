/**
 * PlanificationJournal.jsx — derniers passages du cron de figeage
 * ============================================================================
 * Lit `majordhome_planification_runs` (job `tournees-figer`) : ce que chaque
 * passage a vu, figé, refusé, laissé à arbitrer. Répond à « je ne sais pas si
 * le cron l'a fait » (Eric, 2026-09-29) — avant cette table, le rapport du
 * cron n'existait que dans net._http_response.
 * ============================================================================
 */

import { Clock } from 'lucide-react';
import { usePlanificationRuns } from '@hooks/useTournees';
import { formatDateTimeFR } from '@/lib/utils';

function compter(rapport, verdict) {
  return (rapport?.journees || []).filter((j) => j.verdict === verdict).length;
}

const REMARQUES = {
  siege_non_configure: 'Siège non configuré (Settings → Organisation → Territoire)',
  figeage_auto_off: 'Figeage automatique désactivé (réglage Tournées)',
  twilio_not_configured: 'SMS activés mais Twilio non configuré',
  org_majordhome_introuvable: 'Organisation sans module Majord’home',
};

export function PlanificationJournal({ coreOrgId }) {
  const { data: runs, isLoading, error } = usePlanificationRuns(coreOrgId, 'tournees-figer');
  const lignes = runs || [];
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-4 h-4 text-secondary-500" />
        <h3 className="text-sm font-medium text-gray-900">Figeage automatique des journées pleines</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Le cron passe toutes les heures de 7 h à 21 h et fige les journées pleines à partir du lendemain. Chaque passage laisse une trace ici.
      </p>
      {error && <p className="text-sm text-red-600">Journal illisible : {error.message}</p>}
      {!error && isLoading && <p className="text-sm text-gray-500">Chargement…</p>}
      {!error && !isLoading && lignes.length === 0 && (
        <p className="text-sm text-gray-500">Aucun passage enregistré. S’il ne laisse aucune trace, le cron ne tourne pas.</p>
      )}
      {!error && lignes.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500">
            <tr>
              <th className="text-left py-1 font-medium">Passage</th>
              <th className="text-right font-medium">Journées vues</th>
              <th className="text-right font-medium">Figées</th>
              <th className="text-right font-medium">Refusées</th>
              <th className="text-right font-medium">À arbitrer</th>
              <th className="text-left pl-3 font-medium">Remarque</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="py-1">{formatDateTimeFR(r.ran_at)}{r.dry_run ? ' (essai)' : ''}</td>
                <td className="text-right">{(r.rapport?.journees || []).length}</td>
                <td className="text-right">{compter(r.rapport, 'figee')}</td>
                <td className="text-right">{compter(r.rapport, 'refusee') + compter(r.rapport, 'erreur')}</td>
                <td className="text-right">{compter(r.rapport, 'a_arbitrer')}</td>
                <td className="pl-3 text-xs text-gray-500">
                  {r.erreur || (r.rapport?.skipped ? (REMARQUES[r.rapport.skipped] || r.rapport.skipped) : '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
