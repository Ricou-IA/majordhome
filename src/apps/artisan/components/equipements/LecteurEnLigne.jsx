/**
 * LecteurEnLigne.jsx — un document ouvert DANS la page (jamais en plein écran), avec son bouton « Fermer ».
 * Enveloppe de LecteurDocument : 70vh, rattaché visuellement à la liste qui l'a ouvert.
 */

import { X } from 'lucide-react';
import LecteurDocument from './lecteur/LecteurDocument';

/**
 * @param {{ doc: object, onClose: () => void, className?: string }} p
 */
export default function LecteurEnLigne({ doc, onClose, className = '' }) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-gray-200 bg-gray-50">
        <p className="text-sm font-medium text-gray-800 truncate">{doc.label || doc.file_name}</p>
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1 min-h-[36px] px-2 text-sm text-gray-700 hover:text-gray-900">
          <X className="w-4 h-4" />Fermer
        </button>
      </div>
      <div className="h-[70vh]">
        <LecteurDocument source={{ kind: 'doc', doc }} />
      </div>
    </div>
  );
}
