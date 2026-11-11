/**
 * DemandeSavSection.jsx — la demande SAV dans la fenêtre « Nouveau RDV » (type SAV).
 * Saisie : description du problème + degré d'urgence, qui ouvrent la demande à la création
 * du RDV (ou complètent celle déjà ouverte du client). Lecture : la demande de la carte d'où
 * la fenêtre est ouverte (fiche SAV), pour ne pas perdre ce qui a été décrit.
 */

import { LifeBuoy } from 'lucide-react';
import { TextArea } from '../FormFields';
import { SAVUrgencySelect, SAVUrgencyBadge } from '../entretiens/SAVUrgency';

/**
 * @param {object} p
 * @param {'saisie'|'lecture'} p.mode
 * @param {string} [p.description]
 * @param {string|null} [p.urgence]  'urgent' | 'normal' | 'peut_attendre'
 * @param {(v: string) => void} [p.onDescription]
 * @param {(v: string) => void} [p.onUrgence]
 * @param {string|null} [p.error]
 * @param {boolean} [p.sansFiche]  client saisi à la main : la demande ne peut pas être ouverte
 */
export function DemandeSavSection({ mode, description = '', urgence = null, onDescription, onUrgence, error = null, sansFiche = false }) {
  return (
    <div className="rounded-lg border border-secondary-200 p-3 space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <LifeBuoy className="h-4 w-4 text-gray-500" /> Demande SAV
      </p>
      {mode === 'lecture' ? (
        <>
          {urgence && <SAVUrgencyBadge item={{ intervention_type: 'sav', sav_urgency: urgence, workflow_status: 'demande' }} taille="fiche" />}
          <p className="text-xs text-secondary-700 whitespace-pre-line">
            {description?.trim() || <span className="italic text-secondary-400">Aucune description</span>}
          </p>
        </>
      ) : (
        <>
          <TextArea
            value={description}
            onChange={onDescription}
            placeholder="Problème signalé par le client…"
            rows={3}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <SAVUrgencySelect value={urgence || 'normal'} onChange={onUrgence} />
          {sansFiche && <p className="text-[11px] text-amber-700">Choisissez la fiche du client pour ouvrir la demande SAV.</p>}
        </>
      )}
    </div>
  );
}

export default DemandeSavSection;
