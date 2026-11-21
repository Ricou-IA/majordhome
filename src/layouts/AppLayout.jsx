import { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { moduleActif, peutOuvrirParametres } from '@/lib/modules';
import { grouperMenu, etatDuGroupe, lirePreferencesMenu } from '@/lib/menuGroupes';
import { vocabulaire } from '@/lib/maintenance/vocabulaire';
import { AppUpdateWatcher } from '@components/AppUpdateWatcher';
import {
  LayoutDashboard,
  Calendar,
  Users,
  MapPin,
  Kanban,
  HardHat,
  Wrench,
  Settings,
  LogOut,
  Menu,
  Building2,
  User,
  Factory,
  Target,
  Grid3x3,
  Mail,
  FileText,
  Megaphone,
  Sun,
  ShoppingCart,
  Thermometer,
  ClipboardCheck,
  Snowflake,
  ClipboardList,
  ChevronDown,
} from 'lucide-react';
import { chantierGaillacVisible } from '@apps/chantier-gaillac/config';

// =============================================================================
// CONFIGURATION NAVIGATION
// =============================================================================

// `groupe` = clé de GROUPES_MENU (src/lib/menuGroupes.js). Au-delà de 8 entrées visibles le
// menu se range en groupes repliables ; en dessous il reste cette liste, dans cet ordre.
// Toute nouvelle entrée porte son groupe (scripts/menu-groupes.test.mjs le vérifie).
const navigation = [
  { name: 'Dashboard',  href: '/',           icon: LayoutDashboard, resource: 'dashboard', groupe: 'quotidien' },
  { name: 'Planning',   href: '/planning',   icon: Calendar,        resource: 'planning', groupe: 'quotidien' },
  { name: 'Clients',    href: '/clients',    icon: Users,           resource: 'clients', groupe: 'ventes' },
  { name: 'Territoire', href: '/territoire', icon: MapPin,          resource: 'territoire', groupe: 'ventes' },
  { name: 'Pipeline',   href: '/pipeline',   icon: Kanban,          resource: 'pipeline', groupe: 'ventes' },
  { name: 'Webshop',    href: '/webshop',    icon: ShoppingCart,    resource: 'pipeline', module: 'webshop', groupe: 'ventes' },
  { name: 'Chantiers',  href: '/chantiers',  icon: HardHat,         resource: 'chantiers', groupe: 'terrain' },
  { name: 'Contrats',   href: '/contrats',   icon: FileText,        resource: 'entretiens', module: 'entretiens', groupe: 'ventes' },
  { name: 'Entretiens', href: '/entretiens', icon: Wrench,          resource: 'entretiens', module: 'entretiens', groupe: 'terrain' },
  { name: 'Cédants',    href: '/cedants',    icon: Factory,         resource: 'cedants', module: 'cedants', groupe: 'ventes' },
  { name: 'Prospection', href: '/prospection', icon: Target,        resource: 'prospection_commerciale', module: 'prospection', groupe: 'ventes' },
  { name: 'GeoGrid',     href: '/geogrid',     icon: Grid3x3,       resource: 'settings', module: 'geogrid', groupe: 'marketing' },
  { name: 'Mailing',     href: '/mailing',     icon: Mail,          resource: 'settings', module: 'communication', groupe: 'marketing' },
  { name: 'Meta Ads',    href: '/meta-ads',    icon: Megaphone,     resource: 'meta_ads', module: 'meta_ads', groupe: 'marketing' },
  { name: 'Solaire',     href: '/solaire',     icon: Sun,           resource: 'pv_calculator', module: 'solaire', groupe: 'etudes' },
  { name: 'Thermique',   href: '/thermique',   icon: Thermometer,   resource: 'thermal_study', module: 'thermique', groupe: 'etudes' },
  // Dimensionnement clim : module activable, ouvert à qui voit les devis.
  { name: 'Climatisation', href: '/clim',      icon: Snowflake,     resource: 'devis', module: 'climatisation', groupe: 'etudes' },
  // Tâches récurrentes : libellé = vocabulaire de l'org (« Maintenance », « Traçabilité »…).
  { name: 'Maintenance', href: '/maintenance', icon: ClipboardCheck, resource: 'maintenance', module: 'maintenance', groupe: 'terrain' },
  // Module PROVISOIRE : visible des membres Mayer tant que CHANTIER_GAILLAC_ACTIF (hors registre de droits)
  { name: 'Chantier Gaillac', href: '/chantier-gaillac', icon: ClipboardList, visible: chantierGaillacVisible, groupe: 'terrain' },
];

/**
 * Un item de navigation est-il affiché pour cette org ? Son module (catalogue
 * src/lib/modules.js, ouvert ou fermé depuis Baikal) doit être ouvert ; un item sans
 * `module` appartient au CRM artisan.
 */
const itemVisiblePourOrg = (item, settings) => moduleActif(settings, item.module || 'crm');

/** Choix de repli des groupes du menu, lus sur l'appareil (aucun si le stockage est indisponible). */
function lireReplisMenu(cle) {
  try {
    return lirePreferencesMenu(cle ? window.localStorage.getItem(cle) : null);
  } catch {
    return {};
  }
}

// =============================================================================
// APP LAYOUT
// =============================================================================

export default function AppLayout() {
  const navigate = useNavigate();
  const { user, profile, organization, effectiveRole, signOut } = useAuth();
  const { can } = useCanAccess();
  const { settings: orgSettings } = useOrgSettings();
  // Paramètres : admins, ou un rôle qui a une tuile à droit (team_leader → Fournisseurs & catalogue, Eric 2026-10-27)
  const peutOuvrirReglages = can('settings', 'view') || peutOuvrirParametres(orgSettings, { isOrgAdmin: false, can });

  // État sidebar mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // État menu du profil (pied du menu, en bas à droite)
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Menu : entrées visibles pour cette personne, rangées en groupes au-delà d'un menu court.
  const { pathname } = useLocation();
  const groupesDuMenu = grouperMenu(navigation.filter((item) => (item.visible
    ? item.visible(organization)
    : itemVisiblePourOrg(item, orgSettings) && can(item.resource, 'view'))));
  // Groupes repliés ou dépliés par la personne, gardés sur son appareil (clé par utilisateur :
  // cette coque n'est montée qu'une fois la personne connue, et démontée à la déconnexion).
  const cleReplisMenu = user?.id ? `menu-groupes:${user.id}` : null;
  const [replisMenu, setReplisMenu] = useState(() => lireReplisMenu(cleReplisMenu));

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  const basculerGroupe = (cle, ouvert) => {
    const suivant = { ...replisMenu, [cle]: !ouvert };
    setReplisMenu(suivant);
    try {
      if (cleReplisMenu) window.localStorage.setItem(cleReplisMenu, JSON.stringify(suivant));
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour cette visite.
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  // Ferme le tiroir mobile ET le menu du profil (lien suivi, clic hors du tiroir)
  const closeSidebar = () => {
    setSidebarOpen(false);
    setUserMenuOpen(false);
  };

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  const getUserDisplayName = () => {
    if (profile?.full_name) return profile.full_name;
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
    if (user?.email) return user.email.split('@')[0];
    return 'Utilisateur';
  };

  const getUserInitials = () => {
    const name = getUserDisplayName();
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getRoleBadge = () => {
    switch (effectiveRole) {
      case 'org_admin':
        return { label: 'Admin', color: 'bg-purple-100 text-purple-700' };
      case 'team_leader':
        return { label: 'Responsable', color: 'bg-blue-100 text-blue-700' };
      case 'commercial':
        return { label: 'Commercial', color: 'bg-amber-100 text-amber-700' };
      case 'technicien':
        return { label: 'Technicien', color: 'bg-green-100 text-green-700' };
      default:
        return null;
    }
  };

  // ===========================================================================
  // RENDER SIDEBAR
  // ===========================================================================

  const renderSidebar = () => (
    <div className="flex flex-col h-full bg-secondary-900">
      {/* Logo */}
      <div className="flex items-center h-16 px-6 border-b border-secondary-800">
        <h1 className="text-xl font-bold text-white">
          Majord&apos;home
        </h1>
      </div>

      {/* Organisation */}
      {organization && (
        <div className="px-4 py-4 border-b border-secondary-800">
          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 rounded-lg bg-primary-700 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {organization.name}
              </p>
              {getRoleBadge() && (
                <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded ${getRoleBadge().color}`}>
                  {getRoleBadge().label}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-4 py-4 overflow-y-auto">
        {groupesDuMenu.map((groupe, rang) => {
          const { ouvert, force } = etatDuGroupe(groupe, { preferences: replisMenu, pathname });
          return (
            <div key={groupe.cle} className={rang > 0 ? 'mt-3' : ''}>
              {groupe.titre && (
                <button
                  type="button"
                  onClick={() => basculerGroupe(groupe.cle, ouvert)}
                  disabled={force}
                  aria-expanded={ouvert}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider text-secondary-400 enabled:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500"
                >
                  {groupe.titre}
                  {!force && (
                    <ChevronDown className={`w-4 h-4 transition-transform ${ouvert ? '' : '-rotate-90'}`} />
                  )}
                </button>
              )}
              {ouvert && (
                <div className="space-y-1">
                  {groupe.items.map((item) => (
                    <NavLink
                      key={item.name}
                      to={item.href}
                      onClick={closeSidebar}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-lg text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-primary-700 text-white'
                            : 'text-secondary-300 hover:bg-secondary-800 hover:text-white'
                        }`
                      }
                    >
                      <item.icon className="w-5 h-5" />
                      {item.module === 'maintenance' ? vocabulaire(orgSettings).module : item.name}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Pied du menu : Paramètres à gauche — admins (settings.view) ou tout rôle qui a au moins
          une tuile de Paramètres (Fournisseurs & catalogue → articles.edit) — et profil en bas à
          droite. Sans accès aux Paramètres, le nom de la personne prend la place du lien. */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-secondary-800">
        {peutOuvrirReglages ? (
          <NavLink
            to="/settings"
            onClick={closeSidebar}
            className={({ isActive }) =>
              `flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary-700 text-white'
                  : 'text-secondary-300 hover:bg-secondary-800 hover:text-white'
              }`
            }
          >
            <Settings className="w-5 h-5" />
            Paramètres
          </NavLink>
        ) : (
          <p className="flex-1 min-w-0 px-3 text-sm font-medium text-secondary-300 truncate">
            {getUserDisplayName()}
          </p>
        )}

        <div className="relative shrink-0">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            aria-label={`Menu du profil — ${getUserDisplayName()}`}
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            title={getUserDisplayName()}
            className="h-11 w-11 lg:h-10 lg:w-10 rounded-full bg-primary-700 flex items-center justify-center ring-2 ring-transparent hover:ring-secondary-500 focus-visible:ring-white focus:outline-none transition-shadow"
          >
            <span className="text-sm font-medium text-white">
              {getUserInitials()}
            </span>
          </button>

          {userMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setUserMenuOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 bottom-full z-50 mb-2 w-56 bg-white rounded-lg shadow-lg border border-secondary-200 py-1 animate-fade-in"
              >
                <div className="px-4 py-3 border-b border-secondary-100">
                  <p className="text-sm font-medium text-secondary-900 truncate">
                    {getUserDisplayName()}
                  </p>
                  <p className="text-xs text-secondary-500 truncate">
                    {user?.email}
                  </p>
                </div>

                <NavLink
                  to="/profile"
                  role="menuitem"
                  onClick={closeSidebar}
                  className="flex items-center gap-3 px-4 py-2.5 lg:py-2 text-sm text-secondary-700 hover:bg-secondary-50"
                >
                  <User className="w-4 h-4" />
                  Mon profil
                </NavLink>

                <div className="border-t border-secondary-100 mt-1 pt-1">
                  <button
                    role="menuitem"
                    onClick={handleSignOut}
                    className="flex items-center gap-3 w-full px-4 py-2.5 lg:py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <LogOut className="w-4 h-4" />
                    Se déconnecter
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="min-h-screen bg-secondary-50">
      {/* Sidebar Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar Mobile — tiroir, jamais plus large que 85 % de l'écran pour
          laisser l'overlay tapable (fermeture au doigt) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        aria-hidden={!sidebarOpen}
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform transition-transform duration-300 ease-out lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {renderSidebar()}
      </div>

      {/* Sidebar Desktop */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:w-64 lg:block">
        {renderSidebar()}
      </div>

      {/* Main Content */}
      <div className="lg:pl-64">
        {/* Bandeau du haut : téléphone seulement, pour ouvrir le menu. Dès que le menu est
            affiché en permanence (lg, tablettes comprises), il n'a plus rien à porter — le
            profil est au pied du menu — et la page gagne sa hauteur. */}
        <header className="sticky top-0 z-30 bg-white border-b border-secondary-200 lg:hidden">
          <div className="flex items-center h-14 px-3 sm:px-6">
            {/* Menu burger mobile */}
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Ouvrir le menu"
              aria-expanded={sidebarOpen}
              className="h-11 w-11 -ml-1 flex items-center justify-center rounded-lg text-secondary-600 hover:bg-secondary-100"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </header>

        {/* Page Content — marge basse étendue à la zone de sécurité iOS (barre d'accueil) */}
        <main className="p-4 sm:p-6 lg:p-8 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 lg:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Nouvelle version déployée : bouton « Mettre à jour », rechargement au changement de page */}
      <AppUpdateWatcher />
    </div>
  );
}
