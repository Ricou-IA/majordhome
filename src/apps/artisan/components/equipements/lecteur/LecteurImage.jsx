/**
 * LecteurImage.jsx — Image d'un appareil (vue éclatée, photo) dans le logiciel
 * ============================================================================
 * Remplit le conteneur donné par le parent. Trois niveaux : Ajustée à la zone, Taille réelle, Double (les repères
 * d'une vue éclatée sont petits). L'image défile dans les deux sens et se pince pour zoomer (doigt sur tablette).
 * Une image qui ne se charge pas reste dans la zone, avec « Ouvrir dans un onglet ».
 * ============================================================================
 */

import { useState } from 'react';
import { ZoomIn, ZoomOut, AlertCircle, ExternalLink } from 'lucide-react';

const NIVEAUX = ['ajustee', 'reelle', 'double'];
const LIBELLE = { ajustee: 'Ajustée', reelle: 'Taille réelle', double: 'Double' };

/**
 * @param {{ url: string, width?: number|null, height?: number|null, titre?: string }} p
 */
export default function LecteurImage({ url, width = null, titre = 'Image' }) {
  const [niveau, setNiveau] = useState('ajustee');
  const [urlEnErreur, setUrlEnErreur] = useState(null);
  const rang = NIVEAUX.indexOf(niveau);
  const style = niveau === 'ajustee'
    ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
    : { width: width ? `${width * (niveau === 'double' ? 2 : 1)}px` : (niveau === 'double' ? '200%' : 'auto'), maxWidth: 'none' };

  if (urlEnErreur && urlEnErreur === url) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-red-700">Cette image n&apos;a pas pu être affichée dans le logiciel.</p>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800">
          <ExternalLink className="w-4 h-4" />Ouvrir dans un onglet
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-end gap-1 px-2 py-1 border-b border-secondary-200 bg-white">
        <button type="button" onClick={() => setNiveau(NIVEAUX[rang - 1])} disabled={rang === 0} className="p-1.5 rounded hover:bg-secondary-100 disabled:opacity-30" aria-label="Réduire"><ZoomOut className="w-5 h-5" /></button>
        <span className="text-xs text-secondary-600 w-24 text-center">{LIBELLE[niveau]}</span>
        <button type="button" onClick={() => setNiveau(NIVEAUX[rang + 1])} disabled={rang === NIVEAUX.length - 1} className="p-1.5 rounded hover:bg-secondary-100 disabled:opacity-30" aria-label="Agrandir"><ZoomIn className="w-5 h-5" /></button>
      </div>
      <div className={`flex-1 min-h-0 overflow-auto bg-white ${niveau === 'ajustee' ? 'flex items-center justify-center p-2' : 'p-2'}`} style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
        <img src={url} alt={titre} style={style} className="select-none" draggable={false} onError={() => setUrlEnErreur(url)} />
      </div>
    </div>
  );
}
