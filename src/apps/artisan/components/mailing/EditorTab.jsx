import { useState } from 'react';
import { Plus, Edit, Copy, Archive, Loader2, Mail, Users, Clock, Play, Check, Zap, Target, Send, RefreshCw } from 'lucide-react';
import { Button } from '@components/ui/button';
import { useAuth } from '@contexts/AuthContext';
import { useMailCampaigns } from '@hooks/useMailCampaigns';
import { useMailSegments } from '@hooks/useMailSegments';
import { formatRelativeFR } from '@/lib/utils';
import CampaignWizard from './CampaignWizard';

// --- Natures de campagne -----------------------------------------------------
// Une campagne tombe dans exactement un groupe, selon son mode d'envoi :
//   automated     → part seule à cadence régulière (scheduler N8n)  [is_automated]
//   transactional → part sur un événement (signature, devis…)        [is_transactional]
//   manual        → broadcast lancé à la main depuis l'onglet Envoi  [ni l'un ni l'autre]
function classifyNature(c) {
  if (c.is_transactional) return 'transactional';
  if (c.is_automated) return 'automated';
  return 'manual';
}

// Ordre d'affichage des groupes + habillage. Le titre de section porte la nature,
// donc les cartes n'ont plus besoin de badge "type".
const GROUPS = [
  { key: 'automated', title: 'Automatiques', subtitle: 'Partent toutes seules, selon une cadence', icon: RefreshCw, accent: 'amber' },
  { key: 'transactional', title: 'Transactionnelles', subtitle: 'Partent sur un événement précis', icon: Zap, accent: 'blue' },
  { key: 'manual', title: 'Manuelles', subtitle: "À lancer depuis l'onglet Envoi", icon: Send, accent: 'slate' },
];

// Classes Tailwind statiques (les classes construites dynamiquement sont purgées).
const ACCENT = {
  amber: { bar: 'border-l-amber-400', chip: 'bg-amber-100 text-amber-700' },
  blue: { bar: 'border-l-blue-400', chip: 'bg-blue-100 text-blue-700' },
  slate: { bar: 'border-l-slate-300', chip: 'bg-slate-100 text-slate-600' },
};

function formatCadence(c) {
  if (c.auto_cadence_minutes) return `toutes les ${Number(c.auto_cadence_minutes)} min`;
  if (c.auto_cadence_days) {
    const d = Number(c.auto_cadence_days);
    const time = (c.auto_time_of_day || '09:00').slice(0, 5);
    if (d === 1) return `tous les jours à ${time}`;
    if (d === 7) return `toutes les semaines à ${time}`;
    return `tous les ${d} jours à ${time}`;
  }
  return null;
}

