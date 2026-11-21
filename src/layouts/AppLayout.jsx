import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { moduleActif, peutOuvrirParametres } from '@/lib/modules';
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
} from 'lucide-react';
import { chantierGaillacVisible } from '@apps/chantier-gaillac/config';

// =============================================================================
// CONFIGURATION NAVIGATION
// =============================================================================

const navigation = [
  { name: 'Dashboard',  href: '/',           icon: LayoutDashboard, resource: 'dashboard' },
  { name: 'Planning',   href: '/planning',   icon: Calendar,        resource: 'planning' },
  { name: 'Clients',    href: '/clients',    icon: Users,           resource: 'clients' },
  { name: 'Territoire', href: '/territoire', icon: MapPin,          resource: 'territoire' },
  { name: 'Pipeline',   href: '/pipeline',   icon: Kanban,          resource: 'pipeline' },
  { name: 'Webshop',    href: '/webshop',    icon: ShoppingCart,    resource: 'pipeline', module: 'webshop' },
  { name: 'Chantiers',  href: '/chantiers',  icon: HardHat,        resource: 'chantiers' },
  { name: 'Contrats',   href: '/contrats',   icon: FileText,        resource: 'entretiens', module: 'entretiens' },
  { name: 'Entretiens', href: '/entretiens', icon: Wrench,          resource: 'entretiens', module: 'entretiens' },
  { name: 'Cédants',    href: '/cedants',    icon: Factory,         resource: 'cedants', module: 'cedants' },
  { name: 'Prospection', href: '/prospection', icon: Target,        resource: 'prospection_commerciale', module: 'prospection' },
  { name: 'GeoGrid',     href: '/geogrid',     icon: Grid3x3,       resource: 'settings', module: 'geogrid' },
  { name: 'Mailing',     href: '/mailing',     icon: Mail,          resource: 'settings', module: 'communication' },
  { name: 'Meta Ads',    href: '/meta-ads',    icon: Megaphone,     resource: 'meta_ads', module: 'meta_ads' },
  { name: 'Solaire',     href: '/solaire',     icon: Sun,           resource: 'pv_calculator', module: 'solaire' },
  { name: 'Thermique',   href: '/thermique',   icon: Thermometer,   resource: 'thermal_study', module: 'thermique' },
  // Dimensionnement clim : module activable, ouvert à qui voit les devis.
  { name: 'Climatisation', href: '/clim',      icon: Snowflake,     resource: 'devis', module: 'climatisation' },
  // Tâches récurrentes : libellé = vocabulaire de l'org (« Maintenance », « Traçabilité »…).
  { name: 'Maintenance', href: '/maintenance', icon: ClipboardCheck, resource: 'maintenance', module: 'maintenance' },
  // Module PROVISOIRE : visible des membres Mayer tant que CHANTIER_GAILLAC_ACTIF (hors registre de droits)
  { name: 'Chantier Gaillac', href: '/chantier-gaillac', icon: ClipboardList, visible: chantierGaillacVisible },
];

/**
 * Un item de navigation est-il affiché pour cette org ? Son module (catalogue
 * src/lib/modules.js, ouvert ou fermé depuis Baikal) doit être ouvert ; un item sans
 * `module` appartient au CRM artisan.
 */
const itemVisiblePourOrg = (item, settings) => moduleActif(settings, item.module || 'crm');

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

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

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
            <div className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center">
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
      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {navigation
          .filter((item) => (item.visible
            ? item.visible(organization)
            : itemVisiblePourOrg(item, orgSettings) && can(item.resource, 'view')))
          .map((item) => (
          <NavLink
            key={item.name}
            to={item.href}
            onClick={closeSidebar}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-secondary-300 hover:bg-secondary-800 hover:text-white'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            {item.module === 'maintenance' ? vocabulaire(orgSettings).module : item.name}
          </NavLink>
        ))}
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
                  ? 'bg-primary-600 text-white'
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
            className="h-11 w-11 lg:h-10 lg:w-10 rounded-full bg-primary-600 flex items-center justify-center ring-2 ring-transparent hover:ring-secondary-500 focus-visible:ring-white focus:outline-none transition-shadow"
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
