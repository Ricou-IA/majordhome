/**
 * PhotoPlaqueAnomalie.jsx — photo de la plaque signalétique jointe à une anomalie.
 * ============================================================================
 * Lue depuis le certificat (chemin dans `anomalies` de la vue Kanban) : la carte
 * SAV la voit où qu'elle soit, et une photo reprise dans le certificat remplace
 * l'ancienne sans resynchronisation. Affichée en grand (c'est elle que le chiffreur
 * ouvre pour marque / modèle / n° de série), plein écran au clic, ouverture dans
 * un onglet pour l'enregistrer. Sans photo : le motif d'absence saisi par le
 * technicien, ou « aucune photo ».
 * ============================================================================
 */

import { useState } from 'react';
import { Camera, ExternalLink, Loader2, X } from 'lucide-react';
import { useCertificatsSignedUrl } from '@hooks/useCertificatsSignedUrl';

/**
 * @param {{ anomalie: { photoPlaquePath: string|null, photoPlaqueAbsence: string, equipement?: string } }} props
 */
export function PhotoPlaqueAnomalie({ anomalie }) {
  const path = anomalie?.photoPlaquePath || null;
  const { url, state } = useCertificatsSignedUrl(path);
  const [pleinEcran, setPleinEcran] = useState(false);

  if (!path) {
    return (
      <p className="text-xs text-amber-700 flex items-center gap-1.5">
        <Camera className="w-3.5 h-3.5" />
        {anomalie?.photoPlaqueAbsence
          ? <>Pas de photo de plaque : {anomalie.photoPlaqueAbsence}</>
          : <>Aucune photo de plaque signalétique</>}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-amber-800 flex items-center gap-1.5">
        <Camera className="w-3.5 h-3.5" />
        Plaque signalétique
      </div>
      {state === 'loading' && (
        <div className="h-24 rounded-md bg-amber-100/60 flex items-center justify-center text-amber-600">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}
      {state === 'error' && (
        <p className="text-xs text-red-600">Photo introuvable dans le stockage ({path}).</p>
      )}
      {state === 'ok' && url && (
        <>
          <button
            type="button"
            onClick={() => setPleinEcran(true)}
            className="block w-full rounded-md overflow-hidden border border-amber-200 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            title="Agrandir"
          >
            <img src={url} alt={`Plaque signalétique${anomalie?.equipement ? ` — ${anomalie.equipement}` : ''}`} className="w-full max-h-72 object-contain bg-gray-50" />
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-amber-800 hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Ouvrir / enregistrer la photo
          </a>
          {pleinEcran && (
            <div
              className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
              onClick={() => setPleinEcran(false)}
            >
              <button
                type="button"
                onClick={() => setPleinEcran(false)}
                className="absolute top-4 right-4 h-12 w-12 flex items-center justify-center text-white hover:bg-white/20 rounded-full"
                aria-label="Fermer"
              >
                <X className="h-8 w-8" />
              </button>
              <img
                src={url}
                alt="Plaque signalétique"
                className="max-w-full max-h-full object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PhotoPlaqueAnomalie;
