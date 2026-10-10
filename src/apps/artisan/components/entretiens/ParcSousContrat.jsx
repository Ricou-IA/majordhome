/**
 * ParcSousContrat.jsx — Dashboard Entretiens : répartition du parc sous contrat
 * ============================================================================
 * Deux lectures du même parc (contrats ACTIFS de l'org) :
 *   - par famille d'intervention (catégorie du référentiel), dépliable par
 *     type d'équipement ;
 *   - composition des contrats : nombre d'équipements, mono / multi-familles,
 *     combinaisons de familles.
 *
 * Données : `useParcSousContrat` (lignes brutes de la vue
 * `majordhome_contract_parc`) agrégées par `agregerParc` avec l'index du
 * référentiel (`useEquipmentReferential`). Aucun calcul ici.
 *
 * Les lignes « Sans type » / « Non catégorisé » / « Sans équipement » sont
 * affichées en ambre : c'est le reliquat à qualifier, pas un détail à cacher.
 * Une seule teinte pour les barres (la longueur porte la mesure, le libellé
 * porte l'identité) ; les valeurs exactes sont toujours écrites.
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { ChevronDown, Layers, AlertCircle } from 'lucide-react';
import { useParcSousContrat } from '@hooks/useContracts';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { agregerParc, formatPart } from '@/lib/parcSousContrat';

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

function Barre({ part, className = 'h-2' }) {
  return (
    <div className={`w-full rounded-full bg-gray-100 overflow-hidden ${className}`} aria-hidden="true">
      <div
        className="h-full rounded-full bg-blue-500"
        style={{ width: `${Math.max(part > 0 ? 1 : 0, Math.round(part * 100))}%` }}
      />
    </div>
  );
}

function LigneType({ type }) {
  const aQualifier = type.id === null;
  return (
    <li className="pl-6 pr-1 py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={aQualifier ? 'text-amber-700' : 'text-gray-700'}>{type.label}</span>
        <span className="text-gray-500 tabular-nums whitespace-nowrap">
          {pluriel(type.equipements, 'équip.', 'équip.')} · {pluriel(type.contrats, 'contrat', 'contrats')} · {formatPart(type.part)}
        </span>
      </div>
      <Barre part={type.part} className="h-1.5 mt-1" />
    </li>
  );
}

function LigneFamille({ famille, ouverte, onToggle }) {
  const aQualifier = famille.id === null;
  return (
    <li className="py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={ouverte}
        className="w-full text-left group"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex items-center gap-1.5 font-medium text-gray-900">
            <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${ouverte ? 'rotate-180' : ''}`} />
            <span className={aQualifier ? 'text-amber-700' : ''}>{famille.label}</span>
          </span>
          <span className="text-sm text-gray-600 tabular-nums whitespace-nowrap">
            <span className="font-semibold text-gray-900">{famille.equipements}</span> équip. ·{' '}
            {pluriel(famille.contrats, 'contrat', 'contrats')} · {formatPart(famille.part)}
          </span>
        </div>
        <Barre part={famille.part} className="h-2 mt-1.5" />
      </button>
      {ouverte && (
        <ul className="mt-1 border-l border-gray-200 ml-2">
          {famille.types.map((t) => (
            <LigneType key={t.id ?? 'sans-type'} type={t} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Composition({ composition, contrats }) {
  const max = Math.max(1, ...composition.combinaisons.map((c) => c.contrats));
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Équipements par contrat</p>
        <div className="grid grid-cols-4 gap-2">
          {composition.parNombre.map(({ tranche, contrats: n }) => (
            <div
              key={tranche}
              className={`rounded-lg border p-2.5 text-center ${tranche === '0' && n > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}
            >
              <p className={`text-lg font-semibold tabular-nums ${tranche === '0' && n > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{n}</p>
              <p className="text-xs text-gray-500">{tranche} équip.</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          Combinaisons de familles
          <span className="normal-case font-normal ml-2">
            {composition.monoFamille} mono-famille · {composition.multiFamilles} multi-familles
          </span>
        </p>
        <ul className="space-y-1.5">
          {composition.combinaisons.map((c) => (
            <li key={c.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className={c.familles === 0 ? 'text-amber-700' : 'text-gray-700'}>{c.label}</span>
                <span className="text-gray-500 tabular-nums whitespace-nowrap">
                  {c.contrats} · {formatPart(contrats > 0 ? c.contrats / contrats : 0)}
                </span>
              </div>
              <Barre part={c.contrats / max} className="h-1.5 mt-1" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * @param {{ coreOrgId: string }} props — org CORE (celle de `contracts.org_id`)
 */
export function ParcSousContrat({ coreOrgId }) {
  const { lignes, isLoading, error } = useParcSousContrat(coreOrgId);
  const { index, isLoading: referentielLoading, error: referentielError } = useEquipmentReferential();
  const [ouvertes, setOuvertes] = useState(() => new Set());

  const parc = useMemo(() => (lignes ? agregerParc(lignes, index) : null), [lignes, index]);

  const toggle = (id) =>
    setOuvertes((prev) => {
      const next = new Set(prev);
      const key = id ?? 'sans-categorie';
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  if (error || referentielError) {
    return (
      <div className="bg-white rounded-lg border border-red-200 p-4 flex items-start gap-2 text-sm text-red-700">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>Impossible de charger le parc sous contrat : {(error || referentielError)?.message || 'erreur inconnue'}</span>
      </div>
    );
  }

  if (isLoading || referentielLoading || !parc) {
    return <div className="h-64 bg-white rounded-lg border border-gray-200 animate-pulse" />;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-100 shrink-0">
          <Layers className="w-5 h-5 text-blue-600" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">Parc sous contrat</h3>
          <p className="text-sm text-gray-500">
            {pluriel(parc.contrats, 'contrat actif', 'contrats actifs')} · {pluriel(parc.equipements, 'équipement', 'équipements')}
            {parc.contratsSansEquipement > 0 && (
              <> · <span className="text-amber-700">{parc.contratsSansEquipement} sans équipement</span></>
            )}
            {parc.equipementsSansType > 0 && (
              <> · <span className="text-amber-700">{parc.equipementsSansType} équip. sans type</span></>
            )}
          </p>
        </div>
      </div>

      {parc.equipements === 0 ? (
        <p className="text-sm text-gray-500">Aucun équipement rattaché à un contrat actif.</p>
      ) : (
        <div className="grid gap-8 grid-cols-1 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Par famille d&apos;intervention
              <span className="normal-case font-normal ml-2">part des équipements</span>
            </p>
            <ul className="divide-y divide-gray-100">
              {parc.familles.map((f) => (
                <LigneFamille
                  key={f.id ?? 'sans-categorie'}
                  famille={f}
                  ouverte={ouvertes.has(f.id ?? 'sans-categorie')}
                  onToggle={() => toggle(f.id)}
                />
              ))}
            </ul>
          </div>
          <div className="lg:col-span-2">
            <Composition composition={parc.composition} contrats={parc.contrats} />
          </div>
        </div>
      )}
    </div>
  );
}

export default ParcSousContrat;
