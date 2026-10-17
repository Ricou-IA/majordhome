import { useCallback, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  filterTaches, groupTaches, planningOptions, indexPlanning, DEFAULT_FILTERS,
} from '../lib/chantierGaillacModel';
import TechSummaryCards from './TechSummaryCards';
import GaillacFilters from './GaillacFilters';
import TaskGroup from './TaskGroup';
import { ROW_GRID, ROW_GRID_READONLY } from './TaskRow';

function writeStored(key, value) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : filtres non mémorisés */
  }
}

/**
 * Tableau de suivi partagé par la page interne et le lien externe en lecture seule.
 * Monté une fois les données chargées : `initialFilters` n'est lu qu'au premier rendu.
 */
export default function GaillacBoard({
  taches, planning, techniciens, initialFilters = DEFAULT_FILTERS, storageKey = null,
  readOnly = false, isAdmin = false, nameOf, onToggle, onComment, onDatePrevue,
  isFetching = false, dataUpdatedAt = 0,
}) {
  const [filters, setFilters] = useState(initialFilters);

  const handleFilters = useCallback((next) => {
    setFilters(next);
    writeStored(storageKey, { ...next, q: '' });
  }, [storageKey]);

  const planningIndex = useMemo(() => indexPlanning(planning), [planning]);
  // Toutes les tâches (non filtrées) : les références « (36 à 39) » doivent rester consultables
  const byNumero = useMemo(() => new Map(taches.map((t) => [t.numero, t])), [taches]);
  const options = useMemo(() => planningOptions(planning, taches, filters.techId), [planning, taches, filters.techId]);
  const groups = useMemo(() => groupTaches(filterTaches(taches, filters), filters.group, planning), [taches, planning, filters]);

  const techNameOf = useCallback((id) => {
    const t = techniciens.find((x) => x.id === id);
    return t?.first_name || t?.display_name || '';
  }, [techniciens]);

  const grid = readOnly ? ROW_GRID_READONLY : ROW_GRID;

  return (
    <>
      <TechSummaryCards taches={taches} planning={planning} techniciens={techniciens} readOnly={readOnly} />

      {!readOnly && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span><b className="text-slate-700">L1 à L7</b> demi-journées Ludovic à programmer</span>
          <span><b className="text-slate-700">A1 à A11</b> demi-journées Antoine à programmer</span>
          <span>4 h maximum par code, 20 min par site comptées pour trajet, accès et rangement</span>
        </p>
      )}

      <GaillacFilters filters={filters} onChange={handleFilters} techniciens={techniciens} options={options} readOnly={readOnly} />

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden />
        Actualisé automatiquement toutes les minutes
        {dataUpdatedAt ? ` · dernière mise à jour ${new Date(dataUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
      </div>

      <div className="xl:overflow-hidden xl:rounded-xl xl:border xl:border-slate-200 xl:bg-white">
        <div className={`hidden border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${grid}`} aria-hidden>
          <span>{readOnly ? 'Statut' : 'Fait'}</span><span>N°</span><span>Site</span><span>Action</span><span>Thème</span><span>Tech.</span>
          {!readOnly && (<><span className="text-right">Durée</span><span>Achat</span></>)}
          <span>Planning</span>
          {!readOnly && (<><span>Observations</span><span>Commentaire terrain</span></>)}
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
                isAdmin={isAdmin && !readOnly}
                techNameOf={techNameOf}
                nameOf={nameOf}
                onToggle={onToggle}
                onComment={onComment}
                onDatePrevue={onDatePrevue}
                readOnly={readOnly}
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
  );
}
