/**
 * MenuCreer.jsx — bouton « Créer » : nouveau RDV, nouveau lead, nouveau client, d'où que
 * l'on soit. Les créations proposées viennent d'actionsCreer (src/lib/rechercheGlobale.js),
 * selon les droits : chacune mène à la page qui ouvre sa fenêtre de création. Une seule
 * création possible = un lien direct, sans menu.
 *
 * Deux habillages, une seule logique : `menu` (menu latéral, la liste s'ouvre dessous) et
 * `barre` (barre du bas du téléphone, la liste s'ouvre au-dessus).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';

const LISTE = 'absolute z-50 w-48 rounded-lg border border-secondary-200 bg-white py-1 shadow-lg';

const HABILLAGES = {
  menu: {
    cadre: 'relative shrink-0',
    bouton: 'inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-700 px-3 py-2.5 lg:py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
    liste: `${LISTE} right-0 top-full mt-2`,
    ligne: 'block px-4 py-2.5 lg:py-2 text-sm text-secondary-700 hover:bg-secondary-50 focus:bg-secondary-50 focus:outline-none',
  },
  barre: {
    cadre: 'relative flex min-w-0 flex-1',
    bouton: 'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-secondary-700 focus:outline-none focus-visible:bg-secondary-100',
    liste: `${LISTE} bottom-full left-1/2 mb-2 -translate-x-1/2`,
    ligne: 'block px-4 py-3 text-sm text-secondary-700 hover:bg-secondary-50 focus:bg-secondary-50 focus:outline-none',
  },
};

/** Contenu du bouton : « + Créer » dans le menu, pastille ronde et libellé dessous dans la barre. */
function Contenu({ variante }) {
  if (variante === 'barre') {
    return (
      <>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-700 text-white">
          <Plus className="h-5 w-5" aria-hidden="true" />
        </span>
        Créer
      </>
    );
  }
  return (
    <>
      <Plus className="h-4 w-4" aria-hidden="true" />
      Créer
    </>
  );
}

/**
 * @param {Object} props
 * @param {Array<{ cle: string, libelle: string, href: string }>} props.actions
 * @param {() => void} [props.onNaviguer]  appelé quand une création est choisie (ferme le tiroir mobile)
 * @param {'menu'|'barre'} [props.variante]  habillage : menu latéral (défaut) ou barre du bas
 */
export function MenuCreer({ actions, onNaviguer, variante = 'menu' }) {
  const [ouvert, setOuvert] = useState(false);
  if (actions.length === 0) return null;
  const habillage = HABILLAGES[variante] || HABILLAGES.menu;

  if (actions.length === 1) {
    const lien = (
      <Link to={actions[0].href} onClick={onNaviguer} className={habillage.bouton} title={actions[0].libelle}>
        <Contenu variante={variante} />
      </Link>
    );
    return variante === 'barre' ? <div className={habillage.cadre}>{lien}</div> : lien;
  }

  const fermer = () => setOuvert(false);
  return (
    <div className={habillage.cadre} onKeyDown={(e) => { if (e.key === 'Escape') fermer(); }}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        className={habillage.bouton}
      >
        <Contenu variante={variante} />
      </button>
      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={fermer} />
          <div role="menu" className={habillage.liste}>
            {actions.map((action) => (
              <Link
                key={action.cle}
                to={action.href}
                role="menuitem"
                onClick={() => { fermer(); onNaviguer?.(); }}
                className={habillage.ligne}
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
