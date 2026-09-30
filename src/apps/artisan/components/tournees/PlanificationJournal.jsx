/**
 * PlanificationJournal.jsx — derniers passages d'un cron de planification
 * ============================================================================
 * Lit `majordhome_planification_runs` pour un job : `tournees-figer` (figeage
 * des journées pleines), `auto-rdv-ouverture` (invitations + étiquetage du 1er
 * du mois), `auto-rdv-relances` (SMS, liste d'appels, expiration). Répond à
 * « je ne sais pas si le cron l'a fait » (Eric, 2026-09-29) — avant cette table,
 * le rapport d'un cron n'existait que dans net._http_response.
 * ============================================================================
 */

import { Clock } from 'lucide-react';
import { usePlanificationRuns } from '@hooks/useTournees';
import { formatDateTimeFR } from '@/lib/utils';

const REMARQUES = {
  siege_non_configure: 'Siège non configuré (Settings → Organisation → Territoire)',
  figeage_auto_off: 'Figeage automatique désactivé (réglage Tournées)',
  auto_rdv_off: 'Prise de rendez-vous par le client désactivée (réglage Tournées)',
  twilio_not_configured: 'SMS activés mais Twilio non configuré',
  org_majordhome_introuvable: 'Organisation sans module Majord’home',
};

const compterVerdict = (rapport, verdict) => (rapport?.journees || []).filter((j) => j.verdict === verdict).length;

/** Colonnes par job : ce que chaque cron a fait, en chiffres. */
const JOBS = {
  'tournees-figer': {
    titre: 'Figeage automatique des journées pleines',
    description: 'Le cron passe toutes les heures de 7 h à 21 h et fige les journées pleines à partir du lendemain.',
    colonnes: [
      ['Journées vues', (r) => (r?.journees || []).length],
      ['Figées', (r) => compterVerdict(r, 'figee')],
      ['Refusées', (r) => compterVerdict(r, 'refusee') + compterVerdict(r, 'erreur')],
      ['À arbitrer', (r) => compterVerdict(r, 'a_arbitrer')],
    ],
  },
  'auto-rdv-ouverture': {
    titre: 'Invitations du 1ᵉʳ du mois',
    description: 'Le 1ᵉʳ à 6 h : un mail par client dont l’entretien est dû, et les journées vides dédiées à chaque secteur.',
    colonnes: [
      ['À inviter', (r) => r?.invitations?.a_inviter ?? 0],
      ['Mails envoyés', (r) => r?.invitations?.envoyees ?? 0],
      ['Sans e-mail', (r) => r?.invitations?.sans_email ?? 0],
      ['Journées étiquetées', (r) => (r?.etiquetees || []).length],
    ],
    remarque: (r) => (r?.invitations?.template_missing ? 'Gabarit « auto_rdv » absent : aucun mail envoyé (Settings → Communication → Emails)' : ''),
  },
  'auto-rdv-relances': {
    titre: 'Relances quotidiennes',
    description: 'Chaque jour à 6 h 20 : SMS de relance, passage en liste d’appels, expiration en fin de mois.',
    colonnes: [
      ['SMS', (r) => r?.relances?.sms ?? 0],
      ['Liste d’appels', (r) => r?.relances?.appel ?? 0],
      ['Expirées', (r) => r?.relances?.expire ?? 0],
      ['Journées étiquetées', (r) => (r?.etiquetees || []).length],
    ],
  },
};

/**
 * @param {{ coreOrgId: string, job?: 'tournees-figer'|'auto-rdv-ouverture'|'auto-rdv-relances' }} props
 */
export function PlanificationJournal({ coreOrgId, job = 'tournees-figer' }) {
  const cfg = JOBS[job] || JOBS['tournees-figer'];
  const { data: runs, isLoading, error } = usePlanificationRuns(coreOrgId, job);
  const lignes = runs || [];
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-4 h-4 text-secondary-500" />
        <h3 className="text-sm font-medium text-gray-900">{cfg.titre}</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">{cfg.description} Chaque passage laisse une trace ici.</p>
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
              {cfg.colonnes.map(([label]) => <th key={label} className="text-right font-medium">{label}</th>)}
              <th className="text-left pl-3 font-medium">Remarque</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="py-1">{formatDateTimeFR(r.ran_at)}{r.dry_run ? ' (essai)' : ''}</td>
                {cfg.colonnes.map(([label, calcul]) => <td key={label} className="text-right">{calcul(r.rapport)}</td>)}
                <td className="pl-3 text-xs text-gray-500">
                  {r.erreur || (r.rapport?.skipped ? (REMARQUES[r.rapport.skipped] || r.rapport.skipped) : (cfg.remarque?.(r.rapport) || ''))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