/**
 * Onglet Éditeur — vue d'ensemble des campagnes regroupées par mode d'envoi.
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

  const handleArchive = async (campaign) => {
    if (campaign.is_transactional) {
      window.alert(
        `"${campaign.label}" est une campagne transactionnelle utilisée par le code (ex: envoi de proposition de contrat depuis la fiche client). L'archiver casserait l'envoi. Édite-la plutôt si tu veux modifier le contenu.`
      );
      return;
    }
    if (!window.confirm(`Archiver "${campaign.label}" ? Elle disparaîtra du sélecteur d'envoi.`)) return;
    try {
      await archiveCampaign(campaign.id);
    } catch {
      // toast déjà affiché
    }
  };

  const segmentById = Object.fromEntries((segments || []).map((s) => [s.id, s]));

  // Répartition en groupes + tri interne pensé pour la lecture (pas par clé technique).
  const grouped = { automated: [], transactional: [], manual: [] };
  for (const c of campaigns) grouped[classifyNature(c)].push(c);
  grouped.automated.sort((a, b) => (a.next_run_at || '9999').localeCompare(b.next_run_at || '9999'));
  grouped.transactional.sort((a, b) => (a.label || '').localeCompare(b.label || '', 'fr'));
  grouped.manual.sort((a, b) => (a.label || '').localeCompare(b.label || '', 'fr'));

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
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">Campagnes</h2>
            <p className="text-sm text-secondary-500">Tout ce qui peut partir par email, regroupé par mode d'envoi.</p>
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
          GROUPS.map((group) => (
            <CampaignGroup
              key={group.key}
              group={group}
              campaigns={grouped[group.key]}
              segmentById={segmentById}
              onEdit={openEdit}
              onDuplicate={handleDuplicate}
              onArchive={handleArchive}
              disabled={isMutating}
            />
          ))
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

function CampaignGroup({ group, campaigns, segmentById, onEdit, onDuplicate, onArchive, disabled }) {
  if (!campaigns.length) return null;
  const { icon: Icon, accent, title, subtitle } = group;
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 ${ACCENT[accent].chip}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <h3 className="text-sm font-semibold text-secondary-800 uppercase tracking-wide">{title}</h3>
        <span className="text-xs text-secondary-400">· {campaigns.length}</span>
        <span className="hidden sm:inline text-xs text-secondary-400 ml-1">{subtitle}</span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {campaigns.map((c) => (
          <CampaignCard
            key={c.id}
            campaign={c}
            nature={group.key}
            accent={accent}
            segment={c.auto_segment_id ? segmentById[c.auto_segment_id] : null}
            onEdit={() => onEdit(c)}
            onDuplicate={() => onDuplicate(c)}
            onArchive={() => onArchive(c)}
            disabled={disabled}
          />
        ))}
      </div>
    </section>
  );
}

function MetaRow({ icon: Icon, iconClass = 'text-secondary-400', textClass = 'text-secondary-600', clamp = false, children }) {
  return (
    <div className={`flex items-start gap-1.5 ${textClass}`}>
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${iconClass}`} />
      <span className={clamp ? 'line-clamp-2' : 'truncate'}>{children}</span>
    </div>
  );
}

function CampaignMeta({ campaign, nature, segment }) {
  if (nature === 'automated') {
    const cadence = formatCadence(campaign);
    const next = formatRelativeFR(campaign.next_run_at);
    const last = formatRelativeFR(campaign.last_run_at);
    return (
      <>
        <MetaRow icon={Users}>
          {segment?.name || <span className="italic text-secondary-400">Segment manquant</span>}
        </MetaRow>
        <MetaRow icon={Clock}>
          {cadence || <span className="italic text-secondary-400">Cadence non définie</span>}
        </MetaRow>
        <MetaRow icon={Play} iconClass="text-amber-500" textClass="text-secondary-700">
          Prochain&nbsp;: <span className="font-medium">{next || '—'}</span>
        </MetaRow>
        <MetaRow icon={Check} iconClass="text-secondary-300" textClass="text-secondary-500">
          Dernier&nbsp;: {last || 'jamais encore'}
        </MetaRow>
      </>
    );
  }

  if (nature === 'transactional') {
    const trigger = campaign.trigger_description || campaign.purpose || "Déclenché automatiquement par l'application";
    return (
      <MetaRow icon={Zap} iconClass="text-blue-500" clamp>
        {trigger}
      </MetaRow>
    );
  }

  // manual
  return (
    <MetaRow icon={Target}>
      {segment?.name
        ? <>Cible par défaut&nbsp;: {segment.name}</>
        : <span className="text-secondary-500">Cible choisie au moment de l'envoi</span>}
    </MetaRow>
  );
}

function CampaignCard({ campaign, nature, accent, segment, onEdit, onDuplicate, onArchive, disabled }) {
  const canArchive = nature !== 'transactional';
  return (
    <div className={`card border-l-4 ${ACCENT[accent].bar} p-4 flex flex-col gap-3`}>
      <div className="min-w-0">
        <h3 className="font-semibold text-secondary-900 truncate" title={campaign.key}>
          {campaign.label}
        </h3>
        <p className="text-sm text-secondary-600 truncate mt-0.5">
          {campaign.subject || <span className="italic text-secondary-400">Objet à définir</span>}
        </p>
      </div>

      <div className="flex flex-col gap-1 text-xs">
        <CampaignMeta campaign={campaign} nature={nature} segment={segment} />
      </div>

      <div className="flex gap-2 mt-auto pt-3 border-t border-secondary-100">
        <Button variant="secondary" size="sm" onClick={onEdit} disabled={disabled}>
          <Edit className="w-3.5 h-3.5 mr-1" />
          Éditer
        </Button>
        <Button variant="ghost" size="sm" onClick={onDuplicate} disabled={disabled}>
          <Copy className="w-3.5 h-3.5 mr-1" />
          Dupliquer
        </Button>
        {canArchive && (
          <Button variant="ghost" size="sm" onClick={onArchive} disabled={disabled} className="ml-auto text-red-600 hover:text-red-700 hover:bg-red-50">
            <Archive className="w-3.5 h-3.5 mr-1" />
            Archiver
          </Button>
        )}
      </div>
    </div>
  );
}
