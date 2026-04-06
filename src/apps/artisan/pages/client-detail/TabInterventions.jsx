import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Wrench, HardHat, Package, CalendarDays, Ban } from 'lucide-react';
import { CertificatLink } from '@/apps/artisan/components/certificat/CertificatLink';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectInterventions, useCreateIntervention } from '@hooks/useInterventions';
import { INTERVENTION_TYPES } from '@services/interventions.service';
import { getStatusConfig } from '@services/sav.service';
import { chantiersService, getChantierStatusConfig } from '@services/chantiers.service';
import { formatDateFR } from '@/lib/utils';
import { EQUIPMENT_CATEGORY_LABELS } from '@/apps/artisan/components/certificat/constants';
import { FormField, TextInput, SelectInput, TextArea } from '@/apps/artisan/components/FormFields';

const InterventionCard = ({ intervention, hasChildren = false }) => {
  const typeConfig = INTERVENTION_TYPES.find(t => t.value === intervention.intervention_type) || INTERVENTION_TYPES[INTERVENTION_TYPES.length - 1];
  const isChild = !!intervention.parent_id;
  const isNeant = isChild && intervention.status === 'cancelled' && intervention.workflow_status === 'realise';
  const isParentWithChildren = !isChild && hasChildren;

  const statusConfig = {
    completed: { label: 'Terminé', className: 'bg-green-100 text-green-700' },
    scheduled: { label: 'Planifié', className: 'bg-blue-100 text-blue-700' },
    cancelled: { label: 'Annulé', className: 'bg-secondary-100 text-secondary-700' },
    in_progress: { label: 'En cours', className: 'bg-amber-100 text-amber-700' },
    on_hold: { label: 'En attente', className: 'bg-orange-100 text-orange-700' },
    no_show: { label: 'Absent', className: 'bg-red-100 text-red-700' },
  };

  const statusInfo = isNeant
    ? { label: 'Néant', className: 'bg-gray-100 text-gray-500' }
    : (statusConfig[intervention.status] || statusConfig.scheduled);

  // Le certificat s'affiche uniquement sur les enfants (pas le parent qui a des enfants)
  const hasEntretien = intervention.intervention_type === 'entretien'
    || (intervention.intervention_type === 'sav' && intervention.includes_entretien);
  const showCertificat = isChild && hasEntretien && !isNeant
    && ['planifie', 'realise'].includes(intervention.workflow_status);
  const isRealise = intervention.workflow_status === 'realise';

  // Equipment label for child interventions
  const equipmentLabel = isChild && intervention.equipment_category
    ? (EQUIPMENT_CATEGORY_LABELS[intervention.equipment_category] || intervention.equipment_category)
    : null;
  const equipmentDetail = isChild
    ? [intervention.equipment_brand, intervention.equipment_model].filter(Boolean).join(' ')
    : null;

  // Parent avec enfants : affichage compact (les détails sont dans les enfants)
  if (isParentWithChildren) {
    const wfConfig = getStatusConfig(intervention.intervention_type, intervention.workflow_status);
    return (
      <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full ${typeConfig.bgClass}`}>{typeConfig.label}</span>
            {wfConfig && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: wfConfig.color }}>
                {wfConfig.label}
              </span>
            )}
            <span className="text-xs text-gray-500">{formatDateFR(intervention.scheduled_date || intervention.created_at)}</span>
          </div>
          {intervention.report_notes && (
            <span className="text-xs text-gray-400 italic truncate max-w-[200px]">{intervention.report_notes}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 bg-white rounded-lg border transition-colors ${
      isChild
        ? 'ml-6 border-l-2 border-l-blue-300 border-gray-200 hover:border-gray-300'
        : 'border-secondary-200 hover:border-secondary-300'
    } ${isNeant ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            {isChild ? (
              <>
                {equipmentLabel && (
                  <span className="text-sm font-medium text-gray-900">{equipmentLabel}</span>
                )}
                {equipmentDetail && (
                  <span className="text-xs text-gray-500">{equipmentDetail}</span>
                )}
              </>
            ) : (
              <span className={`text-xs px-2 py-0.5 rounded-full ${typeConfig.bgClass}`}>{typeConfig.label}</span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo.className}`}>{statusInfo.label}</span>
            {isNeant && <Ban className="w-3 h-3 text-gray-400" />}
            {/* Badge workflow pour interventions sans enfants */}
            {!isChild && !hasChildren && (intervention.intervention_type === 'entretien' || intervention.intervention_type === 'sav') &&
              intervention.workflow_status && (() => {
                const wfConfig = getStatusConfig(intervention.intervention_type, intervention.workflow_status);
                return wfConfig ? (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: wfConfig.color }}>
                    {wfConfig.label}
                  </span>
                ) : null;
              })()}
          </div>
          {!isChild && (
            <p className="text-sm text-secondary-500 mt-1">
              {formatDateFR(intervention.scheduled_date)}
              {intervention.technician_name && ` • ${intervention.technician_name}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {intervention.duration_minutes && <span className="text-xs text-secondary-500">{intervention.duration_minutes} min</span>}
          {showCertificat && (
            <CertificatLink
              interventionId={intervention.id}
              isRealise={isRealise}
              label={isRealise ? 'Certificat' : 'Remplir'}
            />
          )}
        </div>
      </div>
      {intervention.work_performed && <p className="text-sm text-secondary-600 mt-2 line-clamp-2">{intervention.work_performed}</p>}
      {intervention.report_notes && !isParentWithChildren && <p className="text-sm text-secondary-500 mt-1 line-clamp-2 italic">{intervention.report_notes}</p>}
    </div>
  );
};

/**
 * Section chantier (lecture seule) - affiché si le client a un lead avec chantier_status
 */
const ChantierSummary = ({ clientId }) => {
  const [chantier, setChantier] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    const load = async () => {
      try {
        const { data } = await chantiersService.getChantierByClientId(clientId);
        setChantier(data);
      } catch (err) {
        console.error('[ChantierSummary] load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [clientId]);

  if (loading) return null;
  if (!chantier) return null;

  const statusConfig = getChantierStatusConfig(chantier.chantier_status);
  const orderLabels = { na: 'N/A', commande: 'Commandé', recu: 'Reçu' };

  return (
    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
      <div className="flex items-center gap-2">
        <HardHat className="w-4 h-4 text-amber-600" />
        <h4 className="text-sm font-semibold text-amber-900">Chantier en cours</h4>
        <span
          className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium text-white"
          style={{ backgroundColor: statusConfig.color }}
        >
          {statusConfig.label}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {chantier.won_date && (
          <p className="text-secondary-600">
            <span className="text-secondary-400">Gagné le :</span> {formatDateFR(chantier.won_date)}
          </p>
        )}
        {chantier.estimated_date && (
          <p className="text-secondary-600">
            <span className="text-secondary-400">Date estimée :</span> {formatDateFR(chantier.estimated_date)}
          </p>
        )}
        {chantier.equipment_order_status && (
          <p className="text-secondary-600">
            <span className="text-secondary-400">Équipement :</span> {orderLabels[chantier.equipment_order_status] || '—'}
          </p>
        )}
        {chantier.materials_order_status && (
          <p className="text-secondary-600">
            <span className="text-secondary-400">Matériaux :</span> {orderLabels[chantier.materials_order_status] || '—'}
          </p>
        )}
      </div>
      {chantier.chantier_notes && (
        <p className="text-xs text-secondary-500 italic">{chantier.chantier_notes}</p>
      )}
    </div>
  );
};

export const TabInterventions = ({ projectId, clientId }) => {
  const { user } = useAuth();
  const { interventions, isLoading } = useProjectInterventions(projectId);
  const { createIntervention, isCreating } = useCreateIntervention();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    interventionType: 'maintenance',
    scheduledDate: new Date().toISOString().split('T')[0],
    reportNotes: '',
  });

  const handleCreate = async () => {
    if (!formData.scheduledDate) {
      toast.error('La date est requise');
      return;
    }
    try {
      const result = await createIntervention({
        projectId,
        interventionType: formData.interventionType,
        scheduledDate: formData.scheduledDate,
        reportNotes: formData.reportNotes || null,
        createdBy: user?.id || null,
      });
      if (result?.error) {
        console.error('[TabInterventions] create error:', result.error);
        toast.error(result.error.message || "Erreur lors de la création");
        return;
      }
      toast.success('Intervention créée');
      setShowForm(false);
      setFormData({ interventionType: 'maintenance', scheduledDate: new Date().toISOString().split('T')[0], reportNotes: '' });
    } catch (err) {
      console.error('[TabInterventions] create exception:', err);
      toast.error("Erreur lors de la création");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section chantier (lecture seule) */}
      <ChantierSummary clientId={clientId} />

      <div className="flex items-center justify-between">
        <p className="text-sm text-secondary-500">
          {(() => {
            const parentCount = interventions.filter((i) => !i.parent_id).length;
            return parentCount > 0
              ? `${parentCount} intervention${parentCount !== 1 ? 's' : ''}`
              : '';
          })()}
        </p>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-700 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nouvelle intervention
          </button>
        )}
      </div>

      {showForm && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
          <h4 className="text-sm font-semibold text-secondary-900 flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary-600" />
            Nouvelle intervention
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="Type" required>
              <SelectInput
                value={formData.interventionType}
                onChange={(v) => setFormData(prev => ({ ...prev, interventionType: v || 'maintenance' }))}
                options={INTERVENTION_TYPES.map(t => ({ value: t.value, label: t.label }))}
              />
            </FormField>
            <FormField label="Date" required>
              <TextInput
                type="date"
                value={formData.scheduledDate}
                onChange={(v) => setFormData(prev => ({ ...prev, scheduledDate: v }))}
              />
            </FormField>
          </div>
          <FormField label="Motif / Notes">
            <TextArea
              value={formData.reportNotes}
              onChange={(v) => setFormData(prev => ({ ...prev, reportNotes: v }))}
              placeholder="Motif de l'intervention..."
              rows={2}
            />
          </FormField>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Créer
            </button>
            <button
              onClick={() => setShowForm(false)}
              disabled={isCreating}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-secondary-700 bg-white border border-secondary-300 rounded-lg hover:bg-secondary-50 transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {interventions.length === 0 && !showForm ? (
        <div className="text-center py-12">
          <Wrench className="w-12 h-12 text-secondary-300 mx-auto" />
          <p className="mt-4 text-secondary-700 font-medium">Aucune intervention</p>
          <p className="mt-1 text-sm text-secondary-500">Cliquez sur "Nouvelle intervention" pour en créer une.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Trier : parents d'abord, enfants juste après leur parent */}
          {(() => {
            const parents = interventions.filter((i) => !i.parent_id);
            const childrenByParent = {};
            for (const i of interventions) {
              if (i.parent_id) {
                if (!childrenByParent[i.parent_id]) childrenByParent[i.parent_id] = [];
                childrenByParent[i.parent_id].push(i);
              }
            }
            const sorted = [];
            for (const p of parents) {
              sorted.push({ ...p, _hasChildren: !!childrenByParent[p.id]?.length });
              if (childrenByParent[p.id]) {
                sorted.push(...childrenByParent[p.id]);
              }
            }
            // Ajouter les orphelins (enfants dont le parent n'est pas dans la liste)
            for (const i of interventions) {
              if (i.parent_id && !parents.find((p) => p.id === i.parent_id)) {
                sorted.push(i);
              }
            }
            return sorted.map((i) => (
              <InterventionCard key={i.id} intervention={i} hasChildren={i._hasChildren} />
            ));
          })()}
        </div>
      )}
    </div>
  );
};
