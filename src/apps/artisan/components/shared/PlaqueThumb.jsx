/**
 * PlaqueThumb.jsx — vignette de la plaque signalétique d'un équipement.
 * ============================================================================
 * Chemin Storage (bucket `certificats`) → URL signée → vignette carrée, clic
 * pour voir la photo en plein écran. Rien tant qu'il n'y a pas de chemin.
 * Utilisée par la carte équipement de la fiche client.
 * ============================================================================
 */

import { useState } from 'react';
import { Camera, X } from 'lucide-react';
import { useCertificatsSignedUrl } from '@hooks/useCertificatsSignedUrl';

/**
 * @param {{ path: string|null|undefined, label?: string, className?: string }} props
 */
export function PlaqueThumb({ path, label = 'Plaque signalétique', className = 'w-12 h-12' }) {
  const { url, state } = useCertificatsSignedUrl(path);
  const [pleinEcran, setPleinEcran] = useState(false);

  if (!path) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => url && setPleinEcran(true)}
        title={label}
        className={`${className} shrink-0 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500`}
      >
        {state === 'ok' && url
          ? <img src={url} alt={label} className="w-full h-full object-cover" />
          : <Camera className="w-4 h-4" />}
      </button>
      {pleinEcran && url && (
        <div
          className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-4"
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
          <img src={url} alt={label} className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

export default PlaqueThumb;
