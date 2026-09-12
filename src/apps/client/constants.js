/**
 * Constantes partagées du portail client
 * ============================================================================
 * Labels, statuts et configurations réutilisés par les pages client.
 * ============================================================================
 */

import { CheckCircle2, Clock, AlertCircle, XCircle } from 'lucide-react';

// ===========================================================================
// INTERVENTIONS
// ===========================================================================

export const INTERVENTION_STATUS_CONFIG = {
  scheduled: { label: 'Planifiée', color: 'text-blue-700 bg-blue-50', icon: Clock },
  planifie: { label: 'Planifiée', color: 'text-blue-700 bg-blue-50', icon: Clock },
  in_progress: { label: 'En cours', color: 'text-amber-700 bg-amber-50', icon: Clock },
  completed: { label: 'Terminée', color: 'text-green-700 bg-green-50', icon: CheckCircle2 },
  realise: { label: 'Terminée', color: 'text-green-700 bg-green-50', icon: CheckCircle2 },
  cancelled: { label: 'Annulée', color: 'text-red-700 bg-red-50', icon: XCircle },
  on_hold: { label: 'En attente', color: 'text-gray-500 bg-gray-100', icon: AlertCircle },
};

export const INTERVENTION_TYPE_LABELS = {
  maintenance: 'Entretien',
  entretien: 'Entretien',
  repair: 'Réparation',
  sav: 'SAV',
  installation: 'Installation',
  diagnostic: 'Diagnostic',
  ramonage: 'Ramonage',
};

// ===========================================================================
// CONTRATS
// ===========================================================================

export const CONTRACT_STATUS_CONFIG = {
  active: { label: 'Actif', color: 'text-green-700 bg-green-50', icon: CheckCircle2 },
  pending: { label: 'En attente', color: 'text-amber-700 bg-amber-50', icon: Clock },
  cancelled: { label: 'Résilié', color: 'text-red-700 bg-red-50', icon: XCircle },
  archived: { label: 'Archivé', color: 'text-gray-500 bg-gray-100', icon: XCircle },
};

export const FREQUENCY_LABELS = {
  annual: 'Annuelle',
  biannual: 'Semestrielle',
  quarterly: 'Trimestrielle',
  monthly: 'Mensuelle',
};

// ===========================================================================
// ÉQUIPEMENTS
// ===========================================================================

// Libellés d'équipement : viennent du référentiel de l'org (Settings → Tarification),
// pas d'une constante — à exposer au portail par une vue dédiée (Sprint 8).
