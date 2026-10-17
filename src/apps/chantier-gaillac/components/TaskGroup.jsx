import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { formatDuree, formatDateCourte } from '../lib/chantierGaillacModel';
import TaskRow from './TaskRow';

/** Saisie admin de la date prévue d'un code (enregistrée au changement). */
function DatePrevueInput({ planning, onSave }) {
  const [value, setValue] = useState(planning.date_prevue || '');
  useEffect(() => setValue(planning.date_prevue || ''), [planning.date_prevue]);
  return (
    <label className="inline-flex items-center gap-2 text-sm font-normal text-slate-700">
      <CalendarDays className="h-4 w-4 text-[#1565C0]" aria-hidden />
      <span className="sr-only">Date prévue pour {planning.code}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onSave(planning.code, e.target.value || null);
        }}
        className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 text-sm"
      />
    </label>
  );
}

/** Groupe de tâches : en-tête (libellé, date, compteurs, durée accès compris) + lignes. */
export default function TaskGroup({ group, planningIndex, byNumero, isAdmin, techNameOf, nameOf, onToggle, onComment, onDatePrevue }) {
  const p = group.planning;
  return (
    <section aria-label={group.label} className="space-y-2 xl:space-y-0">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-[#E3EEFB] px-3 py-2.5 xl:rounded-none xl:border-b xl:border-[#BBD5F5]">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[#0D47A1]">{group.label}</h3>
          {p?.date_prevue && !isAdmin && (
            <p className="text-sm text-slate-700">Prévu le {formatDateCourte(p.date_prevue)}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {p && isAdmin && <DatePrevueInput planning={p} onSave={onDatePrevue} />}
          <span className="font-mono text-sm tabular-nums text-slate-700">
            {group.count} ligne{group.count > 1 ? 's' : ''} · {group.done} validée{group.done > 1 ? 's' : ''}
            {group.isHorsPerimetre ? '' : ` · ${formatDuree(group.totalMin)} accès compris`}
          </span>
        </div>
      </header>
      <ul className="space-y-2 xl:space-y-0">
        {group.rows.map((t) => (
          <TaskRow
            key={t.id}
            tache={t}
            planning={planningIndex.get(t.planning_code)}
            planningIndex={planningIndex}
            byNumero={byNumero}
            techName={techNameOf(t.technicien_id)}
            nameOf={nameOf}
            onToggle={onToggle}
            onComment={onComment}
          />
        ))}
      </ul>
    </section>
  );
}
