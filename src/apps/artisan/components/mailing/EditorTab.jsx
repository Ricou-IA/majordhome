import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Edit, Copy, Archive, ArchiveRestore, Trash2, ChevronDown, ChevronRight, Loader2, Mail, Users, Clock, Play, Check, Zap, Target, Send, RefreshCw } from 'lucide-react';
import { Button } from '@components/ui/button';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useAuth } from '@contexts/AuthContext';
import { useMailCampaigns, useNombreEnvois } from '@hooks/useMailCampaigns';
import { useMailSegments } from '@hooks/useMailSegments';
import { formatRelativeFR } from '@/lib/utils';
import { cleDeCopie, cleEnvoi, libelleDeCopie, peutOuvrirMail } from '@/lib/mailPage';
import { enCours } from '@/lib/envoiEnCours';
import {
  gestesDeCampagne, texteArchivage, texteSuppression, champsDeRestauration, messageRestauration, separerArchivees,
} from '@/lib/mailCampagnesListe';

// --- Natures de campagne -----------------------------------------------------
// Une campagne tombe dans exactement un groupe, selon son mode d'envoi :
//   automated     → part seule à cadence régulière (planificateur)  [is_automated]
//   transactional → part sur un événement (signature, devis…)        [is_transactional]
//   manual        → broadcast lancé à la main depuis la page du mail [ni l'un ni l'autre]
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
  { key: 'manual', title: 'Manuelles', subtitle: 'À lancer à la main, depuis la page du mail', icon: Send, accent: 'slate' },
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
 * Onglet Campagnes — vue d'ensemble des campagnes regroupées par mode d'envoi.
 * « Éditer » et « Nouvelle campagne » ouvrent la page du mail (`?mail=<id>` / `?mail=nouveau`, `PageMail`).
 * Un autre rôle que l'administrateur ne voit que les campagnes manuelles, qu'il « Ouvre » pour les envoyer
 * (ce que lui donnait l'ancien onglet Envoi) : ni création, ni copie, ni archivage, ni suppression.
 * Archiver, restaurer, supprimer : ce qui est permis et ce que dit chaque confirmation vient de
 * `src/lib/mailCampagnesListe.js` (administrateur seul ; les e-mails de la boutique sont protégés).
 */
export default function EditorTab() {
  const { organization, isOrgAdmin } = useAuth();
  const orgId = organization?.id;
  // Archivés compris pour les clés et noms déjà pris (contrainte unique et journal des envois).
  const {
    campaigns: tous, isLoading, duplicateCampaign, archiveCampaign, restoreCampaign, deleteCampaign, isMutating,
  } = useMailCampaigns(orgId, { includeArchived: true });
  const { actives, archivees } = separerArchivees(tous);
  const campaigns = actives.filter((c) => peutOuvrirMail({ campagne: c, nouveau: false, isOrgAdmin }));
  const { segments } = useMailSegments(orgId);
  const [searchParams, setSearchParams] = useSearchParams();
  // Geste en attente de confirmation : { geste: 'archiver' | 'supprimer', campagne }.
  const [demande, setDemande] = useState(null);
  const [voirArchivees, setVoirArchivees] = useState(false);
  // Envois déjà faits sous ce nom : dits dans la confirmation de suppression (inconnu = on ne chiffre pas).
  const { nombre: nbEnvois } = useNombreEnvois(orgId, demande?.campagne?.label, { enabled: demande?.geste === 'supprimer' });

  // Ouverture directe depuis Réglages → E-mails & SMS (« Modifier le texte ») : /mailing?tab=editor&edit=<clé>.
  const editKey = searchParams.get('edit');
  useEffect(() => {
    if (!editKey || isLoading) return;
    const cible = campaigns.find((c) => c.key === editKey);
    if (cible) {
      setSearchParams({ mail: cible.id }, { replace: true });
      return;
    }
    toast.info('Ce mail n’existe pas encore pour votre entreprise.');
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    setSearchParams(next, { replace: true });
  }, [editKey, isLoading, campaigns, searchParams, setSearchParams]);

  const openCreate = () => setSearchParams({ mail: 'nouveau' });
  const openEdit = (campaign) => setSearchParams({ mail: campaign.id });
  const gestes = (campagne) => gestesDeCampagne({ campagne, isOrgAdmin, envoiEnCours: enCours(cleEnvoi(orgId, campagne.label)) });

  const handleDuplicate = async (campaign) => {
    try {
      await duplicateCampaign({
        campaign,
        newKey: cleDeCopie(campaign.key, tous.map((c) => c.key)),
        newLabel: libelleDeCopie(campaign.label, tous.map((c) => c.label)),
      });
    } catch {
      // toast déjà affiché
    }
  };

  /** Ouvre la confirmation, ou dit pourquoi le geste est fermé (relu au clic : un envoi a pu démarrer). */
  const demander = (geste, campagne) => {
    const verdict = gestes(campagne)[geste];
    if (!verdict.possible) {
      if (verdict.raison) toast.info(verdict.raison);
      return;
    }
    setDemande({ geste, campagne });
  };

  const confirmer = async () => {
    if (!demande) return;
    const { geste, campagne } = demande;
    if (!gestes(campagne)[geste].possible) {
      setDemande(null);
      return;
    }
    try {
      if (geste === 'archiver') await archiveCampaign(campagne.id);
      else await deleteCampaign(campagne.id);
      setDemande(null);
    } catch {
      // toast déjà affiché ; la fenêtre reste ouverte pour réessayer ou annuler
    }
  };

  const handleRestore = async (campagne) => {
    try {
      await restoreCampaign({ id: campagne.id, patch: champsDeRestauration(campagne) });
      toast.success(messageRestauration(campagne));
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

  const texte = demande && (demande.geste === 'archiver' ? texteArchivage(demande.campagne) : texteSuppression(demande.campagne, nbEnvois));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-secondary-900">Campagnes</h2>
          <p className="text-sm text-secondary-500">
            {isOrgAdmin ? 'Tout ce qui peut partir par email, regroupé par mode d’envoi.' : 'Les campagnes que vous pouvez envoyer.'}
          </p>
        </div>
        {isOrgAdmin && (
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Nouvelle campagne
          </Button>
        )}
      </div>

      {campaigns.length === 0 ? (
        <div className="card p-8 text-center text-secondary-500">
          <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Aucune campagne pour l&apos;instant.</p>
          {isOrgAdmin && (
            <Button onClick={openCreate} className="mt-4">
              <Plus className="w-4 h-4 mr-2" />
              Créer la première
            </Button>
          )}
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
            onDemander={demander}
            gestes={gestes}
            disabled={isMutating}
            gerer={isOrgAdmin}
          />
        ))
      )}

      {isOrgAdmin && archivees.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setVoirArchivees((v) => !v)}
            aria-expanded={voirArchivees}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-secondary-600 hover:text-secondary-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
          >
            {voirArchivees ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
            Campagnes archivées ({archivees.length})
          </button>
          {voirArchivees && (
            <ul className="mt-3 card divide-y divide-secondary-100 p-0">
              {archivees.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-secondary-800 truncate">{c.label}</p>
                    <p className="text-xs text-secondary-500 truncate">{c.subject || 'Objet à définir'}</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => handleRestore(c)} disabled={isMutating}>
                    <ArchiveRestore className="w-3.5 h-3.5 mr-1" />
                    Restaurer
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => demander('supprimer', c)} disabled={isMutating} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Supprimer
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ConfirmDialog
        open={!!demande}
        onOpenChange={(ouvert) => { if (!ouvert) setDemande(null); }}
        title={texte?.titre}
        description={texte?.message}
        confirmLabel={texte?.confirmer}
        variant={demande?.geste === 'supprimer' ? 'destructive' : 'default'}
        onConfirm={confirmer}
        loading={isMutating}
      />
    </div>
  );
}

function CampaignGroup({ group, campaigns, segmentById, onEdit, onDuplicate, onDemander, gestes, disabled, gerer }) {
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
            onArchive={() => onDemander('archiver', c)}
            onDelete={() => onDemander('supprimer', c)}
            gestes={gestes(c)}
            disabled={disabled}
            gerer={gerer}
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
          {segment?.name || <span className="italic text-secondary-400">Groupe de destinataires manquant</span>}
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
        : <span className="text-secondary-500">Cible choisie au moment de l&apos;envoi</span>}
    </MetaRow>
  );
}

function CampaignCard({ campaign, nature, accent, segment, onEdit, onDuplicate, onArchive, onDelete, gestes, disabled, gerer }) {
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

      <div className="flex flex-wrap gap-2 mt-auto pt-3 border-t border-secondary-100">
        <Button variant="secondary" size="sm" onClick={onEdit} disabled={disabled}>
          <Edit className="w-3.5 h-3.5 mr-1" />
          {gerer ? 'Éditer' : 'Ouvrir'}
        </Button>
        {gerer && (
          <Button variant="ghost" size="sm" onClick={onDuplicate} disabled={disabled}>
            <Copy className="w-3.5 h-3.5 mr-1" />
            Dupliquer
          </Button>
        )}
        {gestes.archiver.affiche && (
          <Button variant="ghost" size="sm" onClick={onArchive} disabled={disabled} className="ml-auto">
            <Archive className="w-3.5 h-3.5 mr-1" />
            Archiver
          </Button>
        )}
        {gestes.supprimer.affiche && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={disabled}
            className={`text-red-600 hover:text-red-700 hover:bg-red-50 ${gestes.archiver.affiche ? '' : 'ml-auto'}`}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            Supprimer
          </Button>
        )}
      </div>
    </div>
  );
}
