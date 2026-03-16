/**
 * SearchSireneModal.jsx — Recherche live API SIRENE + favori → prospect
 * Utilisé inline (pas en modal) dans les pages Pipeline (tab Screener).
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Search,
  Star,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MapPin,
  X,
} from 'lucide-react';
import { useSireneSearch } from '../hooks/useSireneSearch';
import { useExistingSirens, useProspectMutations } from '@hooks/useProspects';
import { useAuth } from '@contexts/AuthContext';
import { formatEuro } from '@/lib/utils';
import { NAF_LABELS } from '../lib/nafGlossary';
import NafSelector from './NafSelector';
import { toast } from 'sonner';

// Départements français les plus courants (pour le select)
const DEPARTEMENTS_COURANTS = [
  { value: '81', label: '81 - Tarn' },
  { value: '12', label: '12 - Aveyron' },
  { value: '31', label: '31 - Haute-Garonne' },
  { value: '82', label: '82 - Tarn-et-Garonne' },
  { value: '46', label: '46 - Lot' },
  { value: '32', label: '32 - Gers' },
  { value: '34', label: '34 - Hérault' },
  { value: '11', label: '11 - Aude' },
  { value: '09', label: '09 - Ariège' },
  { value: '65', label: '65 - Hautes-Pyrénées' },
];

export default function SearchSireneModal({
  module,
  defaultNafCodes = [],
  defaultDepartements = [],
  scoringFn,
}) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;

  const {
    query, setQuery,
    results, totalResults,
    isSearching,
    page, totalPages, nextPage, prevPage,
    nafCodes, setNafCodes,
    departement, setDepartement,
    communeCode, setCommuneCode,
  } = useSireneSearch({ module, defaultNafCodes, defaultDepartements });

  const { createProspect, isCreating } = useProspectMutations();

  // Check doublons batch
  const resultSirens = useMemo(
    () => results.map((r) => r.siren).filter(Boolean),
    [results]
  );
  const { existingSirens } = useExistingSirens(orgId, module, resultSirens);

  // ── Autocomplete commune (API Géo) ──
  const [communeInput, setCommuneInput] = useState('');
  const [communeLabel, setCommuneLabel] = useState(''); // nom sélectionné
  const [communeSuggestions, setCommuneSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const communeRef = useRef(null);

  // Debounce fetch suggestions
  useEffect(() => {
    if (!communeInput || communeInput.length < 2 || communeLabel) {
      setCommuneSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          nom: communeInput,
          fields: 'nom,code,departement,codesPostaux',
          limit: '7',
        });
        if (departement) params.set('codeDepartement', departement);
        const res = await fetch(`https://geo.api.gouv.fr/communes?${params}`);
        if (res.ok) {
          const data = await res.json();
          setCommuneSuggestions(data);
          setShowSuggestions(data.length > 0);
        }
      } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(timer);
  }, [communeInput, departement, communeLabel]);

  // Click outside → fermer suggestions
  useEffect(() => {
    const handler = (e) => {
      if (communeRef.current && !communeRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectCommune = useCallback((commune) => {
    setCommuneCode(commune.code);
    setCommuneLabel(commune.nom);
    setCommuneInput(commune.nom);
    setShowSuggestions(false);
  }, [setCommuneCode]);

  const clearCommune = useCallback(() => {
    setCommuneCode('');
    setCommuneLabel('');
    setCommuneInput('');
    setCommuneSuggestions([]);
  }, [setCommuneCode]);

  // Tri : null | 'ca' | 'effectif'
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'

  const toggleSort = useCallback((field) => {
    if (sortField !== field) {
      // Nouvelle colonne → desc par défaut
      setSortField(field);
      setSortDir('desc');
    } else if (sortDir === 'desc') {
      // Même colonne, desc → asc
      setSortDir('asc');
    } else {
      // Même colonne, asc → off
      setSortField(null);
      setSortDir('desc');
    }
  }, [sortField, sortDir]);

  // Track les favoris ajoutés dans cette session
  const [addedSirens, setAddedSirens] = useState(new Set());

  const handleFavorite = async (prospect) => {
    if (!orgId || !user?.id) return;

    const score = scoringFn ? scoringFn(prospect) : 0;

    const result = await createProspect({
      ...prospect,
      score,
      org_id: orgId,
      created_by: user.id,
    });

    if (result?.duplicate) {
      toast.info('Déjà dans votre pipeline');
    } else if (result?.error) {
      toast.error('Erreur lors de l\'ajout');
      console.error('[SearchSirene] createProspect error:', result.error);
    } else {
      toast.success(`${prospect.raison_sociale} ajouté au pipeline`);
      setAddedSirens((prev) => new Set([...prev, prospect.siren]));
    }
  };

  const isAlreadyAdded = (siren) => existingSirens.has(siren) || addedSirens.has(siren);

  // La recherche se déclenche si query >= 2 OU si des codes NAF sont sélectionnés
  const hasSearchCriteria = query.length >= 2 || nafCodes.length > 0;

  // ── Tri (le filtrage commune est maintenant côté API) ──
  const displayResults = useMemo(() => {
    if (!sortField) return results;

    const list = [...results];
    list.sort((a, b) => {
      let va, vb;
      if (sortField === 'ca') {
        va = a.ca_annuel ?? -Infinity;
        vb = b.ca_annuel ?? -Infinity;
      } else if (sortField === 'effectif') {
        va = effectifSortValue(a._raw?.tranche_effectif_salarie);
        vb = effectifSortValue(b._raw?.tranche_effectif_salarie);
      }
      const diff = va - vb;
      return sortDir === 'desc' ? -diff : diff;
    });
    return list;
  }, [results, sortField, sortDir]);

  return (
    <div className="space-y-4">
      {/* Search bar + department */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une entreprise (nom, SIREN, activité...)"
            className="w-full pl-9 pr-4 py-2.5 border border-secondary-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#2196F3] focus:border-[#2196F3] outline-none"
          />
        </div>

        <div className="relative" ref={communeRef}>
          <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-secondary-400" />
          <input
            type="text"
            value={communeInput}
            onChange={(e) => {
              setCommuneInput(e.target.value);
              // Si l'utilisateur modifie le texte après sélection → reset le code
              if (communeLabel) {
                setCommuneLabel('');
                setCommuneCode('');
              }
            }}
            onFocus={() => communeSuggestions.length > 0 && setShowSuggestions(true)}
            placeholder="Ville..."
            className={`w-[180px] pl-8 ${communeLabel ? 'pr-8' : 'pr-3'} py-2.5 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#2196F3] focus:border-[#2196F3] outline-none transition-colors ${
              communeLabel ? 'border-[#2196F3] bg-blue-50/30' : 'border-secondary-300'
            }`}
          />
          {communeLabel && (
            <button
              type="button"
              onClick={clearCommune}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-secondary-200 transition-colors"
              title="Effacer la ville"
            >
              <X className="w-3.5 h-3.5 text-secondary-400" />
            </button>
          )}
          {showSuggestions && communeSuggestions.length > 0 && (
            <div className="absolute z-50 top-full mt-1 w-[260px] bg-white rounded-lg border border-secondary-200 shadow-lg py-1 max-h-[220px] overflow-y-auto">
              {communeSuggestions.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => selectCommune(c)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-secondary-50 transition-colors flex items-center justify-between gap-2"
                >
                  <span className="font-medium text-secondary-800">{c.nom}</span>
                  <span className="text-xs text-secondary-400 shrink-0">
                    {c.codesPostaux?.[0] || c.departement}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <select
          value={departement}
          onChange={(e) => setDepartement(e.target.value)}
          className="px-3 py-2.5 border border-secondary-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#2196F3] outline-none"
        >
          <option value="">Tous départements</option>
          {DEPARTEMENTS_COURANTS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </div>

      {/* NAF Selector */}
      <NafSelector
        selectedCodes={nafCodes}
        onChange={setNafCodes}
        module={module}
        defaultOpen={defaultNafCodes.length > 0}
      />

      {/* Results info */}
      {hasSearchCriteria && (
        <div className="flex items-center justify-between text-sm text-secondary-500">
          <span>
            {isSearching ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Recherche en cours...
              </span>
            ) : (
              `${totalResults} résultat${totalResults > 1 ? 's' : ''}${communeLabel ? ` à ${communeLabel}` : ''}${departement && !communeLabel ? ` (siège dép. ${departement})` : ''}`
            )}
          </span>
          {totalPages > 1 && (
            <span>Page {page} / {totalPages}</span>
          )}
        </div>
      )}

      {/* Results table */}
      {displayResults.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-secondary-200">
          <table className="w-full">
            <thead className="bg-secondary-50">
              <tr>
                <th className="w-10 px-2 py-2.5" />
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-secondary-500 uppercase">Entreprise</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-secondary-500 uppercase">NAF</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-secondary-500 uppercase">Commune</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-secondary-500 uppercase">Dép.</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-secondary-500 uppercase">Dirigeant</th>
                <th
                  className="px-3 py-2.5 text-left text-xs font-semibold text-secondary-500 uppercase cursor-pointer select-none hover:text-secondary-700 transition-colors"
                  onClick={() => toggleSort('effectif')}
                >
                  <span className="inline-flex items-center gap-1">
                    Effectif
                    <SortIcon field="effectif" active={sortField} dir={sortDir} />
                  </span>
                </th>
                <th
                  className="px-3 py-2.5 text-left text-xs font-semibold text-secondary-500 uppercase cursor-pointer select-none hover:text-secondary-700 transition-colors"
                  onClick={() => toggleSort('ca')}
                >
                  <span className="inline-flex items-center gap-1">
                    CA
                    <SortIcon field="ca" active={sortField} dir={sortDir} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-100">
              {displayResults.map((r) => {
                const added = isAlreadyAdded(r.siren);
                return (
                  <tr key={r.siren} className="hover:bg-secondary-50 transition-colors">
                    <td className="px-2 py-2.5 text-center">
                      {added ? (
                        <span title="Déjà ajouté">
                          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleFavorite(r)}
                          disabled={isCreating}
                          className="p-1 rounded hover:bg-[#F5C542]/20 transition-colors disabled:opacity-50"
                          title="Ajouter au pipeline"
                        >
                          <Star className="w-5 h-5 text-[#F5C542] hover:fill-[#F5C542] transition-colors" />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <a
                        href={`https://annuaire-entreprises.data.gouv.fr/entreprise/${r.siren}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1 text-sm font-medium text-secondary-900 hover:text-[#2196F3] transition-colors"
                        title="Voir la fiche RNE"
                      >
                        <span>{r.raison_sociale}</span>
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 text-[#2196F3] transition-opacity flex-shrink-0" />
                      </a>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-secondary-400">{r.siren}</span>
                        <ResultTags raw={r._raw} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-sm text-secondary-600">{r.naf || '—'}</p>
                      {r.naf && NAF_LABELS[r.naf] && (
                        <p className="text-xs text-secondary-400 truncate max-w-[160px]">{NAF_LABELS[r.naf]}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-secondary-600 truncate max-w-[120px]">{r.commune || '—'}</td>
                    <td className="px-3 py-2.5 text-sm text-secondary-600">{r.departement || '—'}</td>
                    <td className="px-3 py-2.5 text-sm text-secondary-700 truncate max-w-[130px]">
                      {r.dirigeant_nom
                        ? `${r.dirigeant_prenoms || ''} ${r.dirigeant_nom}`.trim()
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-secondary-600">{r.tranche_effectif_salarie || '—'}</td>
                    <td className="px-3 py-2.5 text-sm text-secondary-600">
                      {r.ca_annuel ? formatEuro(r.ca_annuel) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {hasSearchCriteria && !isSearching && displayResults.length === 0 && (
        <div className="text-center py-12">
          <AlertCircle className="w-8 h-8 text-secondary-300 mx-auto mb-2" />
          <p className="text-sm text-secondary-500">Aucun résultat pour « {query} »</p>
          <p className="text-xs text-secondary-400 mt-1">Essayez un autre terme ou modifiez les filtres</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={prevPage}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-secondary-300 rounded-lg hover:bg-secondary-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Précédent
          </button>
          <span className="text-sm text-secondary-500 px-2">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={nextPage}
            disabled={page >= totalPages}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-secondary-300 rounded-lg hover:bg-secondary-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Suivant
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Help text before search */}
      {!hasSearchCriteria && (
        <div className="text-center py-16">
          <Search className="w-10 h-10 text-secondary-200 mx-auto mb-3" />
          <p className="text-sm text-secondary-500">Recherchez par nom/SIREN ou sélectionnez des codes NAF ci-dessus</p>
          <p className="text-xs text-secondary-400 mt-1">Cochez des codes NAF pour lister toutes les entreprises d'un secteur</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// HELPERS — Tri
// ============================================================================

/** Mapping code tranche effectif → valeur numérique pour tri */
const EFFECTIF_ORDER = {
  NN: -1, '00': 0, '01': 1, '02': 3, '03': 6,
  '11': 10, '12': 20, '21': 50, '22': 100, '31': 200,
  '32': 250, '33': 500, '41': 1000, '42': 2000, '51': 5000, '52': 10000,
};

function effectifSortValue(code) {
  if (!code) return -1;
  return EFFECTIF_ORDER[code] ?? -1;
}

/** Icône de tri pour les colonnes */
function SortIcon({ field, active, dir }) {
  if (active !== field) {
    return <ArrowUpDown className="w-3 h-3 text-secondary-300" />;
  }
  return dir === 'desc'
    ? <ArrowDown className="w-3 h-3 text-[#2196F3]" />
    : <ArrowUp className="w-3 h-3 text-[#2196F3]" />;
}

// ============================================================================
// SUB-COMPONENT — ResultTags (badges utiles depuis les données API)
// ============================================================================

function ResultTags({ raw }) {
  if (!raw) return null;

  const tags = [];
  const complements = raw.complements || {};

  // RGE — Reconnu Garant de l'Environnement (très pertinent BTP)
  if (complements.est_rge) {
    tags.push({ label: 'RGE', color: 'bg-emerald-100 text-emerald-700', title: 'Reconnu Garant de l\'Environnement' });
  }

  // Qualiopi — Certification formation
  if (complements.est_qualiopi) {
    tags.push({ label: 'Qualiopi', color: 'bg-purple-100 text-purple-700', title: 'Certifié Qualiopi' });
  }

  // ESS — Économie Sociale et Solidaire
  if (complements.est_ess) {
    tags.push({ label: 'ESS', color: 'bg-sky-100 text-sky-700', title: 'Économie Sociale et Solidaire' });
  }

  // Société à mission
  if (complements.est_societe_mission) {
    tags.push({ label: 'Sté à mission', color: 'bg-indigo-100 text-indigo-700', title: 'Société à mission' });
  }

  // Entrepreneur individuel
  if (complements.est_entrepreneur_individuel) {
    tags.push({ label: 'EI', color: 'bg-secondary-100 text-secondary-600', title: 'Entrepreneur individuel' });
  }

  if (tags.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {tags.map((tag) => (
        <span
          key={tag.label}
          title={tag.title}
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none ${tag.color}`}
        >
          {tag.label}
        </span>
      ))}
    </span>
  );
}
