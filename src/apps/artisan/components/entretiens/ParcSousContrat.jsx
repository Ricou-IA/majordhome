/**
 * ParcSousContrat.jsx — Dashboard Entretiens : le parc sous contrat en arbre
 * ============================================================================
 * Arborescence Famille → Type → Marque → Modèle → Contrat (client) des
 * contrats ACTIFS de l'org, replié par défaut, avec une recherche qui élague
 * l'arbre (client, ville, n° de contrat, marque, modèle, type, famille) et
 * ouvre les branches touchées. Sous l'arbre, la composition des contrats
 * (équipements par contrat, combinaisons de familles), repliée.
 *
 * Données : `useParcSousContrat` (lignes brutes de `majordhome_contract_parc`)
 * + index du référentiel (`useEquipmentReferential`). Tout le calcul est dans
 * `src/lib/parcSousContrat.js` (`construireArbreParc`, `filtrerArbre`,
 * `agregerParc`) — rien ici.
 *
 * Les nœuds « Sans type » / « Non catégorisé » / « Marque non renseignée » /
 * « Modèle non renseigné » s'affichent en ambre : c'est le reliquat à
 * qualifier, jamais caché. Une seule teinte de barre : la longueur porte la
 * mesure, le libellé porte l'identité, les valeurs sont toujours écrites.
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Layers, AlertCircle, Search, X, User, FileText } from 'lucide-react';
import { useParcSousContrat } from '@hooks/useContracts';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { useDebounce } from '@hooks/useDebounce';
import { agregerParc, construireArbreParc, filtrerArbre, formatPart } from '@/lib/parcSousContrat';

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

function Barre({ part, className = 'h-1.5' }) {
  return (
    <div className={`w-full rounded-full bg-gray-100 overflow-hidden ${className}`} aria-hidden="true">
      <div
        className="h-full rounded-full bg-blue-500"
        style={{ width: `${Math.max(part > 0 ? 1 : 0, Math.round(part * 100))}%` }}
      />
    </div>
  );
}

const STYLE_NIVEAU = {
  famille: 'text-[15px] font-semibold text-gray-900',
  type: 'text-sm font-medium text-gray-800',
  marque: 'text-sm text-gray-700',
  modele: 'text-sm text-gray-600',
};

/** Feuille : un contrat (client). */
function LigneContrat({ noeud, profondeur, onOpenContract }) {
  const navigate = useNavigate();
  const c = noeud.contrat;
  return (
    <li
      className="flex items-center gap-3 py-1.5 pr-2 rounded hover:bg-gray-50"
      style={{ paddingLeft: `${profondeur * 20 + 28}px` }}
    >
      <User className="h-3.5 w-3.5 text-gray-400 shrink-0" />
      <button
        type="button"
        onClick={() => c?.clientId && navigate(`/clients/${c.clientId}`)}
        disabled={!c?.clientId}
        title={c?.clientId ? 'Ouvrir la fiche client' : 'Client inconnu'}
        className="text-sm text-gray-800 hover:text-blue-700 hover:underline text-left truncate disabled:no-underline disabled:text-amber-700"
      >
        {c?.clientNom}
        {c?.clientVille && <span className="text-gray-500"> · {c.clientVille}</span>}
      </button>
      <span className="ml-auto text-xs text-gray-500 tabular-nums whitespace-nowrap flex items-center gap-2">
        {noeud.equipements > 1 && <span>{noeud.equipements} équip.</span>}
        {c?.numero && onOpenContract ? (
          <button
            type="button"
            onClick={() => onOpenContract(c.id)}
            title="Ouvrir le contrat"
            className="inline-flex items-center gap-1 font-mono text-gray-500 hover:text-blue-700 hover:underline"
          >
            <FileText className="h-3 w-3" />
            {c.numero}
          </button>
        ) : (
          c?.numero && <span className="font-mono">{c.numero}</span>
        )}
      </span>
    </li>
  );
}

