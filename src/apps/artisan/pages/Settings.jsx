import { NavLink } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { ROLE_LABELS } from '@lib/permissions';
import { modulesVisibles } from '@/lib/modules';
import { useOrgSettings } from '@hooks/useOrgSettings';
import {
  Building2,
  Users,
  Shield,
  Wrench,
  Truck,
  Calculator,
  Route,
  Mail,
  MessageSquare,
  Sun,
  Thermometer,
  Receipt,
  BookOpen,
  ClipboardCheck,
  HelpCircle,
} from 'lucide-react';

// =============================================================================
// PAGE SETTINGS — un groupe par module de l'offre (registre src/lib/modules.js)
// =============================================================================

// Le registre est un module pur : il nomme ses icônes, la page les résout.
// ⚠️ Toute icône citée dans modules.js doit être listée ici, sinon la tuile
// affiche un « ? » (HelpCircle) — vécu sur Facturation Pennylane, 2026-09-21.
const ICONS = { Building2, Users, Shield, Wrench, Truck, Calculator, Route, Mail, MessageSquare, Sun, Thermometer, Receipt, BookOpen, ClipboardCheck };

export default function Settings() {
  const { organization, effectiveRole, isOrgAdmin } = useAuth();
  const { settings } = useOrgSettings();

  // Socle en tête, puis les modules ; un module sans tuile visible pour ce rôle
  // n'affiche pas son en-tête. Modules opt-in (Maintenance) seulement s'ils sont
  // activés ; une org sans CRM ne voit que les tuiles `horsCrm`.
  const groupes = modulesVisibles(settings, { isOrgAdmin });

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

      {/* Un groupe par module */}
      {groupes.map((m) => (
        <section key={m.key} className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-secondary-900">{m.label}</h2>
            {m.description && <p className="text-sm text-secondary-500">{m.description}</p>}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {m.tiles.map((t) => {
              const Icon = ICONS[t.icon] || HelpCircle;
              return (
                <NavLink key={t.key} to={t.href} className="card-hover flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-secondary-100 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-secondary-600" />
                  </div>
                  <div>
                    <h3 className="font-medium text-secondary-900">{t.title}</h3>
                    <p className="text-sm text-secondary-600">{t.description}</p>
                  </div>
                </NavLink>
              );
            })}
          </div>
        </section>
      ))}

      {/* Aide — emplacement RÉSERVÉ à l'agent d'onboarding (décision Eric,
          2026-09-13) : chantier à part, non commencé. Les deux boutons sont
          volontairement inactifs en attendant ; ne pas retirer le bloc. */}
      <div className="card bg-secondary-50">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
            <HelpCircle className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h3 className="font-medium text-secondary-900">
              Besoin d&apos;aide ?
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
