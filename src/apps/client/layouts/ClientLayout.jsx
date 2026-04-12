/**
 * ClientLayout.jsx - Portail Client Majord'home
 * ============================================================================
 * Layout simplifié pour l'espace client : header + nav horizontale + contenu.
 * Pas de sidebar, design clean et aéré.
 * ============================================================================
 */

import { useState, lazy, Suspense } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import {
  Home, FileText, Wrench, ClipboardList, LogOut, Menu, X, Loader2,
} from 'lucide-react';
import logoMayer from '@/assets/logo-mayer.png';

const ClientChangePassword = lazy(() => import('../pages/ClientChangePassword'));

const NAV_ITEMS = [
  { to: '/client', label: 'Accueil', icon: Home, end: true },
  { to: '/client/contrat', label: 'Contrat', icon: FileText },
  { to: '/client/equipements', label: 'Équipements', icon: Wrench },
  { to: '/client/interventions', label: 'Interventions', icon: ClipboardList },
];

export default function ClientLayout() {
  const { user, clientRecord, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const displayName = clientRecord
    ? `${clientRecord.first_name || ''} ${clientRecord.last_name || ''}`.trim()
    : user?.email;

  const mustChangePassword = user?.user_metadata?.must_change_password === true;

  const handleSignOut = async () => {
    await signOut();
  };

  // Forcer le changement de mot de passe au premier login
  if (mustChangePassword) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary-600 animate-spin" /></div>}>
        <ClientChangePassword />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ================================================================= */}
      {/* HEADER                                                            */}
      {/* ================================================================= */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Logo + nav desktop */}
            <div className="flex items-center gap-6">
              <NavLink to="/client" className="text-sm font-medium text-gray-400">
                Espace client
              </NavLink>

              {/* Nav desktop intégrée */}
              <nav className="hidden md:flex items-center gap-1 border-l border-gray-200 pl-6">
                {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                        isActive
                          ? 'bg-primary-50 text-primary-600'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </NavLink>
                ))}
              </nav>
            </div>

            {/* Desktop: user + logout */}
            <div className="hidden md:flex items-center gap-4">
              <span className="text-sm text-gray-600">{displayName}</span>
              <button
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Déconnexion
              </button>
            </div>

            {/* Mobile: hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-gray-500 hover:text-gray-700"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* ================================================================= */}
        {/* MENU MOBILE                                                       */}
        {/* ================================================================= */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white">
            <div className="px-4 py-2 space-y-1">
              {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-600'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </NavLink>
              ))}
              <div className="pt-2 mt-2 border-t border-gray-100">
                <div className="px-3 py-1 text-xs text-gray-400">{user?.email}</div>
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  <LogOut className="w-4 h-4" />
                  Déconnexion
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ================================================================= */}
      {/* CONTENU                                                           */}
      {/* ================================================================= */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
        <Outlet />
      </main>
    </div>
  );
}
