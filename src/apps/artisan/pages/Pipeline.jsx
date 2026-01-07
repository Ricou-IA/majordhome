import { Kanban } from 'lucide-react';

// =============================================================================
// PAGE PIPELINE (Placeholder)
// =============================================================================

export default function Pipeline() {
  // Colonnes du Kanban
  const columns = [
    {
      id: 'lead',
      title: 'Leads',
      color: 'bg-status-lead',
      count: 5,
    },
    {
      id: 'prospect',
      title: 'Prospects',
      color: 'bg-status-prospect',
      count: 3,
    },
    {
      id: 'quote_sent',
      title: 'Devis envoyé',
      color: 'bg-status-quote',
      count: 4,
    },
    {
      id: 'accepted',
      title: 'Accepté',
      color: 'bg-status-accepted',
      count: 2,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">Pipeline</h1>
        <p className="text-secondary-600">
          Suivez vos opportunités commerciales
        </p>
      </div>

      {/* Kanban placeholder */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {columns.map((column) => (
          <div key={column.id} className="bg-secondary-100 rounded-lg p-4">
            {/* Header colonne */}
            <div className="flex items-center gap-2 mb-4">
              <div className={`w-3 h-3 rounded-full ${column.color}`} />
              <h3 className="font-medium text-secondary-900">{column.title}</h3>
              <span className="ml-auto text-sm text-secondary-500">
                {column.count}
              </span>
            </div>

            {/* Cartes placeholder */}
            <div className="space-y-3">
              {[...Array(column.count)].map((_, index) => (
                <div
                  key={index}
                  className="bg-white rounded-lg p-3 shadow-sm border border-secondary-200"
                >
                  <div className="h-4 bg-secondary-200 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-secondary-100 rounded w-1/2" />
                </div>
              ))}
            </div>

            {/* Bouton ajouter */}
            <button className="mt-3 w-full py-2 text-sm text-secondary-500 hover:text-secondary-700 hover:bg-secondary-200 rounded-lg transition-colors">
              + Ajouter
            </button>
          </div>
        ))}
      </div>

      {/* Info Sprint */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Sprint 3 :</strong> Cette page sera complétée avec le Kanban interactif,
          le drag & drop entre colonnes, et les cartes de devis détaillées.
        </p>
      </div>
    </div>
  );
}
