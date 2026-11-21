/**
 * MenuCreer.jsx — bouton « Créer » du menu latéral : nouveau RDV, nouveau lead, nouveau
 * client, d'où que l'on soit. Les créations proposées viennent d'actionsCreer
 * (src/lib/rechercheGlobale.js), selon les droits : chacune mène à la page qui ouvre sa
 * fenêtre de création. Une seule création possible = un lien direct, sans menu.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';

const BOUTON = 'inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-700 px-3 py-2.5 lg:py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-white';

/**
 * @param {Object} props
 * @param {Array<{ cle: string, libelle: string, href: string }>} props.actions
 * @param {() => void} [props.onNaviguer]  appelé quand une création est choisie (ferme le tiroir mobile)
 */
export function MenuCreer({ actions, onNaviguer }) {
  const [ouvert, setOuvert] = useState(false);
  if (actions.length === 0) return null;

  if (actions.length === 1) {
    return (
      <Link to={actions[0].href} onClick={onNaviguer} className={BOUTON} title={actions[0].libelle}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Créer
      </Link>
    );
  }

  const fermer = () => setOuvert(false);
  return (
    <div className="relative shrink-0" onKeyDown={(e) => { if (e.key === 'Escape') fermer(); }}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        className={BOUTON}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Créer
      </button>
      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={fermer} />
          <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-48 rounded-lg border border-secondary-200 bg-white py-1 shadow-lg">
            {actions.map((action) => (
              <Link
                key={action.cle}
                to={action.href}
                role="menuitem"
                onClick={() => { fermer(); onNaviguer?.(); }}
                className="block px-4 py-2.5 lg:py-2 text-sm text-secondary-700 hover:bg-secondary-50 focus:bg-secondary-50 focus:outline-none"
              >
                {action.libelle}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default MenuCreer;
