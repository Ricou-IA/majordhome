import { useCallback, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { chantierGaillacVisible } from '../config';
import { telechargerProgrammes } from '../programmesExport';
import { useChantierGaillac, useChantierGaillacMutations } from '../useChantierGaillac';
import { defaultPlanningCode, DEFAULT_FILTERS } from '../lib/chantierGaillacModel';
import GaillacBoard from '../components/GaillacBoard';
import SharePanel from '../components/SharePanel';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function readStored(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

/**
 * Suivi du chantier Gaillac (préconisations P2, Veolia) — module PROVISOIRE.
 * Technicien : arrive filtré sur lui et sa prochaine journée, coche et commente.
 * Admin (org_admin) : vue complète, dates prévues des codes, lien de partage externe.
 */
export default function ChantierGaillac() {
  const { organization, user, isOrgAdmin } = useAuth();
  const { settings } = useOrgSettings();
  const orgId = organization?.id;
  const userId = user?.id;
  const data = useChantierGaillac(orgId);
  const { setFait, setCommentaire, setDatePrevue } = useChantierGaillacMutations(orgId, data.mdhOrgId, userId);
  const storageKey = userId ? `chantier-gaillac-ui:${userId}` : null;

  // Techniciens du chantier = ceux qui portent au moins un code de planning
  const techniciens = useMemo(() => {
    const ids = [...new Set(data.planning.map((p) => p.technicien_id).filter(Boolean))];
    return ids
      .map((id) => data.team.find((m) => m.id === id) || { id, display_name: 'Technicien', first_name: null })
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'fr'));
  }, [data.planning, data.team]);

  const ready = !data.isLoading && data.planning.length > 0 && !!storageKey;

  // Filtres initiaux (lus une fois par GaillacBoard) : mémorisés ; un technicien arrive sur lui et sa prochaine journée
  const initialFilters = useMemo(() => {
    if (!ready) return DEFAULT_FILTERS;
    const next = { ...DEFAULT_FILTERS, ...(readStored(storageKey) || {}), q: '' };
    const me = data.team.find((m) => m.user_id === userId);
    if (!isOrgAdmin && me && techniciens.some((t) => t.id === me.id)) {
      next.techId = me.id;
      next.planningCode = defaultPlanningCode(data.planning, data.taches, me.id, todayIso());
    }
    return next;
    // Volontairement figé au premier chargement : un refetch ne doit pas réinitialiser les filtres
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const nameOf = useCallback((uid) => {
    if (!uid) return '';
    if (uid === userId) return 'vous';
    return data.team.find((m) => m.user_id === uid)?.display_name || '';
  }, [data.team, userId]);

  const handleToggle = useCallback(async (t, fait) => {
    try {
      await setFait.mutateAsync({ id: t.id, fait });
    } catch (e) {
      toast.error(`Tâche ${t.numero} : ${e?.message || 'validation non enregistrée'}`);
    }
  }, [setFait]);

  const handleComment = useCallback(async (t, texte) => {
    try {
      await setCommentaire.mutateAsync({ id: t.id, texte });
      toast.success(`Commentaire enregistré (tâche ${t.numero})`);
    } catch (e) {
      toast.error(`Tâche ${t.numero} : ${e?.message || 'commentaire non enregistré'}`);
    }
  }, [setCommentaire]);

  const handlePrint = useCallback(async ({ techId, planningCode }) => {
    try {
      const pages = await telechargerProgrammes({
        taches: data.taches, planning: data.planning, techniciens, techId, planningCode, settings,
      });
      if (!pages) toast.info('Aucune journée datée à imprimer avec ces filtres : programmez d’abord une date.');
    } catch (e) {
      toast.error(`Export PDF impossible : ${e?.message || 'erreur inconnue'}`);
    }
  }, [data.taches, data.planning, techniciens, settings]);

  const handleDatePrevue = useCallback(async (code, date) => {
    try {
      await setDatePrevue.mutateAsync({ code, date });
      toast.success(date ? `${code} programmé` : `Date retirée pour ${code}`);
    } catch (e) {
      toast.error(`${code} : ${e?.message || 'date non enregistrée'}`);
    }
  }, [setDatePrevue]);

  if (!chantierGaillacVisible(organization)) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-5 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Chantier Gaillac – Préconisations P2</h1>
        <p className="mt-1 text-sm text-slate-600">Mayer Énergie pour Veolia · devis D-2026-09452 et D-2026-09411</p>
      </header>

      {isOrgAdmin && <SharePanel orgId={orgId} />}

      {data.error && (
        <div role="alert" className="rounded-xl border border-[#F5C542] bg-[#FFF4D1] p-3 text-sm text-[#6B4E00]">
          Chargement impossible : {data.error.message || 'erreur inconnue'}. Rechargez la page.
        </div>
      )}

      {!ready ? (
        <div className="flex items-center gap-2 py-12 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Chargement du chantier…
        </div>
      ) : (
        <GaillacBoard
          taches={data.taches}
          planning={data.planning}
          techniciens={techniciens}
          initialFilters={initialFilters}
          storageKey={storageKey}
          isAdmin={isOrgAdmin}
          nameOf={nameOf}
          onToggle={handleToggle}
          onComment={handleComment}
          onDatePrevue={handleDatePrevue}
          onPrint={handlePrint}
          isFetching={data.isFetching}
          dataUpdatedAt={data.dataUpdatedAt}
        />
      )}
    </div>
  );
}
