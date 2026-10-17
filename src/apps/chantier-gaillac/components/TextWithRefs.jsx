import { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { splitReferences, formatDateCourte, formatDuree } from '../lib/chantierGaillacModel';

/**
 * Texte dont les références « (36 à 39) », « (R3) »… deviennent des boutons : un appui déplie
 * sous le texte les tâches citées, même quand les filtres les masquent de la liste.
 */
export default function TextWithRefs({ text, byNumero, planningIndex, className = '' }) {
  const [open, setOpen] = useState(null); // index du segment déplié
  const segments = splitReferences(text, [...byNumero.keys()]);
  if (!segments.length) return null;

  const opened = open !== null ? segments[open] : null;

  return (
    <>
      <span className={className}>
        {segments.map((s, i) => (s.type === 'text' ? (
          <span key={i}>{s.value}</span>
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            className="mx-0.5 inline-flex items-center gap-0.5 rounded-md border border-[#2196F3] bg-[#E3EEFB] px-1.5 py-0.5 align-baseline text-[0.95em] font-semibold not-italic text-[#0D47A1] hover:bg-[#cfe2f8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5C542]"
          >
            {s.value}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open === i ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        )))}
      </span>
      {opened && (
        <ul className="mt-2 space-y-1.5 rounded-lg border border-[#BBD5F5] bg-white p-2 text-sm font-normal not-italic text-slate-800">
          {opened.numeros.map((n) => {
            const t = byNumero.get(n);
            if (!t) return null;
            const p = planningIndex.get(t.planning_code);
            return (
              <li key={n} className="flex gap-2">
                <span className="w-9 shrink-0 font-mono text-slate-500">{n}</span>
                <span className="min-w-0 flex-1">
                  <span className={t.fait ? 'line-through decoration-slate-400' : ''}>{t.action}</span>
                  <span className="block text-xs text-slate-500">
                    {t.site}
                    {' · '}
                    {p?.date_prevue ? `${formatDateCourte(p.date_prevue)} · ${t.planning_code}` : `Code ${t.planning_code || '–'}`}
                    {t.duree_min ? ` · ${formatDuree(t.duree_min)}` : ''}
                  </span>
                </span>
                <span className={`shrink-0 text-xs font-semibold ${t.fait ? 'text-[#0D47A1]' : 'text-slate-500'}`}>
                  {t.fait ? (
                    <span className="inline-flex items-center gap-0.5"><Check className="h-3.5 w-3.5" aria-hidden />Fait</span>
                  ) : 'À faire'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
