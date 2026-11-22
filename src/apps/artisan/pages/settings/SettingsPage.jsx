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
import { useCanAccess } from '@hooks/usePermissions';

/**
 * @param {object} p
 * @param {string} p.title
 * @param {string} p.description
 * @param {{ resource: string, action: string }} [p.acces]  droit qui ouvre la page à un non-admin (ex. `articles.edit`
 *   pour Fournisseurs & catalogue, Eric 2026-10-27) ; absent = org_admin seul
 * @param {Array<{ key: string, label: string, icon: React.ComponentType }>} [p.tabs]
 * @param {string} [p.tab]  onglet actif
 * @param {(key: string) => void} [p.onTabChange]
 * @param {'onglets' | 'menu'} [p.disposition]  `menu` : les onglets deviennent un menu vertical à gauche sur écran
 *   large (pages à nombreux chapitres, ex. E-mails & SMS) ; onglets défilants sur écran étroit
 * @param {React.ReactNode} p.children
 */
export default function SettingsPage({ title, description, acces, tabs, tab, onTabChange, disposition = 'onglets', children }) {
  const { isOrgAdmin } = useAuth();
  const { can, permissionsLoading } = useCanAccess();
  const autorise = isOrgAdmin || (!!acces && can(acces.resource, acces.action) === true);
  const refuse = !permissionsLoading && !autorise;

  useEffect(() => {
    if (refuse) toast.error(acces ? 'Accès réservé aux responsables' : "Accès réservé à l'administrateur de l'organisation");
  }, [refuse, acces]);

  if (refuse) return <Navigate to="/settings" replace />;
  if (!autorise) return null; // non-admin : on attend le verdict des droits avant d'afficher ou de rediriger

  const aDesOnglets = Array.isArray(tabs) && tabs.length > 0;
  const enMenu = aDesOnglets && disposition === 'menu';

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

      {aDesOnglets && !enMenu && (
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

      {enMenu ? (
        <div className="space-y-6 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8 lg:space-y-0">
          <nav
            aria-label={title}
            className="flex gap-1 overflow-x-auto border-b border-secondary-200 pb-2 lg:sticky lg:top-4 lg:flex-col lg:self-start lg:overflow-visible lg:border-b-0 lg:pb-0"
          >
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => onTabChange?.(t.key)}
                aria-current={tab === t.key ? 'page' : undefined}
                className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                  tab === t.key
                    ? 'bg-primary-50 text-primary-800'
                    : 'text-secondary-600 hover:bg-secondary-50 hover:text-secondary-900'
                }`}
              >
                {t.icon && <t.icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 space-y-6">{children}</div>
        </div>
      ) : children}
    </div>
  );
}
