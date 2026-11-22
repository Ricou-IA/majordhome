/**
 * BarreDuBas.jsx — navigation du téléphone : une barre fixe en bas de l'écran, sous le
 * pouce, à la place du seul bouton de menu en haut à gauche (Eric, recette du 2026-11-22 :
 * « des menus de manière plus mobile plutôt que d'adapter le site desktop »).
 *
 * Les pages du quotidien en un toucher, « Créer » au centre, « Plus » pour le menu complet.
 * Quelles pages : raccourcisBarre (src/lib/menuGroupes.js), selon les droits de la personne.
 * Affichée tant que le menu latéral ne l'est pas (sous `lg`) : téléphone, jamais la tablette.
 */

import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { pageDansEntree, libelleDeBarre } from '@/lib/menuGroupes';
import { MenuCreer } from './MenuCreer';

const CASE = 'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium focus:outline-none focus-visible:bg-secondary-100';
const ACTIVE = 'text-primary-700';
const INACTIVE = 'text-secondary-500';

/**
 * @param {Object} props
 * @param {Array<{ href: string, name: string, icon: Function }>} props.raccourcis  pages en accès direct
 * @param {Array<{ cle: string, libelle: string, href: string }>} props.creations   créations permises
 * @param {string} props.pathname       adresse de la page affichée
 * @param {boolean} props.menuOuvert    le menu complet est-il ouvert
 * @param {() => void} props.onOuvrirMenu
 */
export function BarreDuBas({ raccourcis, creations, pathname, menuOuvert, onOuvrirMenu }) {
  // Les messages (« Nouvelle version disponible »…) s'affichent en bas de l'écran sur
  // téléphone : ce repère les remonte au-dessus de la barre (règle dans index.css).
  useEffect(() => {
    document.documentElement.dataset.barreBas = '1';
    return () => { delete document.documentElement.dataset.barreBas; };
  }, []);

  // « Créer » se place au centre : deux pages avant, le reste après.
  const avant = creations.length ? raccourcis.slice(0, 2) : raccourcis;
  const apres = creations.length ? raccourcis.slice(2) : [];
  // La page affichée n'est aucun des raccourcis : elle est dans le menu complet.
  const ailleurs = !raccourcis.some((item) => pageDansEntree(item, pathname));

  const lien = (item) => (
    <NavLink
      key={item.href}
      to={item.href}
      end={item.href === '/'}
      className={({ isActive }) => `${CASE} ${isActive ? ACTIVE : INACTIVE}`}
    >
      <item.icon className="h-6 w-6 shrink-0" aria-hidden="true" />
      <span className="max-w-full truncate">{libelleDeBarre(item)}</span>
    </NavLink>
  );

  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-secondary-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="flex h-16 items-stretch">
        {avant.map(lien)}
        <MenuCreer actions={creations} variante="barre" />
        {apres.map(lien)}
        <button
          type="button"
          onClick={onOuvrirMenu}
          aria-label="Ouvrir le menu complet"
          aria-expanded={menuOuvert}
          className={`${CASE} ${ailleurs ? ACTIVE : INACTIVE}`}
        >
          <Menu className="h-6 w-6 shrink-0" aria-hidden="true" />
          Plus
        </button>
      </div>
    </nav>
  );
}

export default BarreDuBas;
