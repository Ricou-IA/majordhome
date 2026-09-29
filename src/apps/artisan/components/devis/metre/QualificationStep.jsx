// src/apps/artisan/components/devis/metre/QualificationStep.jsx
// Étape 1 : « Que fait-on ? » (4 cartes), les caractéristiques du chantier toujours visibles (appareil /
// combustible / sortie / prise d'air, pré-remplies par l'installation du devis), puis les configurations
// en cartes lisibles ; cliquer une carte ouvre le relevé, une seule configuration possible → on y va
// tout seul. Le but est de faire vite les 80 % de devis simples (Eric, 2026-09-29), le modèle complet
// reste disponible.
import { Home, Building2, RefreshCw, Link2, Lock, AlertTriangle, ChevronRight } from 'lucide-react';
import { CRITERES, PROJETS, LIBELLES_COURTS, filtrerConfigurations } from './metreModel';

const ICONES_PROJET = { creation_interieur: Home, creation_exterieur: Building2, tubage: RefreshCw, raccordement: Link2 };
const LIBELLE_CRITERE = { appareil: 'Appareil', combustible: 'Combustible', zone: 'Sortie', prise_air: 'Prise d\'air' };

function Choix({ label, options, value, onChange }) {
  return (
    <div>
      <p className="text-xs font-medium text-secondary-600 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange(value === v ? null : v)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${value === v ? 'bg-primary-100 border-primary-400 text-primary-800 font-medium' : 'bg-white border-secondary-200 text-secondary-600 hover:border-primary-300'}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export default function QualificationStep({ configurations, criteres, setCriteres, selectedId, onContinue }) {
  const compatibles = filtrerConfigurations(configurations, criteres);
  const metrables = compatibles.filter((c) => !!c.gabarit_id);

  // Choisir le projet : s'il ne reste qu'une configuration métrable, on ouvre son relevé sans clic de plus.
  const choisirProjet = (p) => {
    const suivant = { ...criteres, projet: criteres.projet === p ? null : p };
    setCriteres(suivant);
    if (!suivant.projet) return;
    const seules = filtrerConfigurations(configurations, suivant).filter((c) => !!c.gabarit_id);
    if (seules.length === 1) onContinue(seules[0].id);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <section>
        <h3 className="text-base font-semibold text-secondary-900 mb-3">Que fait-on ?</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {PROJETS.map(([code, titre, sous]) => {
            const Icone = ICONES_PROJET[code];
            const actif = criteres.projet === code;
            return (
              <button key={code} type="button" onClick={() => choisirProjet(code)} aria-pressed={actif}
                className={`text-left p-4 rounded-xl border-2 transition-colors ${actif ? 'border-primary-500 bg-primary-50' : 'border-secondary-200 bg-white hover:border-primary-300'}`}>
                <Icone className={`w-7 h-7 mb-2 ${actif ? 'text-primary-700' : 'text-secondary-500'}`} />
                <p className="font-semibold text-secondary-900 leading-tight">{titre}</p>
                <p className="text-xs text-secondary-500 mt-1">{sous}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Toujours visibles (Eric, 2026-09-29) : ce sont les caractéristiques du chantier, pas des réglages ; repliées, on passe à côté d'une sélection. */}
      <section>
        <h3 className="text-base font-semibold text-secondary-900 mb-3">Caractéristiques</h3>
        <div className="grid gap-4 sm:grid-cols-2 border border-secondary-200 rounded-xl bg-white p-4">
          {['appareil', 'combustible', 'zone', 'prise_air'].map((k) => (
            <Choix key={k} label={LIBELLE_CRITERE[k]} options={CRITERES[k]} value={criteres[k]} onChange={(v) => setCriteres((c) => ({ ...c, [k]: v }))} />
          ))}
        </div>
      </section>

      {criteres.projet && (
        <section>
          <h3 className="text-base font-semibold text-secondary-900 mb-1">Comment ?</h3>
          <p className="text-xs text-secondary-500 mb-3">{metrables.length} solution{metrables.length > 1 ? 's' : ''} pour ce projet · cliquez pour ouvrir le relevé</p>
          {metrables.length === 0 && compatibles.length === 0 && (
            <p className="text-sm text-secondary-600 border-l-4 border-primary-400 bg-primary-50 px-3 py-2">Aucune configuration du catalogue ne correspond à ces caractéristiques. Décochez-en une (un clic sur un bouton sélectionné le retire).</p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {compatibles.map((c) => {
              const metrable = !!c.gabarit_id; const bloquee = !!c.condition_bloquante; const zoneSensible = (c.zones || []).some((z) => z !== 'zone_1');
              const actif = selectedId === c.id;
              return (
                <button key={c.id} type="button" disabled={!metrable} onClick={() => onContinue(c.id)}
                  className={`text-left p-4 rounded-xl border-2 transition-colors ${actif ? 'border-primary-500 bg-primary-50' : 'border-secondary-200 bg-white'} ${metrable ? 'hover:border-primary-400' : 'opacity-60 cursor-not-allowed'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-secondary-900 leading-tight">{LIBELLES_COURTS[c.code] || c.titre}</p>
                      <p className="text-xs text-secondary-500 mt-1">{c.titre}</p>
                      <p className="text-[11px] text-secondary-400 mt-1">{c.code} · catalogue p.{c.page_catalogue} · {c.gamme_principale}</p>
                      {!metrable && <p className="text-xs text-secondary-600 mt-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Métré non disponible (à venir)</p>}
                      {bloquee && <p className="text-xs text-primary-800 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Condition : {c.condition_bloquante}</p>}
                      {zoneSensible && <p className="text-xs text-primary-800 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Zones 2/3 : validation technicien obligatoire</p>}
                    </div>
                    {metrable && <ChevronRight className="w-5 h-5 shrink-0 text-secondary-400 mt-0.5" />}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
