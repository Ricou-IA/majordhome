/**
 * calque-modal.jsx — calque de fenêtre « maison » (fond + panneau), sans bibliothèque.
 * ============================================================================
 * Remplace le `div.fixed inset-0 … bg-black/40` recopié dans les fenêtres de devis :
 * - Échap et clic sur le fond appellent `onClose` (c'est l'appelant qui décide : il peut
 *   d'abord demander « Abandonner le devis ? ») ;
 * - un seul calque à la fois : les calques ouverts forment une pile, seul celui du dessus
 *   réagit à Échap et au fond, et ceux d'en dessous sont masqués (le catalogue ouvert sur un
 *   devis cache le devis : plus deux « Annuler » l'un sur l'autre) ;
 * - Échap déjà traité par une couche Radix (liste, calendrier, confirmation) est ignoré
 *   (`e.defaultPrevented`), comme l'exige toute fenêtre maison (CLAUDE.md).
 *
 * Le calque ne dessine que le fond : le panneau (titre, corps, pied) reste celui de
 * l'appelant, passé en enfant. `className` remplace la mise en page du fond (ex. tiroir
 * à droite, plein écran) ; `fermerAuFond={false}` pour un calque plein écran sans fond.
 *
 * @example
 * <CalqueModal onClose={demanderFermeture} titreId="devis-titre">
 *   <div className="bg-white rounded-xl …"><h2 id="devis-titre">Nouveau devis</h2>…</div>
 * </CalqueModal>
 * ============================================================================
 */
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { cn } from '@lib/utils';

// Pile des calques ouverts (le dernier est au-dessus), partagée par toute l'application.
let pile = [];
const abonnes = new Set();
const prevenir = () => abonnes.forEach((f) => f());
const pileStore = {
  abonner: (f) => { abonnes.add(f); return () => abonnes.delete(f); },
  lire: () => pile,
};

const FOND_PAR_DEFAUT = 'flex items-center justify-center bg-black/40 p-4';

/**
 * @param {Object} props
 * @param {() => void} props.onClose        demande de fermeture (Échap, clic sur le fond)
 * @param {string} [props.titreId]          id du titre du panneau (aria-labelledby)
 * @param {string} [props.z]                classe de profondeur (`z-50`, `z-[60]`…)
 * @param {string} [props.className]        mise en page du fond (remplace le défaut centré)
 * @param {boolean} [props.fermerAuFond]    clic sur le fond = fermer (vrai par défaut)
 */
export function CalqueModal({ onClose, titreId, z = 'z-50', className, fermerAuFond = true, children }) {
  const id = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const appuiSurFond = useRef(false);

  useEffect(() => {
    pile = [...pile, id];
    prevenir();
    return () => { pile = pile.filter((x) => x !== id); prevenir(); };
  }, [id]);

  const pileCourante = useSyncExternalStore(pileStore.abonner, pileStore.lire);
  // Avant l'enregistrement (premier rendu), le calque est considéré au-dessus : pas de clignotement.
  const auDessus = !pileCourante.includes(id) || pileCourante[pileCourante.length - 1] === id;

  useEffect(() => {
    const surTouche = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (pile[pile.length - 1] !== id) return;
      e.preventDefault();
      onCloseRef.current?.();
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [id]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titreId}
      aria-hidden={auDessus ? undefined : true}
      className={cn('fixed inset-0', z, className ?? FOND_PAR_DEFAUT, auDessus ? 'visible' : 'invisible')}
      onMouseDown={(e) => { appuiSurFond.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const surFond = appuiSurFond.current && e.target === e.currentTarget;
        appuiSurFond.current = false;
        if (surFond && fermerAuFond && auDessus) onCloseRef.current?.();
      }}
    >
      {children}
    </div>
  );
}

export default CalqueModal;