/** Nœud interne (famille / type / marque / modèle), récursif. */
function Noeud({ noeud, profondeur, ouverts, onToggle, onOpenContract }) {
  if (noeud.niveau === 'contrat') {
    return <LigneContrat noeud={noeud} profondeur={profondeur} onOpenContract={onOpenContract} />;
  }
  const ouvert = ouverts.has(noeud.key);
  const couleur = noeud.aQualifier ? 'text-amber-700' : '';
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(noeud.key)}
        aria-expanded={ouvert}
        className="w-full text-left py-1.5 pr-2 rounded hover:bg-gray-50"
        style={{ paddingLeft: `${profondeur * 20 + 4}px` }}
      >
        <div className="flex items-baseline gap-2">
          <ChevronRight className={`h-4 w-4 text-gray-400 shrink-0 self-center transition-transform ${ouvert ? 'rotate-90' : ''}`} />
          <span className={`${STYLE_NIVEAU[noeud.niveau]} ${couleur} truncate`}>{noeud.label}</span>
          <span className="ml-auto text-xs text-gray-500 tabular-nums whitespace-nowrap">
            <span className="font-semibold text-gray-800">{noeud.equipements}</span> équip. ·{' '}
            {pluriel(noeud.contrats, 'contrat', 'contrats')} · {formatPart(noeud.part)}
          </span>
        </div>
        <div style={{ paddingLeft: '24px' }}>
          <Barre part={noeud.part} className={noeud.niveau === 'famille' ? 'h-2 mt-1' : 'h-1 mt-1'} />
        </div>
      </button>
      {ouvert && (
        <ul className="border-l border-gray-200" style={{ marginLeft: `${profondeur * 20 + 11}px` }}>
          {noeud.enfants.map((e) => (
            <Noeud
              key={e.key}
              noeud={e}
              profondeur={0}
              ouverts={ouverts}
              onToggle={onToggle}
              onOpenContract={onOpenContract}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function Composition({ composition, contrats }) {
  const max = Math.max(1, ...composition.combinaisons.map((c) => c.contrats));
  return (
    <div className="grid gap-6 grid-cols-1 md:grid-cols-2 pt-3">
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
              <Barre part={c.contrats / max} className="h-1 mt-1" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * @param {{ coreOrgId: string, onOpenContract?: (contractId: string) => void }} props — org CORE (celle de `contracts.org_id`)
 */
export function ParcSousContrat({ coreOrgId, onOpenContract }) {
  const { lignes, isLoading, error } = useParcSousContrat(coreOrgId);
  const { index, isLoading: referentielLoading, error: referentielError } = useEquipmentReferential();
  const [recherche, setRecherche] = useState('');
  const terme = useDebounce(recherche, 200);
  const [ouverts, setOuverts] = useState(() => new Set());

  const arbre = useMemo(() => (lignes ? construireArbreParc(lignes, index) : null), [lignes, index]);
  const parc = useMemo(() => (lignes ? agregerParc(lignes, index) : null), [lignes, index]);
  const filtre = useMemo(() => (arbre ? filtrerArbre(arbre.racines, terme) : null), [arbre, terme]);
  const ouvertsEffectifs = useMemo(() => {
    if (!filtre || filtre.aOuvrir.size === 0) return ouverts;
    const s = new Set(ouverts);
    filtre.aOuvrir.forEach((k) => s.add(k));
    return s;
  }, [ouverts, filtre]);

  const toggle = (key) =>
    setOuverts((prev) => {
      const next = new Set(prev);
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

  if (isLoading || referentielLoading || !arbre || !parc || !filtre) {
    return <div className="h-64 bg-white rounded-lg border border-gray-200 animate-pulse" />;
  }

  const enFiltre = terme.trim().length > 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-100 shrink-0">
          <Layers className="w-5 h-5 text-blue-600" />
        </div>
        <div className="min-w-0 flex-1">
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
        <label className="relative block w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Client, ville, n° contrat, marque, modèle…"
            className="w-full pl-8 pr-8 py-1.5 text-sm rounded-md border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            aria-label="Rechercher dans le parc"
          />
          {recherche && (
            <button
              type="button"
              onClick={() => setRecherche('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Effacer la recherche"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </div>

      {arbre.equipements === 0 ? (
        <p className="text-sm text-gray-500">Aucun équipement rattaché à un contrat actif.</p>
      ) : (
        <>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1 flex items-baseline gap-2">
            Famille → Type → Marque → Modèle → Contrat
            <span className="normal-case font-normal">part des équipements</span>
            {enFiltre && (
              <span className="normal-case font-normal ml-auto text-gray-600">
                {pluriel(filtre.equipements, 'équipement', 'équipements')} · {pluriel(filtre.contrats, 'contrat', 'contrats')} pour « {terme.trim()} »
              </span>
            )}
          </p>
          {filtre.racines.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">Rien ne correspond à « {terme.trim()} ».</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtre.racines.map((n) => (
                <Noeud
                  key={n.key}
                  noeud={n}
                  profondeur={0}
                  ouverts={ouvertsEffectifs}
                  onToggle={toggle}
                  onOpenContract={onOpenContract}
                />
              ))}
            </ul>
          )}

          <details className="mt-4 border-t border-gray-100 pt-3 group">
            <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900 flex items-center gap-1.5 select-none">
              <ChevronRight className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-90" />
              Composition des contrats
              <span className="font-normal text-gray-500">
                · {parc.composition.monoFamille} mono-famille · {parc.composition.multiFamilles} multi-familles
              </span>
            </summary>
            <Composition composition={parc.composition} contrats={parc.contrats} />
          </details>
        </>
      )}
    </div>
  );
}

export default ParcSousContrat;
