import { Calendar } from 'lucide-react';

// =============================================================================
// PAGE PLANNING (Placeholder)
// =============================================================================

export default function Planning() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Planning</h1>
          <p className="text-secondary-600">
            Gérez vos rendez-vous et interventions
          </p>
        </div>
        <button className="btn-primary">
          <Calendar className="w-5 h-5" />
          Nouveau RDV
        </button>
      </div>

      {/* Placeholder FullCalendar */}
      <div className="card min-h-[600px] flex items-center justify-center">
        <div className="text-center">
          <Calendar className="w-16 h-16 text-secondary-300 mx-auto" />
          <h2 className="mt-4 text-lg font-medium text-secondary-900">
            Calendrier FullCalendar
          </h2>
          <p className="mt-2 text-secondary-600 max-w-md">
            Le calendrier interactif sera implémenté dans le Sprint 1.
            <br />
            Fonctionnalités : vue semaine/jour/mois, drag & drop, resize.
          </p>
        </div>
      </div>
    </div>
  );
}
