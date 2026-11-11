/**
 * EquipmentDocumentViewer.jsx — Visionneuse d'un document d'appareil, dans le logiciel
 * ============================================================================
 * Notice, fiche technique, procédure, documentation fournisseur : le document s'ouvre par-dessus la fiche (PDF
 * dans le lecteur du navigateur, image affichée telle quelle) au lieu de partir dans une autre fenêtre. L'URL est
 * signée pour une heure à l'ouverture. « Ouvrir dans un onglet » reste proposé : certains navigateurs de tablette
 * n'affichent pas un PDF à l'intérieur d'une page. Échap ferme.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { equipmentDocumentsService, equipmentDocumentTypeLabel } from '@services/equipmentDocuments.service';
import { titreDocumentModele } from '@/lib/catalogue/nomenclature';

const natureDe = (doc) => {
  const mime = String(doc?.mime_type || '').toLowerCase();
  const nom = String(doc?.file_name || doc?.storage_path || '').toLowerCase();
  if (mime === 'application/pdf' || nom.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(nom)) return 'image';
  return 'autre';
};

/**
 * @param {{ doc: { storage_path: string, file_name?: string, mime_type?: string, label?: string, document_type?: string },
 *   titre?: string|null, onClose: () => void }} p
 */
export default function EquipmentDocumentViewer({ doc, titre = null, onClose }) {
  const [etat, setEtat] = useState({ url: null, erreur: false });
  const chemin = doc?.storage_path || null;
  const nature = natureDe(doc);
  const titreAffiche = titre || titreDocumentModele(doc, equipmentDocumentTypeLabel);

  useEffect(() => {
    let actif = true;
    setEtat({ url: null, erreur: false });
    equipmentDocumentsService.getSignedUrl({ storage_path: chemin })
      .then(({ data, error }) => { if (actif) setEtat(error || !data ? { url: null, erreur: true } : { url: data, erreur: false }); })
      .catch(() => { if (actif) setEtat({ url: null, erreur: true }); });
    return () => { actif = false; };
  }, [chemin]);

  useEffect(() => {
    const surTouche = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-secondary-900/95" role="dialog" aria-modal="true" aria-label={titreAffiche}>
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-secondary-200">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-secondary-900 truncate">{titreAffiche}</p>
          {doc?.file_name && doc.file_name !== titreAffiche && <p className="text-xs text-secondary-500 truncate">{doc.file_name}</p>}
        </div>
        {etat.url && (
          <a href={etat.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 flex-shrink-0">
            <ExternalLink className="w-3.5 h-3.5" />Ouvrir dans un onglet
          </a>
        )}
        <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-secondary-100 flex-shrink-0" aria-label="Fermer"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 min-h-0 bg-white">
        {!etat.url && !etat.erreur && (
          <div className="h-full flex items-center justify-center text-secondary-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
        )}
        {etat.erreur && (
          <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
            <AlertCircle className="w-8 h-8 text-red-500" />
            <p className="text-sm text-red-700">Le document n&apos;a pas pu être ouvert. Fermez et réessayez ; si cela persiste, prévenez l&apos;administrateur.</p>
          </div>
        )}
        {etat.url && nature === 'pdf' && (
          <iframe src={`${etat.url}#view=FitH`} title={titreAffiche} className="w-full h-full border-0" />
        )}
        {etat.url && nature === 'image' && (
          <div className="h-full overflow-auto flex items-start justify-center p-2">
            <img src={etat.url} alt={titreAffiche} className="max-w-full" />
          </div>
        )}
        {etat.url && nature === 'autre' && (
          <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-secondary-600">Ce type de fichier ne s&apos;affiche pas dans le logiciel.</p>
            <a href={etat.url} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
              <ExternalLink className="w-4 h-4" />Ouvrir dans un onglet
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
