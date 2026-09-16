/**
 * AppointmentHistorySection.jsx — Historique d'un RDV (mouchard) dans la modale planning.
 * ============================================================================
 * Liste les écritures réelles sur le RDV (création, déplacements de date /
 * heure, changement de personne, annulation…) tracées par trigger DB, avec
 * l'auteur et le chemin (planning, fiche lead, figeage de journée…).
 * Lecture seule ; mise en forme par `buildAuditEntry` (src/lib/auditTrail.js).
 * ============================================================================
 */

import { useMemo } from 'react';
import { History, Loader2 } from 'lucide-react';
import { useAppointmentAuditTrail } from '@hooks/useAppointments';
import { useAuditResolvers } from '@hooks/useAuditResolvers';
import { buildAuditEntry } from '@/lib/auditTrail';
import { AuditEntry } from '../shared/AuditEntry';

/**
 * @param {Object} props
 * @param {string} props.appointmentId
 */
export function AppointmentHistorySection({ appointmentId }) {
  const { rows, isLoading } = useAppointmentAuditTrail(appointmentId);
  const resolvers = useAuditResolvers();
  const entries = useMemo(
    () => rows.map((row) => buildAuditEntry(row, { resolvers })),
    [rows, resolvers],
  );

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <History className="h-4 w-4 text-gray-500" />
        Historique
      </h3>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : entries.length === 0 ? (
        <p className="py-2 text-sm italic text-gray-400">
          Aucune modification enregistrée depuis la mise en place du journal.
        </p>
      ) : (
        <div className="relative">
          <div className="absolute bottom-0 left-4 top-0 w-px bg-gray-200" />
          <div className="space-y-4">
            {entries.map((entry) => (
              <div key={entry.id} className="relative flex gap-3 pl-1">
                <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                  <History className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <AuditEntry entry={entry} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default AppointmentHistorySection;
