import { techSummary, formatDuree, formatDateCourte } from '../lib/chantierGaillacModel';

/** Une carte par technicien : temps programmé, reste à programmer, tâches validées, barre d'avancement. */
export default function TechSummaryCards({ taches, planning, techniciens, readOnly = false }) {
  return (
    <section aria-label="Synthèse par technicien" className="grid gap-3 sm:grid-cols-2">
      {techniciens.map((tech) => {
        const s = techSummary(taches, planning, tech.id);
        const dates = s.dates.map(formatDateCourte).join(', ');
        return (
          <article key={tech.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{tech.display_name}</h2>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              {readOnly ? (
                <>
                  <dt className="text-slate-500">Journées programmées</dt>
                  <dd className="text-right font-mono tabular-nums">{dates || '–'}</dd>
                </>
              ) : (
                <>
                  <dt className="text-slate-500">Programmé{dates ? ` (${dates})` : ''}</dt>
                  <dd className="text-right font-mono tabular-nums">{formatDuree(s.programmeMin)}</dd>
                  <dt className="text-slate-500">Reste à programmer</dt>
                  <dd className="text-right font-mono tabular-nums">{formatDuree(s.restantMin)}</dd>
                </>
              )}
              <dt className="text-slate-500">Tâches validées</dt>
              <dd className="text-right font-mono tabular-nums">{s.done} / {s.total}</dd>
            </dl>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-[#E3EEFB]"
              role="progressbar"
              aria-valuenow={s.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${s.pct} % validé`}
            >
              <div className="h-full bg-[#1565C0] transition-[width]" style={{ width: `${s.pct}%` }} />
            </div>
            <p className="mt-1 text-right text-xs text-slate-500">{s.pct} % validé</p>
          </article>
        );
      })}
    </section>
  );
}
