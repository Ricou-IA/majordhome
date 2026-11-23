/**
 * BarreLaterale.jsx — menu latéral de l'application (ordinateur, tablette, tiroir du téléphone).
 *
 * Fond papier, entrée active en carte blanche avec son icône cuivre : aucun aplat cuivre
 * dans le menu, sauf le carré de l'entreprise (direction artistique § 4 à § 6, § 9).
 * Rangement en groupes : src/lib/menuGroupes.js ; AppLayout calcule, ce composant affiche.
 *
 * Replié (64 px, icônes seules avec infobulle) : seulement sur la barre fixe de l'ordinateur,
 * quand `onBasculerReplie` est fourni. Replié, tous les groupes sont affichés, séparés d'un
 * trait : un titre de groupe n'y a pas de place, une entrée ne doit jamais devenir introuvable.
 */

import { NavLink } from 'react-router-dom';
import {
  Building2, ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen, Search, Settings, User,
} from 'lucide-react';
import { etatDuGroupe } from '@/lib/menuGroupes';
import { Avatar } from '@components/ui/avatar';
import { Tag } from '@components/ui/tag';
import { MenuCreer } from '@components/navigation/MenuCreer';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/30';
const ICONE = 'h-[18px] w-[18px] shrink-0';

/** Classes d'une entrée du menu (lien de page ou Paramètres). */
function classesEntree(isActive, replie) {
  const forme = replie ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-3 lg:py-2';
  const etat = isActive
    ? 'bg-white shadow-sm text-secondary-900 font-semibold'
    : 'font-medium text-secondary-600 hover:bg-secondary-100 hover:text-secondary-900';
  return `flex items-center rounded-lg text-cell transition-colors ${forme} ${etat} ${FOCUS}`;
}

/** Entrée du menu : icône cuivre quand on est sur la page, libellé caché (lu) quand replié. */
function Entree({ to, icon: Icone, libelle, replie, onClick, className = '' }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      title={replie ? libelle : undefined}
      className={({ isActive }) => `${classesEntree(isActive, replie)} ${className}`}
    >
      {({ isActive }) => (
        <>
          <Icone
            className={`${ICONE} ${isActive ? 'text-primary-600' : 'text-secondary-400'}`}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className={replie ? 'sr-only' : 'truncate'}>{libelle}</span>
        </>
      )}
    </NavLink>
  );
}

/**
 * @param {Object} props
 * @param {Array<object>} props.groupes            groupes du menu (grouperMenu)
 * @param {Record<string, boolean>} props.replisMenu  groupes repliés ou dépliés par la personne
 * @param {(cle: string, ouvert: boolean) => void} props.onBasculerGroupe
 * @param {string} props.pathname
 * @param {(item: object) => string} props.libelleEntree  libellé affiché d'une entrée
 * @param {{ name?: string }|null} props.organization
 * @param {string|null} props.libelleRole       badge du rôle sous le nom de l'entreprise
 * @param {Array<object>} props.creations           créations permises (actionsCreer)
 * @param {() => void} props.onOuvrirRecherche
 * @param {() => void} props.onNaviguer             lien suivi (ferme le tiroir et le menu du profil)
 * @param {boolean} props.peutOuvrirReglages
 * @param {{ nom: string, email?: string }} props.profil
 * @param {boolean} props.menuProfilOuvert
 * @param {(ouvert: boolean) => void} props.onMenuProfil
 * @param {() => void} props.onSeDeconnecter
 * @param {boolean} [props.replie]                  icônes seules (ordinateur)
 * @param {() => void} [props.onBasculerReplie]     absent = pas de bouton de repli (tiroir du téléphone)
 */
