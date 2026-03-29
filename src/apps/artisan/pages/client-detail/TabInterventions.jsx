import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Wrench, HardHat, Package, CalendarDays } from 'lucide-react';
import { CertificatLink } from '@/apps/artisan/components/certificat/CertificatLink';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectInterventions, useCreateIntervention } from '@hooks/useInterventions';
import { INTERVENTION_TYPES } from '@services/interventions.service';
import { getStatusConfig } from '@services/sav.service';
import { chantiersService, getChantierStatusConfig } from '@services/chantiers.service';
import { formatDateFR } from '@/lib/utils';
import { FormField, TextInput, SelectInput, TextArea } from '@/apps/artisan/components/FormFields';

const InterventionCard = ({ intervention }) => {
  const typeConfig = INTERVENTION_TYPES.find(t => t.value === intervention.intervention_type) || INTERVENTION_TYPES[INTERVENTION_TYPES.length - 1];

  const statusConfig = {
    completed: { label: 'Terminé', className: 'bg-green-100 text-green-700' },
    scheduled: { label: 'Planifié', className: 'bg-blue-100 text-blue-700' },
    cancelled: { label: 'Annulé', className: 'bg-secondary-100 text-secondary-700' },
    in_progress: { label: 'En cours', className: 'bg-amber-100 text-amber-700' },
    on_hold: { label: 'En attente', className: 'bg-orange-100 text-orange-700' },
    no_show: { label: 'Absent', className: 'bg-red-100 text-red-700' },
  };

  const statusInfo = statusConfig[intervention.status] || statusConfig.scheduled;

  // Déterminer si cette intervention donne accès au certificat
  const hasEntretien = intervention.intervention_type === 'entretien'
    || (intervention.intervention_type === 'sav' && intervention.includes_entretien);
  const showCertificat = hasEntretien
    && ['planifie', 'realise'].includes(intervention.workflow_status);
  const isRealise = intervention.workflow_status === 'realise';

  return (
    <div className="p-4 bg-white rounded-lg border border-secondary-200 hover:border-secondary-300 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full ${typeConfig.bgClass}`}>{typeConfig.label}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo.className}`}>{statusInfo.label}</span>
            {/* Badge workflow pour interventions entretien/sav */}
            {(intervention.intervention_type === 'entretien' || intervention.intervention_type === 'sav') &&
              intervention.workflow_status && (() => {
                const wfConfig = getStatusConfig(intervention.intervention_type, intervention.workflow_status);
                return wfConfig ? (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                    style={{ backgroundColor: wfConfig.color }}
                  >
                    {wfConfig.label}
                  </span>
                ) : null;
              })()}
          </div>
          <p className="text-sm text-secondary-500 mt-1">
            {formatDateFR(intervention.scheduled_date)}
            {intervention.technician_name && ` • ${intervention.technician_name}`}
          </p>
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
      {intervention.report_notes && <p className="text-sm text-secondary-500 mt-1 line-clamp-2 italic">{intervention.report_notes}</p>}
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
          {interventions.length > 0
            ? `${interventions.length} intervention${interventions.length !== 1 ? 's' : ''}`
            : ''}
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
          {interventions.map((i) => (
            <InterventionCard key={i.id} intervention={i} />
          ))}
        </div>
      )}
    </div>
  );
};
