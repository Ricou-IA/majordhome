/**
 * InterventionHeader.jsx - Majord'home Artisan
 * ============================================================================
 * Résumé lecture seule d'une intervention : client, équipement, type, date,
 * status badge, bouton "Commencer l'intervention".
 *
 * @version 1.0.0 - Sprint 3 Outil Terrain Tablette
 * ============================================================================
 */

import {
  MapPin,
  Phone,
  Calendar,
  Clock,
  User,
  Wrench,
  Play,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  getInterventionTypeConfig,
  getInterventionStatusConfig,
} from '@/shared/services/interventions.service';

/**
 * @param {Object} props
 * @param {Object} props.intervention - Données intervention
 * @param {Object} props.client - Données client (display_name, address, phone...)
 * @param {Object} props.equipment - Données équipement (brand, model, category)
 * @param {Function} props.onStart - Callback quand on clique "Commencer"
 * @param {Function} props.onComplete - Callback quand on clique "Terminer"
 * @param {boolean} props.isChangingStatus - Loading état changement statut
 */
export function InterventionHeader({
  intervention,
  client,
  equipment,
  onStart,
  onComplete,
  isChangingStatus = false,
}) {
  if (!intervention) return null;

  const typeConfig = getInterventionTypeConfig(intervention.intervention_type);
  const statusConfig = getInterventionStatusConfig(intervention.status);

  const isScheduled = intervention.status === 'scheduled';
  const isInProgress = intervention.status === 'in_progress';
  const isCompleted = intervention.status === 'completed';
  const isCancelled = intervention.status === 'cancelled';

  // Formatage date
  const dateStr = intervention.scheduled_date
    ? new Date(intervention.scheduled_date).toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '—';

  const timeStr = intervention.scheduled_time_start
    ? `${intervention.scheduled_time_start.slice(0, 5)}${intervention.scheduled_time_end ? ` - ${intervention.scheduled_time_end.slice(0, 5)}` : ''}`
    : null;

  return (
    <div className="space-y-4">
      {/* En-tête : type + statut */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Badge className={typeConfig.bgClass}>{typeConfig.label}</Badge>
          <Badge className={statusConfig.color}>{statusConfig.label}</Badge>
        </div>

        {/* Bouton action principal */}
        {isScheduled && (
          <Button
            onClick={onStart}
            disabled={isChangingStatus}
            className="min-h-[44px] min-w-[44px] text-base gap-2"
          >
            <Play className="h-5 w-5" />
            {isChangingStatus ? 'Démarrage...' : "Commencer l'intervention"}
          </Button>
        )}

        {isInProgress && (
          <Button
            onClick={onComplete}
            disabled={isChangingStatus}
            variant="outline"
            className="min-h-[44px] min-w-[44px] text-base gap-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50"
          >
            <CheckCircle className="h-5 w-5" />
            {isChangingStatus ? 'Finalisation...' : 'Terminer'}
          </Button>
        )}

        {isCancelled && (
          <Badge className="bg-red-100 text-red-700 text-sm py-1 px-3">
            <AlertTriangle className="h-4 w-4 mr-1 inline" />
            Intervention annulée
          </Badge>
        )}
      </div>

      {/* Infos client */}
      {client && (
        <div className="bg-white rounded-lg border p-4 space-y-2">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <User className="h-4 w-4 text-gray-500" />
            {client.display_name}
          </h3>
          {client.address && (
            <p className="text-sm text-gray-600 flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-gray-400" />
              <span>
                {client.address}
                {client.postal_code && `, ${client.postal_code}`}
                {client.city && ` ${client.city}`}
              </span>
            </p>
          )}
          {client.phone && (
            <a
              href={`tel:${client.phone}`}
              className="text-sm text-blue-600 flex items-center gap-2 hover:underline"
            >
              <Phone className="h-4 w-4 text-gray-400" />
              {client.phone}
            </a>
          )}
          {client.access_instructions && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded p-2 mt-2">
              <strong>Accès :</strong> {client.access_instructions}
            </p>
          )}
        </div>
      )}

      {/* Infos équipement */}
      {equipment && (
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-base flex items-center gap-2 mb-1">
            <Wrench className="h-4 w-4 text-gray-500" />
            Équipement
          </h3>
          <p className="text-sm text-gray-700">
            {equipment.brand} {equipment.model}
            {equipment.serial_number && (
              <span className="text-gray-500"> — N° {equipment.serial_number}</span>
            )}
          </p>
        </div>
      )}

      {/* Date & heure planifiées */}
      <div className="flex items-center gap-4 text-sm text-gray-600 flex-wrap">
        <span className="flex items-center gap-1">
          <Calendar className="h-4 w-4 text-gray-400" />
          {dateStr}
        </span>
        {timeStr && (
          <span className="flex items-center gap-1">
            <Clock className="h-4 w-4 text-gray-400" />
            {timeStr}
          </span>
        )}
        {intervention.technician_name && (
          <span className="flex items-center gap-1">
            <User className="h-4 w-4 text-gray-400" />
            {intervention.technician_name}
          </span>
        )}
      </div>
    </div>
  );
}

export default InterventionHeader;
