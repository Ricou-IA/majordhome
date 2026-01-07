import { useAuth } from '@contexts/AuthContext';
import { 
  Calendar, 
  Users, 
  Wrench, 
  AlertTriangle,
  Clock,
  CheckCircle,
  TrendingUp,
} from 'lucide-react';

// =============================================================================
// PAGE DASHBOARD
// =============================================================================

export default function Dashboard() {
  const { profile, organization } = useAuth();

  // TODO: Remplacer par de vraies données
  const stats = [
    {
      label: "RDV aujourd'hui",
      value: 4,
      icon: Calendar,
      color: 'bg-blue-500',
    },
    {
      label: 'Clients actifs',
      value: 156,
      icon: Users,
      color: 'bg-green-500',
    },
    {
      label: 'Entretiens à planifier',
      value: 12,
      icon: Wrench,
      color: 'bg-amber-500',
    },
    {
      label: 'Devis en attente',
      value: 8,
      icon: TrendingUp,
      color: 'bg-purple-500',
    },
  ];

  const todayEvents = [
    {
      id: 1,
      time: '09:00',
      type: 'maintenance',
      client: 'Mme Dupont',
      address: '12 rue des Lilas, 75012 Paris',
    },
    {
      id: 2,
      time: '11:30',
      type: 'rdv_technical',
      client: 'M. Martin',
      address: '45 av. Victor Hugo, 75016 Paris',
    },
    {
      id: 3,
      time: '14:00',
      type: 'installation',
      client: 'Société ABC',
      address: '8 bd Haussmann, 75009 Paris',
    },
    {
      id: 4,
      time: '16:30',
      type: 'service',
      client: 'M. Bernard',
      address: '23 rue de la Paix, 75002 Paris',
    },
  ];

  const alerts = [
    {
      id: 1,
      type: 'warning',
      message: '3 entretiens en retard de planification',
    },
    {
      id: 2,
      type: 'info',
      message: '2 nouveaux leads à qualifier',
    },
  ];

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  const getEventTypeLabel = (type) => {
    const types = {
      maintenance: { label: 'Entretien', color: 'bg-event-maintenance' },
      rdv_technical: { label: 'RDV Technique', color: 'bg-event-rdv_technical' },
      installation: { label: 'Installation', color: 'bg-event-installation' },
      service: { label: 'SAV', color: 'bg-event-service' },
      rdv_agency: { label: 'RDV Agence', color: 'bg-event-rdv_agency' },
    };
    return types[type] || { label: type, color: 'bg-secondary-500' };
  };

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">
          Bonjour, {profile?.full_name?.split(' ')[0] || 'Utilisateur'} 👋
        </h1>
        <p className="text-secondary-600">
          Voici votre journée du {new Date().toLocaleDateString('fr-FR', { 
            weekday: 'long', 
            day: 'numeric', 
            month: 'long' 
          })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <div key={index} className="card">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-lg ${stat.color} flex items-center justify-center`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-2xl font-bold text-secondary-900">
                  {stat.value}
                </p>
                <p className="text-sm text-secondary-600">
                  {stat.label}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Contenu principal */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Planning du jour */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-secondary-900">
              Planning du jour
            </h2>
            <a href="/planning" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              Voir tout →
            </a>
          </div>

          <div className="space-y-3">
            {todayEvents.map((event) => {
              const eventType = getEventTypeLabel(event.type);
              return (
                <div
                  key={event.id}
                  className="flex items-start gap-4 p-3 rounded-lg bg-secondary-50 hover:bg-secondary-100 transition-colors"
                >
                  <div className="text-center min-w-[60px]">
                    <p className="text-lg font-semibold text-secondary-900">
                      {event.time}
                    </p>
                  </div>
                  <div className={`w-1 self-stretch rounded-full ${eventType.color}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded text-white ${eventType.color}`}>
                        {eventType.label}
                      </span>
                    </div>
                    <p className="mt-1 font-medium text-secondary-900">
                      {event.client}
                    </p>
                    <p className="text-sm text-secondary-600">
                      {event.address}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Alertes */}
        <div className="card">
          <h2 className="text-lg font-semibold text-secondary-900 mb-4">
            Alertes
          </h2>

          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3 rounded-lg flex items-start gap-3 ${
                  alert.type === 'warning' 
                    ? 'bg-amber-50 text-amber-800' 
                    : 'bg-blue-50 text-blue-800'
                }`}
              >
                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{alert.message}</p>
              </div>
            ))}
          </div>

          {/* Actions rapides */}
          <div className="mt-6 pt-6 border-t border-secondary-200">
            <h3 className="text-sm font-medium text-secondary-700 mb-3">
              Actions rapides
            </h3>
            <div className="space-y-2">
              <a 
                href="/clients" 
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-secondary-50 text-secondary-700"
              >
                <Users className="w-4 h-4" />
                <span className="text-sm">Nouveau client</span>
              </a>
              <a 
                href="/planning" 
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-secondary-50 text-secondary-700"
              >
                <Calendar className="w-4 h-4" />
                <span className="text-sm">Planifier un RDV</span>
              </a>
              <a 
                href="/entretiens" 
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-secondary-50 text-secondary-700"
              >
                <Wrench className="w-4 h-4" />
                <span className="text-sm">Voir les entretiens</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