export function BarreLaterale({
  groupes, replisMenu, onBasculerGroupe, pathname, libelleEntree,
  organization, libelleRole, creations, onOuvrirRecherche, onNaviguer,
  peutOuvrirReglages, profil, menuProfilOuvert, onMenuProfil, onSeDeconnecter,
  replie = false, onBasculerReplie,
}) {
  return (
    <div className="flex h-full flex-col border-r border-secondary-200 bg-secondary-25">
      {/* Nom de l'application ; replié, le carré de l'entreprise en tient lieu */}
      <div className={`flex h-16 shrink-0 items-center border-b border-secondary-200 ${replie ? 'justify-center' : 'px-6'}`}>
        {replie ? (
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600"
            title={organization?.name || 'Majord’home'}
          >
            <Building2 className="h-[18px] w-[18px] text-white" strokeWidth={1.75} aria-hidden="true" />
          </div>
        ) : (
          <p className="font-display text-section text-secondary-900">Majord&apos;home</p>
        )}
      </div>

      {/* Organisation */}
      {organization && !replie && (
        <div className="border-b border-secondary-200 px-4 py-4">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-600">
              <Building2 className="h-5 w-5 text-white" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-cell font-semibold text-secondary-900">{organization.name}</p>
              {libelleRole && (
                <Tag className="mt-1">{libelleRole}</Tag>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recherche (Ctrl K) et création rapide, d'où que l'on soit */}
      <div className={`flex gap-2 pt-4 ${replie ? 'flex-col items-center px-3' : 'items-center px-4'}`}>
        <button
          type="button"
          onClick={onOuvrirRecherche}
          title="Rechercher un client, un lead, une page (Ctrl K)"
          className={`flex items-center rounded-lg border border-secondary-200 bg-white text-cell text-secondary-500 shadow-xs hover:border-secondary-300 hover:text-secondary-800 ${FOCUS} ${
            replie ? 'h-10 w-10 justify-center' : 'min-w-0 flex-1 gap-2 px-3 py-2.5 lg:py-2'
          }`}
        >
          <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className={replie ? 'sr-only' : 'truncate'}>Rechercher</span>
        </button>
        <MenuCreer actions={creations} onNaviguer={onNaviguer} variante={replie ? 'replie' : 'menu'} />
      </div>

      {/* Navigation */}
      <nav className={`flex-1 overflow-y-auto py-4 ${replie ? 'px-3' : 'px-4'}`}>
        {groupes.map((groupe, rang) => {
          const { ouvert, force } = replie
            ? { ouvert: true, force: true }
            : etatDuGroupe(groupe, { preferences: replisMenu, pathname });
          const espace = rang === 0 ? '' : replie ? 'mt-2 border-t border-secondary-200 pt-2' : 'mt-3';
          return (
            <div key={groupe.cle} className={espace}>
              {groupe.titre && !replie && (
                <button
                  type="button"
                  onClick={() => onBasculerGroupe(groupe.cle, ouvert)}
                  disabled={force}
                  aria-expanded={ouvert}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-caption text-secondary-500 enabled:hover:text-secondary-800 ${FOCUS}`}
                >
                  {groupe.titre}
                  {!force && (
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${ouvert ? '' : '-rotate-90'}`}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  )}
                </button>
              )}
              {ouvert && (
                <div className="space-y-1">
                  {groupe.items.map((item) => (
                    <Entree
                      key={item.href}
                      to={item.href}
                      icon={item.icon}
                      libelle={libelleEntree(item)}
                      replie={replie}
                      onClick={onNaviguer}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Pied du menu : Paramètres à gauche — admins (settings.view) ou tout rôle qui a au moins
          une tuile de Paramètres (Fournisseurs & catalogue → articles.edit) — et profil à
          droite. Sans accès aux Paramètres, le nom de la personne prend la place du lien. */}
      <div
        className={`flex gap-2 border-t border-secondary-200 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${
          replie ? 'flex-col items-center px-3' : 'items-center px-4'
        }`}
      >
        {peutOuvrirReglages ? (
          <Entree
            to="/settings"
            icon={Settings}
            libelle="Paramètres"
            replie={replie}
            onClick={onNaviguer}
            className={replie ? 'w-10' : 'min-w-0 flex-1'}
          />
        ) : (
          !replie && (
            <p className="min-w-0 flex-1 truncate px-3 text-cell font-medium text-secondary-600">{profil.nom}</p>
          )
        )}

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => onMenuProfil(!menuProfilOuvert)}
            aria-label={`Menu du profil — ${profil.nom}`}
            aria-expanded={menuProfilOuvert}
            aria-haspopup="menu"
            title={profil.nom}
            className="flex h-11 w-11 items-center justify-center rounded-full ring-2 ring-transparent transition-shadow hover:ring-secondary-300 focus:outline-none focus-visible:ring-primary-600/40 lg:h-10 lg:w-10"
          >
            <Avatar nom={profil.nom} couleur="#2C2823" className="h-full w-full" />
          </button>

          {menuProfilOuvert && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => onMenuProfil(false)} />
              <div
                role="menu"
                className={`absolute z-50 w-56 animate-fade-in rounded-lg border border-secondary-200 bg-white py-1 shadow-lg ${
                  replie ? 'bottom-0 left-full ml-2' : 'bottom-full right-0 mb-2'
                }`}
              >
                <div className="border-b border-secondary-100 px-4 py-3">
                  <p className="truncate text-cell font-semibold text-secondary-900">{profil.nom}</p>
                  <p className="truncate text-caption text-secondary-500">{profil.email}</p>
                </div>

                <NavLink
                  to="/profile"
                  role="menuitem"
                  onClick={onNaviguer}
                  className="flex items-center gap-3 px-4 py-2.5 text-cell text-secondary-700 hover:bg-secondary-50 lg:py-2"
                >
                  <User className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  Mon profil
                </NavLink>

                <div className="mt-1 border-t border-secondary-100 pt-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={onSeDeconnecter}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-cell text-red-600 hover:bg-red-50 lg:py-2"
                  >
                    <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    Se déconnecter
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Repli du menu : barre fixe de l'ordinateur seulement */}
      {onBasculerReplie && (
        <div className={`hidden border-t border-secondary-200 py-2 lg:flex ${replie ? 'justify-center px-3' : 'px-4'}`}>
          <button
            type="button"
            onClick={onBasculerReplie}
            aria-label={replie ? 'Déplier le menu' : 'Replier le menu'}
            title={replie ? 'Déplier le menu' : 'Replier le menu'}
            className={`flex items-center rounded-lg text-caption text-secondary-500 hover:bg-secondary-100 hover:text-secondary-800 ${FOCUS} ${
              replie ? 'h-9 w-10 justify-center' : 'w-full gap-3 px-3 py-2'
            }`}
          >
            {replie
              ? <PanelLeftOpen className={ICONE} strokeWidth={1.75} aria-hidden="true" />
              : <PanelLeftClose className={ICONE} strokeWidth={1.75} aria-hidden="true" />}
            {!replie && 'Replier le menu'}
          </button>
        </div>
      )}
    </div>
  );
}

export default BarreLaterale;
