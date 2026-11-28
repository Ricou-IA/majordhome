// src/apps/artisan/components/devis/metre/QualificationStep.jsx
// Étape 1 : « Que fait-on ? » (4 cartes), les caractéristiques du chantier toujours visibles (appareil /
// combustible / sortie / prise d'air, pré-remplies par l'installation du devis), puis les configurations
// en cartes lisibles ; cliquer une carte ouvre le relevé, une seule configuration possible → on y va
// tout seul. Le but est de faire vite les 80 % de devis simples (Eric, 2026-09-29), le modèle complet
// reste disponible.
import { Home, Building2, RefreshCw, Link2, Lock, AlertTriangle, ChevronRight, SearchX } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Puce } from './Puce';
import { CRITERES, PROJETS, LIBELLES_COURTS, filtrerConfigurations } from './metreModel';

const ICONES_PROJET = { creation_interieur: Home, creation_exterieur: Building2, tubage: RefreshCw, raccordement: Link2 };
const LIBELLE_CRITERE = { appareil: 'Appareil', combustible: 'Combustible', zone: 'Sortie', prise_air: 'Prise d\'air' };

function Choix({ label, options, value, onChange }) {
  return (
    <div>
      <p className="text-label text-secondary-800 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => <Puce key={v} actif={value === v} onClick={() => onChange(value === v ? null : v)}>{l}</Puce>)}
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
        <h3 className="font-display text-section text-secondary-900 mb-3">Votre projet</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {PROJETS.map(([code, titre, sous]) => {
            const Icone = ICONES_PROJET[code];
            const actif = criteres.projet === code;
            return (
              <button key={code} type="button" onClick={() => choisirProjet(code)} aria-pressed={actif}
                className={`text-left p-4 rounded-xl border-2 transition-colors focus-visible:outline-none focus-visible:shadow-ring ${actif ? 'border-primary-600 bg-primary-50' : 'border-secondary-200 bg-white hover:border-secondary-400'}`}>
                <Icone className={`w-7 h-7 mb-2 ${actif ? 'text-primary-700' : 'text-secondary-500'}`} />
                <p className="font-semibold text-secondary-900 leading-tight">{titre}</p>
                <p className="text-caption text-secondary-600 mt-1">{sous}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Toujours visibles (Eric, 2026-09-29) : ce sont les caractéristiques du chantier, pas des réglages ; repliées, on passe à côté d'une sélection. */}
      <section>
        <h3 className="font-display text-section text-secondary-900 mb-3">Caractéristiques</h3>
        <div className="grid gap-4 sm:grid-cols-2 border border-secondary-200 rounded-xl bg-white p-4">
          {['appareil', 'combustible', 'zone', 'prise_air'].map((k) => (
            <Choix key={k} label={LIBELLE_CRITERE[k]} options={CRITERES[k]} value={criteres[k]} onChange={(v) => setCriteres((c) => ({ ...c, [k]: v }))} />
          ))}
        </div>
      </section>

      {criteres.projet && (
        <section>
          <h3 className="font-display text-section text-secondary-900 mb-1">Choisissez la solution</h3>
          <p className="text-sm text-secondary-600 mb-3">{metrables.length} solution{metrables.length > 1 ? 's' : ''} possible{metrables.length > 1 ? 's' : ''}</p>
          {metrables.length === 0 && compatibles.length === 0 && (
            <EmptyState icon={SearchX} message="Aucune solution pour ces caractéristiques."
              detail="Un clic sur une caractéristique choisie la retire."
              action={{ label: 'Réinitialiser les caractéristiques', onClick: () => setCriteres((c) => ({ ...c, appareil: null, combustible: null, zone: null, prise_air: null })) }} />
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {compatibles.map((c) => {
              const metrable = !!c.gabarit_id; const bloquee = !!c.condition_bloquante; const zoneSensible = (c.zones || []).some((z) => z !== 'zone_1');
              const actif = selectedId === c.id;
              return (
                <button key={c.id} type="button" disabled={!metrable} onClick={() => onContinue(c.id)}
                  className={`text-left p-4 rounded-xl border-2 transition-colors focus-visible:outline-none focus-visible:shadow-ring ${actif ? 'border-primary-600 bg-primary-50' : 'border-secondary-200 bg-white'} ${metrable ? 'hover:border-secondary-400' : 'opacity-60 cursor-not-allowed'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-secondary-900 leading-tight">{LIBELLES_COURTS[c.code] || c.titre}</p>
                      <p className="text-caption text-secondary-600 mt-1">{c.titre}</p>
                      {!metrable && <p className="text-caption text-secondary-700 mt-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Métré non disponible (à venir)</p>}
                      {bloquee && <p className="text-caption text-st-attente mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Condition : {c.condition_bloquante}</p>}
                      {zoneSensible && <p className="text-caption text-st-attente mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Sortie hors faîtage : à faire valider par un technicien avant la pose</p>}
                      <p className="text-caption text-secondary-600 mt-1">Réf. catalogue p. {c.page_catalogue} · {c.gamme_principale}</p>
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
