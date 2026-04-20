import { useState } from 'react';
import { Plus, Edit, Copy, Archive, Loader2, Mail, Info, Zap, Filter } from 'lucide-react';
import { Button } from '@components/ui/button';
import { useAuth } from '@contexts/AuthContext';
import { useMailCampaigns } from '@hooks/useMailCampaigns';
import { useMailSegments } from '@hooks/useMailSegments';
import CampaignWizard from './CampaignWizard';

/**
 * Onglet Éditeur — liste des campagnes + création/édition via wizard.
 * Accessible en org_admin (gate appliqué au niveau page Mailing).
 */
export default function EditorTab() {
  const { organization } = useAuth();
  const { campaigns, isLoading, createCampaign, updateCampaign, duplicateCampaign, archiveCampaign, isMutating } = useMailCampaigns(organization?.id);
  const { segments } = useMailSegments(organization?.id);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const openCreate = () => { setEditing(null); setWizardOpen(true); };
  const openEdit = (campaign) => { setEditing(campaign); setWizardOpen(true); };
  const closeWizard = () => { setWizardOpen(false); setEditing(null); };

  const handleSave = async (payload) => {
    try {
      if (editing) {
        await updateCampaign({ id: editing.id, patch: payload });
      } else {
        await createCampaign(payload);
      }
      closeWizard();
    } catch {
      // toast déjà affiché par le hook
    }
  };

  const handleDuplicate = async (campaign) => {
    const newKey = window.prompt(`Clé de la copie ?`, `${campaign.key}_copy`);
    if (!newKey) return;
    try {
      await duplicateCampaign({ campaign, newKey: newKey.trim() });
    } catch {
      // toast déjà affiché
    }
  };

  const segmentById = Object.fromEntries((segments || []).map((s) => [s.id, s]));

  const handleArchive = async (campaign) => {
    if (!window.confirm(`Archiver "${campaign.label}" ? Elle disparaîtra du sélecteur d'envoi.`)) return;
    try {
      await archiveCampaign(campaign.id);
    } catch {
      // toast déjà affiché
    }
  };

  if (isLoading) {
    return (
      <div className="card p-8 flex items-center justify-center text-secondary-500">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Chargement…
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">Campagnes enregistrées</h2>
            <p className="text-sm text-secondary-500">
              {campaigns.length} campagne{campaigns.length > 1 ? 's' : ''} · modèle Mail I en base
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Nouvelle campagne
          </Button>
        </div>

        {campaigns.length === 0 ? (
          <div className="card p-8 text-center text-secondary-500">
            <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Aucune campagne pour l'instant.</p>
            <Button onClick={openCreate} className="mt-4">
              <Plus className="w-4 h-4 mr-2" />
              Créer la première
            </Button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                segment={c.auto_segment_id ? segmentById[c.auto_segment_id] : null}
                onEdit={() => openEdit(c)}
                onDuplicate={() => handleDuplicate(c)}
                onArchive={() => handleArchive(c)}
                disabled={isMutating}
              />
            ))}
          </div>
        )}
      </div>

      {wizardOpen && (
        <CampaignWizard
          initial={editing}
          onClose={closeWizard}
          onSave={handleSave}
          isSaving={isMutating}
        />
      )}
    </>
  );
}

function CampaignCard({ campaign, segment, onEdit, onDuplicate, onArchive, disabled }) {
  const cadenceLabel = campaign.auto_cadence_minutes
    ? `toutes les ${campaign.auto_cadence_minutes} min`
    : campaign.auto_cadence_days
      ? `tous les ${campaign.auto_cadence_days} j · ${(campaign.auto_time_of_day || '09:00').slice(0, 5)}`
      : null;
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-secondary-900 truncate">{campaign.label}</h3>
          <p className="text-xs text-secondary-500 font-mono">{campaign.key}</p>
        </div>
      </div>

      <p className="text-sm text-secondary-700 line-clamp-2">
        <span className="text-xs text-secondary-500 block">Objet</span>
        {campaign.subject || <span className="italic text-secondary-400">Pas d'objet</span>}
      </p>

      {campaign.purpose && (
        <p className="text-xs text-secondary-600 line-clamp-2 flex gap-1">
          <Info className="w-3 h-3 flex-shrink-0 mt-0.5 text-primary-500" />
          {campaign.purpose}
        </p>
      )}

      <div className="flex flex-wrap gap-1 mt-1">
        {segment ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary-100 text-primary-700">
            <Filter className="w-3 h-3 mr-1" />
            {segment.name}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-secondary-500 italic">
            pas de segment
          </span>
        )}
        {campaign.is_automated && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800 font-medium">
            <Zap className="w-3 h-3 mr-1" />
            Auto {cadenceLabel ? `· ${cadenceLabel}` : ''}
          </span>
        )}
        {campaign.tracking_type_value && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 font-mono">
            {campaign.tracking_type_value}
          </span>
        )}
      </div>

      <div className="flex gap-2 mt-2 pt-2 border-t">
        <Button variant="secondary" size="sm" onClick={onEdit} disabled={disabled}>
          <Edit className="w-3.5 h-3.5 mr-1" />
          Éditer
        </Button>
        <Button variant="ghost" size="sm" onClick={onDuplicate} disabled={disabled}>
          <Copy className="w-3.5 h-3.5 mr-1" />
          Dupliquer
        </Button>
        <Button variant="ghost" size="sm" onClick={onArchive} disabled={disabled} className="ml-auto text-red-600 hover:text-red-700 hover:bg-red-50">
          <Archive className="w-3.5 h-3.5 mr-1" />
          Archiver
        </Button>
      </div>
    </div>
  );
}
