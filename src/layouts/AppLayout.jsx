import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import {
  LayoutDashboard,
  Calendar,
  Users,
  MapPin,
  Kanban,
  Wrench,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Building2,
  User,
} from 'lucide-react';

// =============================================================================
// CONFIGURATION NAVIGATION
// =============================================================================

const navigation = [
  {
    name: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    name: 'Planning',
    href: '/planning',
    icon: Calendar,
  },
  {
    name: 'Clients',
    href: '/clients',
    icon: Users,
  },
  {
    name: 'Territoire',
    href: '/territoire',
    icon: MapPin,
  },
  {
    name: 'Pipeline',
    href: '/pipeline',
    icon: Kanban,
  },
  {
    name: 'Entretiens',
    href: '/entretiens',
    icon: Wrench,
  },
];

// =============================================================================
// APP LAYOUT
// =============================================================================

export default function AppLayout() {
  const navigate = useNavigate();
  const { user, profile, organization, membership, canAccessPipeline, appRole, businessRole, signOut } = useAuth();

  // Debug: log pour vérifier les valeurs
  console.log('[AppLayout] Debug Pipeline access:', {
    hasProfile: !!profile,
    appRole,
    businessRole,
    canAccessPipeline,
    profileAppRole: profile?.app_role,
  });

  // État sidebar mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // État dropdown utilisateur
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
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
    const role = membership?.role;
    switch (role) {
      case 'org_admin':
        return { label: 'Admin', color: 'bg-purple-100 text-purple-700' };
      case 'team_leader':
        return { label: 'Responsable', color: 'bg-blue-100 text-blue-700' };
      case 'user':
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
          Majord'home
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
          .filter((item) => {
            // Masquer Pipeline si le profil n'a pas les droits (basés sur core.profiles)
            if (item.name === 'Pipeline' && !canAccessPipeline) {
              return false;
            }
            return true;
          })
          .map((item) => (
          <NavLink
            key={item.name}
            to={item.href}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-secondary-300 hover:bg-secondary-800 hover:text-white'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            {item.name}
          </NavLink>
        ))}
      </nav>

      {/* Footer sidebar */}
      <div className="px-4 py-4 border-t border-secondary-800">
        <NavLink
          to="/settings"
          onClick={() => setSidebarOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-primary-600 text-white'
                : 'text-secondary-300 hover:bg-secondary-800 hover:text-white'
            }`
          }
        >
          <Settings className="w-5 h-5" />
          Paramètres
        </NavLink>
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
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Mobile */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out lg:hidden ${
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
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white border-b border-secondary-200">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6">
            {/* Menu burger mobile */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 rounded-lg text-secondary-500 hover:bg-secondary-100 lg:hidden"
            >
              <Menu className="w-6 h-6" />
            </button>

            {/* Spacer */}
            <div className="flex-1" />

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary-100 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center">
                  <span className="text-sm font-medium text-white">
                    {getUserInitials()}
                  </span>
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-sm font-medium text-secondary-900">
                    {getUserDisplayName()}
                  </p>
                  <p className="text-xs text-secondary-500">
                    {user?.email}
                  </p>
                </div>
                <ChevronDown className="w-4 h-4 text-secondary-400 hidden sm:block" />
              </button>

              {/* Dropdown */}
              {userMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className="absolute right-0 z-50 mt-2 w-56 bg-white rounded-lg shadow-lg border border-secondary-200 py-1 animate-fade-in">
                    <div className="px-4 py-3 border-b border-secondary-100">
                      <p className="text-sm font-medium text-secondary-900">
                        {getUserDisplayName()}
                      </p>
                      <p className="text-xs text-secondary-500 truncate">
                        {user?.email}
                      </p>
                    </div>

                    <NavLink
                      to="/profile"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2 text-sm text-secondary-700 hover:bg-secondary-50"
                    >
                      <User className="w-4 h-4" />
                      Mon profil
                    </NavLink>

                    <NavLink
                      to="/settings"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2 text-sm text-secondary-700 hover:bg-secondary-50"
                    >
                      <Settings className="w-4 h-4" />
                      Paramètres
                    </NavLink>

                    <div className="border-t border-secondary-100 mt-1 pt-1">
                      <button
                        onClick={handleSignOut}
                        className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
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
        </header>

        {/* Page Content */}
        <main className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
