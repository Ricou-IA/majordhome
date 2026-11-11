/**
 * ExplodedViewViewer.jsx — Vue éclatée en grand (plein écran)
 * ============================================================================
 * L'image défile dans les deux sens ; « Zoom » passe de « ajustée à la fenêtre » à la taille réelle puis au double
 * (les repères d'une vue éclatée sont petits). Échap ferme. Plusieurs vues : précédente / suivante.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react';

const NIVEAUX = ['ajustee', 'reelle', 'double'];
const LIBELLE = { ajustee: 'Ajustée', reelle: 'Taille réelle', double: 'Double' };

/**
 * @param {{ vues: Array<{ url: string, width: number|null, height: number|null }>, index: number, titre: string,
 *   onChange: (i: number) => void, onClose: () => void }} p
 */
export default function ExplodedViewViewer({ vues, index, titre, onChange, onClose }) {
  const [niveau, setNiveau] = useState('ajustee');
  const vue = vues[index];

  useEffect(() => {
    const surTouche = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < vues.length - 1) onChange(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onChange(index - 1);
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [index, vues.length, onChange, onClose]);

  if (!vue) return null;
  const rang = NIVEAUX.indexOf(niveau);
  const style = niveau === 'ajustee'
    ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
    : { width: vue.width ? `${vue.width * (niveau === 'double' ? 2 : 1)}px` : (niveau === 'double' ? '200%' : 'auto'), maxWidth: 'none' };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-secondary-900/95" role="dialog" aria-modal="true" aria-label={titre}>
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-secondary-200">
        <p className="flex-1 min-w-0 text-sm font-medium text-secondary-900 truncate">
          {titre}{vues.length > 1 ? ` — vue ${index + 1} sur ${vues.length}` : ''}
        </p>
        {vues.length > 1 && (
          <>
            <button type="button" onClick={() => onChange(index - 1)} disabled={index === 0} className="p-1.5 rounded hover:bg-secondary-100 disabled:opacity-30" aria-label="Vue précédente"><ChevronLeft className="w-5 h-5" /></button>
            <button type="button" onClick={() => onChange(index + 1)} disabled={index === vues.length - 1} className="p-1.5 rounded hover:bg-secondary-100 disabled:opacity-30" aria-label="Vue suivante"><ChevronRight className="w-5 h-5" /></button>
          </>
        )}
        <button type="button" onClick={() => setNiveau(NIVEAUX[rang - 1])} disabled={rang === 0} className="p-1.5 rounded hover:bg-secondary-100 disabled:opacity-30" aria-label="Réduire"><ZoomOut className="w-5 h-5" /></button>
        <span className="text-xs text-secondary-600 w-20 text-center">{LIBELLE[niveau]}</span>
        <button type="button" onClick={() => setNiveau(NIVEAUX[rang + 1])} disabled={rang === NIVEAUX.length - 1} className="p-1.5 rounded hover:bg-secondary-100 disabled:opacity-30" aria-label="Agrandir"><ZoomIn className="w-5 h-5" /></button>
        <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-secondary-100" aria-label="Fermer"><X className="w-5 h-5" /></button>
      </div>
      <div className={`flex-1 overflow-auto bg-white ${niveau === 'ajustee' ? 'flex items-center justify-center p-2' : 'p-2'}`}>
        <img src={vue.url} alt={titre} style={style} className="select-none" draggable={false} />
      </div>
    </div>,
    document.body,
  );
}
