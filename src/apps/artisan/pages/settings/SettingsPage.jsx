// src/apps/artisan/pages/settings/SettingsPage.jsx
// ============================================================================
// Gabarit d'une page de paramétrage : fil d'Ariane vers /settings, titre,
// description, onglets optionnels, contenu. Garde org_admin déclarative (en
// complément du RouteGuard `settings` de routes.jsx), comme OrganizationSettings.
// Utilisé par les pages nées du regroupement par module (Équipements, Tournées,
// Emails, SMS) ; les pages antérieures gardent leur propre en-tête.
// ============================================================================
import { useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';

/**
 * @param {object} p
 * @param {string} p.title
 * @param {string} p.description
 * @param {Array<{ key: string, label: string, icon: React.ComponentType }>} [p.tabs]
 * @param {string} [p.tab]  onglet actif
 * @param {(key: string) => void} [p.onTabChange]
 * @param {React.ReactNode} p.children
 */
export default function SettingsPage({ title, description, tabs, tab, onTabChange, children }) {
  const { isOrgAdmin } = useAuth();

  useEffect(() => {
    if (!isOrgAdmin) toast.error("Accès réservé à l'administrateur de l'organisation");
  }, [isOrgAdmin]);

  if (!isOrgAdmin) return <Navigate to="/settings" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-secondary-500">
        <Link to="/settings" className="hover:text-secondary-700">Paramètres</Link>
        <span>/</span>
        <span className="text-secondary-900">{title}</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-secondary-900">{title}</h1>
        {description && <p className="text-secondary-600">{description}</p>}
      </div>

      {tabs && tabs.length > 0 && (
        <div className="flex border-b border-secondary-200 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onTabChange?.(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 whitespace-nowrap ${
                tab === t.key
                  ? 'border-primary-500 text-primary-700'
                  : 'border-transparent text-secondary-500 hover:text-secondary-700'
              }`}
            >
              {t.icon && <t.icon className="w-4 h-4" />}
              {t.label}
            </button>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}
