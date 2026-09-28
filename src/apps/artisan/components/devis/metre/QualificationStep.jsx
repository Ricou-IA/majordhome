// src/apps/artisan/components/devis/metre/QualificationStep.jsx
// Étape 1 : critères → configurations compatibles (filtrage déterministe, aucune IA).
// Une configuration sans gabarit (pas encore métrable) est listée grisée avec le motif.
import { Flame, Lock, AlertTriangle } from 'lucide-react';
import { CRITERES, filtrerConfigurations } from './metreModel';

function Choix({ label, options, value, onChange }) {
  return (
    <div>
      <p className="text-xs font-medium text-secondary-600 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange(value === v ? null : v)}
            className={`px-3 py-2 rounded-lg text-sm border ${value === v ? 'bg-primary-100 border-primary-400 text-primary-800 font-medium' : 'bg-white border-secondary-200 text-secondary-600 hover:border-primary-300'}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export default function QualificationStep({ configurations, criteres, setCriteres, selectedId, onSelect }) {
  const compatibles = filtrerConfigurations(configurations, criteres);
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        {Object.entries(CRITERES).map(([k, opts]) => <Choix key={k} label={{ projet: 'Projet', appareil: 'Appareil', combustible: 'Combustible', zone: 'Sortie', prise_air: 'Prise d\'air' }[k]} options={opts} value={criteres[k]} onChange={(v) => setCriteres((c) => ({ ...c, [k]: v }))} />)}
      </div>
      <div className="space-y-2">
        {(() => {
          const n = compatibles.length; const m = compatibles.filter((c) => !!c.gabarit_id).length; const s = n > 1 ? 's' : '';
          const metrables = configurations.filter((c) => !!c.gabarit_id);
          // Le nombre qui compte pour l'utilisateur est celui des configurations MÉTRABLES, pas des compatibles.
          // Et quand la sélection n'en contient aucune, on dit lesquelles le sont (recette 2026-09-28 : deux
          // « 0 avec métré » de suite se lisaient « rien n'est possible »).
          return (
            <>
              <p className="text-xs font-medium text-secondary-600">{n} configuration{s} compatible{s} · <span className={m === 0 && n > 0 ? 'text-primary-800' : ''}>{m} avec métré</span></p>
              {m === 0 && metrables.length > 0 && (
                <p className="text-xs text-secondary-600 border-l-4 border-primary-400 bg-primary-50 px-3 py-2">
                  Métré disponible dans cette version pour : {metrables.map((c) => c.code).join(', ')}. Modifiez les critères (projet, combustible…) pour y arriver.
                </p>
              )}
            </>
          );
        })()}
        {compatibles.map((c) => {
          const metrable = !!c.gabarit_id; const bloquee = !!c.condition_bloquante; const zoneSensible = (c.zones || []).some((z) => z !== 'zone_1');
          return (
            <button key={c.id} type="button" disabled={!metrable} onClick={() => onSelect(c.id)}
              className={`w-full text-left p-3 rounded-lg border ${selectedId === c.id ? 'border-primary-400 bg-primary-50' : 'border-secondary-200 bg-white'} ${metrable ? 'hover:border-primary-300' : 'opacity-60 cursor-not-allowed'}`}>
              <div className="flex items-start gap-2">
                <Flame className="w-4 h-4 mt-0.5 text-secondary-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-secondary-900">{c.titre}</p>
                  <p className="text-xs text-secondary-500">{c.code} · catalogue p.{c.page_catalogue} · {c.gamme_principale}</p>
                  {!metrable && <p className="text-xs text-secondary-600 mt-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Métré non disponible pour cette configuration (à venir)</p>}
                  {bloquee && <p className="text-xs text-primary-800 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Condition : {c.condition_bloquante}</p>}
                  {zoneSensible && <p className="text-xs text-primary-800 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Zones 2/3 : validation technicien obligatoire</p>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
