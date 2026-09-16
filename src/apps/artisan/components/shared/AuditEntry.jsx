/**
 * AuditEntry.jsx — une entrée du mouchard (journal d'audit), présentationnelle.
 * ============================================================================
 * Rend une sortie de `buildAuditEntry` (src/lib/auditTrail.js) : qui a modifié
 * quoi, par où, quand. Partagé entre l'Historique de la fiche lead
 * (LeadActivityTimeline) et la section Historique de la modale RDV
 * (AppointmentHistorySection). Aucune logique métier ici.
 * ============================================================================
 */

import { ArrowRight } from 'lucide-react';

const DATE_OPTIONS = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };

/**
 * @param {Object} props
 * @param {Object} props.entry - sortie de buildAuditEntry
 * @param {boolean} [props.showSubject] - afficher le badge Lead / RDV (timeline mixte)
 */
export function AuditEntry({ entry, showSubject = false }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-gray-800">
        {showSubject && (
          <span className="mr-1.5 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-600">
            {entry.subject}
          </span>
        )}
        {entry.title}
      </p>

      {entry.changes.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {entry.changes.map((c) => (
            <li key={c.field} className="flex flex-wrap items-baseline gap-x-1 text-xs text-gray-600">
              <span className="text-gray-500">{c.label} :</span>
              {c.from !== null && (
                <>
                  <span className="text-gray-400 line-through decoration-gray-300">{c.from}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 self-center text-gray-400" aria-hidden />
                </>
              )}
              <span className="font-medium text-gray-800">{c.to}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1 text-xs text-gray-400">
        {new Date(entry.at).toLocaleDateString('fr-FR', DATE_OPTIONS)}
      </p>
    </div>
  );
}

export default AuditEntry;
