import { Wrench, MapPin, AlertTriangle, Calendar, CheckCircle } from 'lucide-react';

// =============================================================================
// PAGE ENTRETIENS (Placeholder)
// =============================================================================

export default function Entretiens() {
  // Données groupées par code postal (mock)
  const entretiensByPostalCode = [
    {
      postalCode: '75012',
      city: 'Paris 12e',
      entretiens: [
        {
          id: 1,
          client: 'Mme Dupont',
          address: '12 rue des Lilas',
          equipment: 'Chaudière Viessmann',
          dueDate: '2026-01-15',
          status: 'overdue',
        },
        {
          id: 2,
          client: 'M. Leroy',
          address: '45 bd Diderot',
          equipment: 'PAC Daikin',
          dueDate: '2026-01-20',
          status: 'upcoming',
        },
      ],
    },
    {
      postalCode: '75016',
      city: 'Paris 16e',
      entretiens: [
        {
          id: 3,
          client: 'M. Martin',
          address: '8 av. Victor Hugo',
          equipment: 'Chaudière Saunier Duval',
          dueDate: '2026-01-18',
          status: 'upcoming',
        },
      ],
    },
    {
      postalCode: '75009',
      city: 'Paris 9e',
      entretiens: [
        {
          id: 4,
          client: 'Société ABC',
          address: '23 bd Haussmann',
          equipment: 'Climatisation Mitsubishi',
          dueDate: '2026-02-01',
          status: 'scheduled',
        },
      ],
    },
  ];

  const getStatusInfo = (status) => {
    const statuses = {
      overdue: { 
        label: 'En retard', 
        color: 'text-red-600 bg-red-50',
        icon: AlertTriangle,
      },
      upcoming: { 
        label: 'À planifier', 
        color: 'text-amber-600 bg-amber-50',
        icon: Calendar,
      },
      scheduled: { 
        label: 'Planifié', 
        color: 'text-green-600 bg-green-50',
        icon: CheckCircle,
      },
    };
    return statuses[status] || statuses.upcoming;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Entretiens</h1>
          <p className="text-secondary-600">
            Contrats de maintenance groupés par secteur
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="flex items-center gap-1 text-red-600">
            <AlertTriangle className="w-4 h-4" /> 1 en retard
          </span>
          <span className="flex items-center gap-1 text-amber-600">
            <Calendar className="w-4 h-4" /> 3 à planifier
          </span>
          <span className="flex items-center gap-1 text-green-600">
            <CheckCircle className="w-4 h-4" /> 1 planifié
          </span>
        </div>
      </div>

      {/* Liste groupée par CP */}
      <div className="space-y-6">
        {entretiensByPostalCode.map((group) => (
          <div key={group.postalCode} className="card">
            {/* Header groupe */}
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-secondary-200">
              <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h2 className="font-semibold text-secondary-900">
                  {group.postalCode} - {group.city}
                </h2>
                <p className="text-sm text-secondary-600">
                  {group.entretiens.length} entretien{group.entretiens.length > 1 ? 's' : ''}
                </p>
              </div>
              <button className="ml-auto btn-secondary btn-sm">
                Planifier la tournée
              </button>
            </div>

            {/* Liste entretiens */}
            <div className="space-y-3">
              {group.entretiens.map((entretien) => {
                const statusInfo = getStatusInfo(entretien.status);
                const StatusIcon = statusInfo.icon;
                return (
                  <div
                    key={entretien.id}
                    className="flex items-center gap-4 p-3 rounded-lg bg-secondary-50 hover:bg-secondary-100 transition-colors cursor-pointer"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-secondary-900">
                        {entretien.client}
                      </p>
                      <p className="text-sm text-secondary-600">
                        {entretien.address} • {entretien.equipment}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-secondary-600">
                        Échéance : {new Date(entretien.dueDate).toLocaleDateString('fr-FR')}
                      </p>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${statusInfo.color}`}>
                        <StatusIcon className="w-3 h-3" />
                        {statusInfo.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Info Sprint */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Sprint 4 :</strong> Cette page sera complétée avec les vraies données,
          la planification rapide et le lien vers les fiches clients.
        </p>
      </div>
    </div>
  );
}
