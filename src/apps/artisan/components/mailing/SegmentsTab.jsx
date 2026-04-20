import { useState } from 'react';
import { Plus, Edit, Copy, Archive, Loader2, Filter, Users, UserCheck, Lock } from 'lucide-react';
import { Button } from '@components/ui/button';
import { useAuth } from '@contexts/AuthContext';
import { useMailSegments, useSegmentCount } from '@hooks/useMailSegments';
import SegmentBuilderDrawer from './SegmentBuilderDrawer';

/**
 * Onglet Segments — catalogue de segments de ciblage mailing.
 * Accessible uniquement en org_admin (gate appliqué au niveau page Mailing).
 */
export default function SegmentsTab() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { segments, isLoading, duplicateSegment, archiveSegment, isMutating } = useMailSegments(orgId);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };
  const openEdit = (seg) => {
    setEditing(seg);
    setDrawerOpen(true);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditing(null);
  };

  const handleDuplicate = async (seg) => {
    try {
      await duplicateSegment(seg);
    } catch {
      // toast géré dans le hook
    }
  };

  const handleArchive = async (seg) => {
    if (seg.is_preset) return;
    if (!window.confirm(`Archiver le segment "${seg.name}" ?`)) return;
    try {
      await archiveSegment(seg.id);
    } catch {
      // toast géré
    }
  };

  if (isLoading) {
    return (
      <div className="card p-8 flex items-center justify-center text-secondary-500">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Chargement des segments…
      </div>
    );
  }

  const presets = segments.filter((s) => s.is_preset);
  const custom = segments.filter((s) => !s.is_preset);

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">Segments de ciblage</h2>
            <p className="text-sm text-secondary-500">
              {segments.length} segment{segments.length > 1 ? 's' : ''} disponible{segments.length > 1 ? 's' : ''}
              {' · '}réutilisables en envoi manuel et campagnes automatiques
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Nouveau segment
          </Button>
        </div>

        {presets.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-secondary-500">Presets</h3>
            <div className="grid md:grid-cols-2 gap-3">
              {presets.map((seg) => (
                <SegmentCard
                  key={seg.id}
                  segment={seg}
                  orgId={orgId}
                  onEdit={() => openEdit(seg)}
                  onDuplicate={() => handleDuplicate(seg)}
                  onArchive={() => handleArchive(seg)}
                  disabled={isMutating}
                />
              ))}
            </div>
          </section>
        )}

        {custom.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-secondary-500">Mes segments</h3>
            <div className="grid md:grid-cols-2 gap-3">
              {custom.map((seg) => (
                <SegmentCard
                  key={seg.id}
                  segment={seg}
                  orgId={orgId}
                  onEdit={() => openEdit(seg)}
                  onDuplicate={() => handleDuplicate(seg)}
                  onArchive={() => handleArchive(seg)}
                  disabled={isMutating}
                />
              ))}
            </div>
          </section>
        )}

        {custom.length === 0 && (
          <div className="card p-4 text-sm text-secondary-500 text-center">
            Aucun segment personnalisé. Commence par en dupliquer un preset ou crée-en un depuis zéro.
          </div>
        )}
      </div>

      {drawerOpen && (
        <SegmentBuilderDrawer
          initial={editing}
          onClose={closeDrawer}
          onSaved={closeDrawer}
        />
      )}
    </>
  );
}

function SegmentCard({ segment, orgId, onEdit, onDuplicate, onArchive, disabled }) {
  const AudienceIcon = segment.audience === 'leads' ? UserCheck : Users;
  const { data: count, isLoading } = useSegmentCount({
    filters: segment.filters,
    orgId,
    enabled: !!orgId,
  });

  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <AudienceIcon className="w-4 h-4 text-primary-600 flex-shrink-0" />
            <h3 className="font-semibold text-secondary-900 truncate">{segment.name}</h3>
            {segment.is_preset && (
              <Lock className="w-3.5 h-3.5 text-secondary-400" title="Preset non modifiable" />
            )}
          </div>
          {segment.description && (
            <p className="text-xs text-secondary-500 mt-0.5 line-clamp-2">{segment.description}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-secondary-700 font-mono">
          {segment.audience}
        </span>
        {isLoading ? (
          <Loader2 className="w-3 h-3 animate-spin text-secondary-400" />
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 font-semibold">
            <Filter className="w-3 h-3 mr-1" />
            {count ?? '—'} destinataire{(count ?? 0) > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="flex gap-2 mt-1 pt-2 border-t">
        <Button variant="secondary" size="sm" onClick={onEdit} disabled={disabled}>
          <Edit className="w-3.5 h-3.5 mr-1" />
          {segment.is_preset ? 'Voir' : 'Éditer'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDuplicate} disabled={disabled}>
          <Copy className="w-3.5 h-3.5 mr-1" />
          Dupliquer
        </Button>
        {!segment.is_preset && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onArchive}
            disabled={disabled}
            className="ml-auto text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Archive className="w-3.5 h-3.5 mr-1" />
            Archiver
          </Button>
        )}
      </div>
    </div>
  );
}
