import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { chantierGaillacVisible } from '../config';
import { useChantierGaillac, useChantierGaillacMutations } from '../useChantierGaillac';
import {
  filterTaches, groupTaches, planningOptions, defaultPlanningCode, indexPlanning,
} from '../lib/chantierGaillacModel';
import TechSummaryCards from '../components/TechSummaryCards';
import GaillacFilters from '../components/GaillacFilters';
import TaskGroup from '../components/TaskGroup';
import { ROW_GRID } from '../components/TaskRow';

const DEFAULT_FILTERS = { group: 'planning', techId: '', planningCode: '', hideDone: false, q: '' };

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

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : filtres non mémorisés */
  }
}

/**
 * Suivi du chantier Gaillac (préconisations P2, Veolia) — module PROVISOIRE.
 * Technicien : arrive filtré sur lui et sa prochaine journée, coche et commente.
 * Admin (org_admin) : vue complète + saisie des dates prévues des codes.
 */
export default function ChantierGaillac() {
  const { organization, user, isOrgAdmin } = useAuth();
  const orgId = organization?.id;
  const userId = user?.id;
  const data = useChantierGaillac(orgId);
  const { setFait, setCommentaire, setDatePrevue } = useChantierGaillacMutations(orgId, data.mdhOrgId, userId);

  const storageKey = userId ? `chantier-gaillac-ui:${userId}` : null;
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const initialised = useRef(false);

  // Techniciens du chantier = ceux qui portent au moins un code de planning
  const techniciens = useMemo(() => {
    const ids = [...new Set(data.planning.map((p) => p.technicien_id).filter(Boolean))];
    return ids
      .map((id) => data.team.find((m) => m.id === id) || { id, display_name: 'Technicien', first_name: null })
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'fr'));
  }, [data.planning, data.team]);

  // Filtres initiaux : mémorisés ; un technicien arrive toujours sur lui-même et sa prochaine journée
  useEffect(() => {
    if (initialised.current || !storageKey || data.isLoading || !data.planning.length) return;
    initialised.current = true;
    const stored = readStored(storageKey) || {};
    const next = { ...DEFAULT_FILTERS, ...stored, q: '' };
    const me = data.team.find((m) => m.user_id === userId);
    if (!isOrgAdmin && me && techniciens.some((t) => t.id === me.id)) {
      next.techId = me.id;
      next.planningCode = defaultPlanningCode(data.planning, data.taches, me.id, todayIso());
    }
    setFilters(next);
  }, [storageKey, data.isLoading, data.planning, data.taches, data.team, userId, isOrgAdmin, techniciens]);

  const handleFilters = useCallback((next) => {
    setFilters(next);
    if (storageKey) writeStored(storageKey, { ...next, q: '' });
  }, [storageKey]);

  const planningIndex = useMemo(() => indexPlanning(data.planning), [data.planning]);
  // Toutes les tâches (non filtrées) : les références « (36 à 39) » doivent rester consultables
  const byNumero = useMemo(() => new Map(data.taches.map((t) => [t.numero, t])), [data.taches]);
  const options = useMemo(
    () => planningOptions(data.planning, data.taches, filters.techId),
    [data.planning, data.taches, filters.techId],
  );
  const groups = useMemo(
    () => groupTaches(filterTaches(data.taches, filters), filters.group, data.planning),
    [data.taches, data.planning, filters],
  );

  const techNameOf = useCallback(
    (id) => techniciens.find((t) => t.id === id)?.first_name || techniciens.find((t) => t.id === id)?.display_name || '',
    [techniciens],
  );
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

      {data.error && (
        <div role="alert" className="rounded-xl border border-[#F5C542] bg-[#FFF4D1] p-3 text-sm text-[#6B4E00]">
          Chargement impossible : {data.error.message || 'erreur inconnue'}. Rechargez la page.
        </div>
      )}

      {data.isLoading ? (
        <div className="flex items-center gap-2 py-12 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Chargement du chantier…
        </div>
      ) : (
        <>
          <TechSummaryCards taches={data.taches} planning={data.planning} techniciens={techniciens} />

          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span><b className="text-slate-700">L1 à L7</b> demi-journées Ludovic à programmer</span>
            <span><b className="text-slate-700">A1 à A11</b> demi-journées Antoine à programmer</span>
            <span>4 h maximum par code, 20 min par site comptées pour trajet, accès et rangement</span>
          </p>

          <GaillacFilters filters={filters} onChange={handleFilters} techniciens={techniciens} options={options} />

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw className={`h-3.5 w-3.5 ${data.isFetching ? 'animate-spin' : ''}`} aria-hidden />
            Actualisé automatiquement toutes les minutes
            {data.dataUpdatedAt ? ` · dernière mise à jour ${new Date(data.dataUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>

          <div className="xl:overflow-hidden xl:rounded-xl xl:border xl:border-slate-200 xl:bg-white">
            <div
              className={`hidden border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${ROW_GRID}`}
              aria-hidden
            >
              <span>Fait</span><span>N°</span><span>Site</span><span>Action</span><span>Thème</span>
              <span>Tech.</span><span className="text-right">Durée</span><span>Achat</span><span>Planning</span>
              <span>Observations</span><span>Commentaire terrain</span>
            </div>
            {groups.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 xl:border-0">
                Aucune tâche ne correspond aux filtres.
              </p>
            ) : (
              <div className="space-y-5 xl:space-y-0">
                {groups.map((g) => (
                  <TaskGroup
                    key={g.key}
                    group={g}
                    planningIndex={planningIndex}
                    byNumero={byNumero}
                    isAdmin={isOrgAdmin}
                    techNameOf={techNameOf}
                    nameOf={nameOf}
                    onToggle={handleToggle}
                    onComment={handleComment}
                    onDatePrevue={handleDatePrevue}
                  />
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Les relevés (« ↳ Relevé ») préparent la commande unique : étiquettes, flèches, peinture RAL 1023, antirouille et pièces.
            Les lignes en italique sont hors périmètre Mayer Énergie et restent visibles pour le compte rendu à Veolia.
          </p>
        </>
      )}
    </div>
  );
}
