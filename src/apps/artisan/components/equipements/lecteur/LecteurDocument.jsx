/**
 * LecteurDocument.jsx — Lecteur de document d'appareil, dans le logiciel (aiguillage)
 * ============================================================================
 * Remplace le lecteur PDF du navigateur (qui n'affiche rien sur une tablette Android). Source :
 *  - { kind: 'vue', url, width, height } : image déjà publique, affichée telle quelle ;
 *  - { kind: 'doc', doc } : document du modèle ; URL signée pour une heure à l'ouverture.
 * Le lecteur remplit le conteneur que le parent dimensionne (aucun voile). Toute erreur reste dans la zone, avec
 * « Ouvrir dans un onglet » quand une adresse est connue.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { equipmentDocumentsService } from '@services/equipmentDocuments.service';
import { natureDocument } from '@/lib/catalogue/documentsAppareil';
import LecteurPdf from './LecteurPdf';
import LecteurImage from './LecteurImage';

/**
 * @param {{ source: { kind: 'vue', url: string, width?: number|null, height?: number|null }
 *   | { kind: 'doc', doc: { storage_path: string, file_name?: string, mime_type?: string, label?: string } },
 *   pageInitiale?: number }} p
 */
export default function LecteurDocument({ source, pageInitiale = 1 }) {
  const doc = source?.kind === 'doc' ? source.doc : null;
  const chemin = doc?.storage_path || null;
  const urlVue = source?.kind === 'vue' ? source.url : null;
  const [etat, setEtat] = useState({ url: null, erreur: false });

  useEffect(() => {
    if (!chemin) return undefined;
    let actif = true;
    setEtat({ url: null, erreur: false });
    equipmentDocumentsService.getSignedUrl({ storage_path: chemin })
      .then(({ data, error }) => { if (actif) setEtat(error || !data ? { url: null, erreur: true } : { url: data, erreur: false }); })
      .catch(() => { if (actif) setEtat({ url: null, erreur: true }); });
    return () => { actif = false; };
  }, [chemin]);

  const url = urlVue || etat.url;
  const nature = urlVue ? 'image' : natureDocument(doc);
  const titre = doc?.label || doc?.file_name || 'Document';

  const sansAdresse = (source?.kind === 'vue' && !urlVue) || (source?.kind === 'doc' && !chemin) || !source;
  if (sansAdresse || (!urlVue && etat.erreur)) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-red-700">Le document n&apos;a pas pu être ouvert. Réessayez ; si cela persiste, prévenez l&apos;administrateur.</p>
      </div>
    );
  }
  if (!url) {
    return <div className="h-full flex items-center justify-center text-secondary-400"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div className="flex items-center justify-end px-3 py-1 border-b border-secondary-100">
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800">
          <ExternalLink className="w-3.5 h-3.5" />Ouvrir dans un onglet
        </a>
      </div>
      <div className="flex-1 min-h-0">
        {nature === 'pdf' && <LecteurPdf url={url} pageInitiale={pageInitiale} />}
        {nature === 'image' && <LecteurImage url={url} width={source.width ?? null} height={source.height ?? null} titre={titre} />}
        {nature === 'autre' && (
          <div className="h-full flex items-center justify-center p-6 text-center">
            <p className="text-sm text-secondary-600">Ce type de fichier ne s&apos;affiche pas dans le logiciel.</p>
          </div>
        )}
      </div>
    </div>
  );
}
