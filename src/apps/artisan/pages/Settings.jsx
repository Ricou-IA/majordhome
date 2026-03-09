import { NavLink } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { ROLE_LABELS } from '@lib/permissions';
import {
  Building2,
  Users,
  Bell,
  Palette,
  Shield,
  CreditCard,
  HelpCircle,
} from 'lucide-react';

// =============================================================================
// PAGE SETTINGS
// =============================================================================

export default function Settings() {
  const { organization, effectiveRole, isOrgAdmin } = useAuth();

  const settingsSections = [
    {
      title: 'Organisation',
      icon: Building2,
      description: 'Gérer les informations de votre entreprise',
      href: '/settings/organization',
      adminOnly: true,
    },
    {
      title: 'Équipe',
      icon: Users,
      description: 'Gérer les membres et leurs rôles',
      href: '/settings/team',
      adminOnly: true,
    },
    {
      title: 'Droits d\'accès',
      icon: Shield,
      description: 'Configurer les permissions par rôle',
      href: '/settings/permissions',
      adminOnly: true,
    },
    {
      title: 'Notifications',
      icon: Bell,
      description: 'Configurer vos préférences de notification',
      href: '/settings/notifications',
      adminOnly: false,
    },
    {
      title: 'Apparence',
      icon: Palette,
      description: 'Personnaliser l\'affichage de l\'application',
      href: '/settings/appearance',
      adminOnly: false,
    },
    {
      title: 'Facturation',
      icon: CreditCard,
      description: 'Gérer votre abonnement et vos factures',
      href: '/settings/billing',
      adminOnly: true,
    },
  ];

  const filteredSections = settingsSections.filter(
    (section) => !section.adminOnly || isOrgAdmin
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">Paramètres</h1>
        <p className="text-secondary-600">
          Gérez les paramètres de votre compte et de votre organisation
        </p>
      </div>

      {/* Organisation info */}
      {organization && (
        <div className="card">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-primary-100 flex items-center justify-center">
              <Building2 className="w-7 h-7 text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-secondary-900">
                {organization.name}
              </h2>
              <p className="text-sm text-secondary-600">
                Votre rôle : {ROLE_LABELS[effectiveRole] || effectiveRole}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Settings sections */}
      <div className="grid sm:grid-cols-2 gap-4">
        {filteredSections.map((section) => (
          <NavLink
            key={section.title}
            to={section.href}
            className="card-hover flex items-start gap-4"
          >
            <div className="w-10 h-10 rounded-lg bg-secondary-100 flex items-center justify-center flex-shrink-0">
              <section.icon className="w-5 h-5 text-secondary-600" />
            </div>
            <div>
              <h3 className="font-medium text-secondary-900">
                {section.title}
              </h3>
              <p className="text-sm text-secondary-600">
                {section.description}
              </p>
            </div>
          </NavLink>
        ))}
      </div>

      {/* Aide */}
      <div className="card bg-secondary-50">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
            <HelpCircle className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h3 className="font-medium text-secondary-900">
              Besoin d'aide ?
            </h3>
            <p className="text-sm text-secondary-600 mt-1">
              Consultez notre documentation ou contactez le support.
            </p>
            <div className="flex gap-3 mt-3">
              <button className="btn-secondary btn-sm">
                Documentation
              </button>
              <button className="btn-secondary btn-sm">
                Contacter le support
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
