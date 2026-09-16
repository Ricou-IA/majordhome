/**
 * useAuditResolvers — ids → noms pour la mise en forme du mouchard.
 * ============================================================================
 * Le journal d'audit stocke des ids (statut, commercial, source, type
 * d'équipement) et des codes (type / statut de RDV). Ce hook compose, à partir
 * des référentiels déjà chargés par l'app, les `resolvers` attendus par
 * `buildAuditEntry` (src/lib/auditTrail.js) : `{ [champ]: Map<id, libellé> }`.
 * Une seule composition, partagée par la fiche lead et la modale RDV.
 * ============================================================================
 */

import { useMemo } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { useLeadStatuses, useLeadSources, useLeadCommercials } from '@hooks/useLeads';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { APPOINTMENT_TYPES, APPOINTMENT_STATUSES, PRIORITIES } from '@services/appointments.service';
import { toNameMap } from '@/lib/auditTrail';

export function useAuditResolvers() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { statuses } = useLeadStatuses();
  const { sources } = useLeadSources();
  const { commercials } = useLeadCommercials(orgId);
  const { equipmentTypes } = useEquipmentReferential();

  return useMemo(() => {
    const commercialsMap = toNameMap(commercials);
    return {
      status_id: toNameMap(statuses),
      source_id: toNameMap(sources),
      assigned_user_id: commercialsMap,
      assigned_commercial_id: commercialsMap,
      equipment_type_id: toNameMap(equipmentTypes),
      appointment_type: toNameMap(APPOINTMENT_TYPES, 'value'),
      status: toNameMap(APPOINTMENT_STATUSES, 'value'),
      priority: toNameMap(PRIORITIES, 'value'),
    };
  }, [statuses, sources, commercials, equipmentTypes]);
}

export default useAuditResolvers;
