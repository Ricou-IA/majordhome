import { useParams, Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  User, 
  MapPin, 
  Phone, 
  Wrench, 
  Camera, 
  PenTool,
  CheckCircle,
} from 'lucide-react';

// =============================================================================
// PAGE INTERVENTION DETAIL (Placeholder)
// =============================================================================

export default function InterventionDetail() {
  const { id } = useParams();

  // Mock données intervention
  const intervention = {
    id,
    type: 'maintenance',
    status: 'in_progress',
    client: {
      name: 'Mme Marie Dupont',
      phone: '06 12 34 56 78',
      address: '12 rue des Lilas, 75012 Paris',
    },
    equipment: {
      type: 'Chaudière',
      brand: 'Viessmann',
      model: 'Vitodens 200-W',
      installDate: '2022-03-15',
    },
    scheduledAt: '2026-01-07T09:00:00',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/planning"
          className="p-2 rounded-lg hover:bg-secondary-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-secondary-600" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">
            Intervention #{id}
          </h1>
          <p className="text-secondary-600">
            Entretien annuel - {new Date(intervention.scheduledAt).toLocaleDateString('fr-FR')}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Colonne principale */}
        <div className="lg:col-span-2 space-y-6">
          {/* Info client */}
          <div className="card">
            <h2 className="text-lg font-semibold text-secondary-900 mb-4">
              Informations client
            </h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-secondary-400" />
                <span className="text-secondary-900">{intervention.client.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-secondary-400" />
                <a href={`tel:${intervention.client.phone}`} className="text-primary-600 hover:underline">
                  {intervention.client.phone}
                </a>
              </div>
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-secondary-400" />
                <span className="text-secondary-900">{intervention.client.address}</span>
              </div>
            </div>
          </div>

          {/* Info équipement */}
          <div className="card">
            <h2 className="text-lg font-semibold text-secondary-900 mb-4">
              Équipement
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-secondary-600">Type</p>
                <p className="font-medium text-secondary-900">{intervention.equipment.type}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-600">Marque / Modèle</p>
                <p className="font-medium text-secondary-900">
                  {intervention.equipment.brand} {intervention.equipment.model}
                </p>
              </div>
              <div>
                <p className="text-sm text-secondary-600">Date d'installation</p>
                <p className="font-medium text-secondary-900">
                  {new Date(intervention.equipment.installDate).toLocaleDateString('fr-FR')}
                </p>
              </div>
            </div>
          </div>

          {/* Formulaire rapport (placeholder) */}
          <div className="card">
            <h2 className="text-lg font-semibold text-secondary-900 mb-4">
              Rapport d'intervention
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="label">Observations</label>
                <textarea
                  className="input min-h-[100px]"
                  placeholder="Décrivez l'état de l'équipement, les anomalies constatées..."
                />
              </div>

              <div>
                <label className="label">Travaux effectués</label>
                <textarea
                  className="input min-h-[100px]"
                  placeholder="Listez les opérations réalisées..."
                />
              </div>

              <div>
                <label className="label">Pièces remplacées</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Ex: Joint, Électrode d'allumage..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* Colonne latérale */}
        <div className="space-y-6">
          {/* Actions */}
          <div className="card">
            <h2 className="text-lg font-semibold text-secondary-900 mb-4">
              Actions
            </h2>
            <div className="space-y-3">
              <button className="btn-secondary w-full justify-start">
                <Camera className="w-5 h-5" />
                Ajouter des photos
              </button>
              <button className="btn-secondary w-full justify-start">
                <PenTool className="w-5 h-5" />
                Signature client
              </button>
              <button className="btn-primary w-full justify-start">
                <CheckCircle className="w-5 h-5" />
                Valider l'intervention
              </button>
            </div>
          </div>

          {/* Photos placeholder */}
          <div className="card">
            <h2 className="text-lg font-semibold text-secondary-900 mb-4">
              Photos
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="aspect-square bg-secondary-100 rounded-lg flex items-center justify-center">
                <Camera className="w-8 h-8 text-secondary-300" />
              </div>
              <div className="aspect-square bg-secondary-100 rounded-lg flex items-center justify-center border-2 border-dashed border-secondary-300 cursor-pointer hover:bg-secondary-50">
                <span className="text-2xl text-secondary-400">+</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Info Sprint */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Sprint 5 :</strong> Cette page sera complétée avec l'upload de photos,
          le pad de signature et la génération du PV en PDF.
        </p>
      </div>
    </div>
  );
}
