/**
 * LongTermTab.jsx - Majord'home Artisan
 * ============================================================================
 * Onglet "Suivi MT-LT" du Pipeline. Liste les leads basculés en projet long-terme.
 *
 * Caractéristiques :
 *  - Table simple, pas de Kanban
 *  - Tri par défaut : dernière interaction ASC (les plus négligés en haut)
 *  - Couleur ligne selon fraîcheur (🟢 <30j / 🟡 <60j / 🟠 <90j / 🔴 >90j)
 *  - Filtres : recherche + commercial + niveau de fraîcheur
 *  - Click ligne → ouvre le drawer dédié
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useState, useMemo, useEffect } from 'react';
import {
  Loader2,
  Search,
  X,
  RefreshCw,
  AlertTriangle,
  Hourglass,
  ChevronDown,
  CheckCircle2,
  UserCircle,
  Plus,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLongTermLeads, useLeadInteractionMutations } from '@hooks/useLeadInteractions';
import { useLeadCommercials } from '@hooks/useLeads';
import { formatEuro } from '@/lib/utils';
import { computeFreshness, formatShortDate } from './longTermUtils';
import { LongTermLeadDrawer } from './LongTermLeadDrawer';
import { AddInteractionModal } from './AddInteractionModal';

const FRESHNESS_FILTERS = [
  { value: 'all', label: 'Toutes les fraîcheurs' },
  { value: 'forgotten', label: '🔴 Oubliés > 90j' },
  { value: 'stale', label: '🟠 60-90j' },
  { value: 'medium', label: '🟡 30-60j' },
  { value: 'fresh', label: '🟢 < 30j' },
  { value: 'never', label: '⚪ Jamais relancés' },
];

function FilterDropdown({ value, onChange, options, icon: Icon, placeholder }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const hasValue = value && value !== 'all' && value !== '';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors min-h-[40px] ${
          hasValue ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
        }`}
      >
        {Icon && <Icon className="w-4 h-4" />}
        <span className="text-sm font-medium truncate max-w-[180px]">
          {selected?.label || placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-60 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 max-h-64 overflow-y-auto">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors ${
                  option.value === value ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span>{option.label}</span>
                {option.value === value && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function LongTermTab() {
  const { organization, user, effectiveRole } = useAuth();
  const orgId = organization?.id;
  const userId = user?.id;
  const canFilterCommercial = effectiveRole === 'org_admin' || effectiveRole === 'team_leader';

  const { commercials } = useLeadCommercials(orgId);
  const { leads, isLoading, refresh } = useLongTermLeads({ orgId });
  const { createInteraction, isCreating } = useLeadInteractionMutations();

  // Resoudre l'ID commercial du user connecté pour les filtres par défaut commercial
  const myCommercialId = useMemo(() => {
    if (effectiveRole !== 'commercial' || !userId) return null;
    return commercials.find((c) => c.profile_id === userId)?.id || null;
  }, [effectiveRole, userId, commercials]);

  const [search, setSearch] = useState('');
  const [freshnessFilter, setFreshnessFilter] = useState('all');
  const [commercialFilter, setCommercialFilter] = useState('');

  const [drawerLeadId, setDrawerLeadId] = useState(null);
  const [addInteractionLead, setAddInteractionLead] = useState(null);

  // Filtres et enrichissement (calcul fraîcheur)
  const enrichedLeads = useMemo(() => {
    return leads.map((l) => ({
      ...l,
      freshness: computeFreshness(l.last_interaction_at, l.long_term_started_at),
    }));
  }, [leads]);

  const filteredLeads = useMemo(() => {
    let out = enrichedLeads;

    // Filtrage commercial
    if (effectiveRole === 'commercial' && myCommercialId) {
      out = out.filter((l) => l.assigned_user_id === myCommercialId);
    } else if (canFilterCommercial && commercialFilter) {
      out = out.filter((l) => l.assigned_user_id === commercialFilter);
    }

    // Filtrage fraîcheur
    if (freshnessFilter !== 'all') {
      if (freshnessFilter === 'never') {
        out = out.filter((l) => !l.last_interaction_at);
      } else {
        out = out.filter((l) => l.freshness.level === freshnessFilter);
      }
    }

    // Recherche textuelle
    if (search.trim()) {
      const term = search.toLowerCase();
      out = out.filter((l) => {
        const fields = [l.first_name, l.last_name, l.email, l.phone, l.city, l.long_term_notes];
        return fields.some((f) => f && f.toLowerCase().includes(term));
      });
    }

    // Tri par fraîcheur croissante : les "oubliés" / "jamais relancés" en haut
    out = [...out].sort((a, b) => {
      const aRef = a.last_interaction_at || a.long_term_started_at;
      const bRef = b.last_interaction_at || b.long_term_started_at;
      // Les "jamais d'interaction" remontent en haut
      const aHasInter = !!a.last_interaction_at;
      const bHasInter = !!b.last_interaction_at;
      if (aHasInter !== bHasInter) return aHasInter ? 1 : -1;
      const aDate = aRef ? new Date(aRef).getTime() : 0;
      const bDate = bRef ? new Date(bRef).getTime() : 0;
      return aDate - bDate; // ASC : plus ancien en haut
    });

    return out;
  }, [enrichedLeads, freshnessFilter, commercialFilter, search, effectiveRole, myCommercialId, canFilterCommercial]);

  // Compteurs header
  const stats = useMemo(() => {
    const total = enrichedLeads.length;
    const forgotten = enrichedLeads.filter((l) => l.freshness.level === 'forgotten' || l.freshness.level === 'stale').length;
    return { total, forgotten };
  }, [enrichedLeads]);

  const drawerLead = useMemo(
    () => filteredLeads.find((l) => l.id === drawerLeadId) || enrichedLeads.find((l) => l.id === drawerLeadId) || null,
    [drawerLeadId, filteredLeads, enrichedLeads],
  );

  // Si le lead actif n'est plus dans la liste (devenu Gagné/Perdu/Réactivé), on ferme le drawer
  useEffect(() => {
    if (drawerLeadId && !leads.find((l) => l.id === drawerLeadId)) {
      setDrawerLeadId(null);
    }
  }, [leads, drawerLeadId]);

  const handleQuickAdd = async (input) => {
    if (!addInteractionLead) return;
    await createInteraction({ leadId: addInteractionLead.id, ...input });
    refresh();
  };

  const commercialOptions = useMemo(
    () => [
      { value: '', label: 'Tous les commerciaux' },
      ...commercials.map((c) => ({ value: c.id, label: c.full_name })),
    ],
    [commercials],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header : compteurs + filtres */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Hourglass className="h-5 w-5 text-purple-600" />
            <span className="text-sm text-gray-700">
              <strong>{stats.total}</strong> projet{stats.total !== 1 ? 's' : ''} en suivi
            </span>
          </div>
          {stats.forgotten > 0 && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200 text-xs font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              <strong>{stats.forgotten}</strong> oublié{stats.forgotten !== 1 ? 's' : ''} depuis &gt; 60j
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un lead…"
              className="pl-9 pr-9 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-w-[220px]"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {canFilterCommercial && (
            <FilterDropdown
              value={commercialFilter}
              onChange={setCommercialFilter}
              options={commercialOptions}
              icon={UserCircle}
              placeholder="Commercial"
            />
          )}

          <FilterDropdown
            value={freshnessFilter}
            onChange={setFreshnessFilter}
            options={FRESHNESS_FILTERS}
            placeholder="Fraîcheur"
          />

          <button
            onClick={refresh}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Table */}
      {filteredLeads.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Hourglass className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-3 text-base font-medium text-gray-900">
            {enrichedLeads.length === 0 ? 'Aucun projet MT-LT pour l\'instant' : 'Aucun résultat'}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {enrichedLeads.length === 0
              ? 'Cliquez sur "MT-LT" depuis une carte "Devis envoyé" pour commencer à suivre un projet long-terme.'
              : 'Modifiez les filtres pour voir d\'autres projets.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left font-medium text-gray-600 px-4 py-3">Client</th>
                  <th className="text-right font-medium text-gray-600 px-4 py-3 whitespace-nowrap">Montant</th>
                  <th className="text-left font-medium text-gray-600 px-4 py-3 whitespace-nowrap">Passé en MT-LT</th>
                  <th className="text-left font-medium text-gray-600 px-4 py-3 whitespace-nowrap">Dernière interaction</th>
                  <th className="text-left font-medium text-gray-600 px-4 py-3">Notes</th>
                  <th className="text-right font-medium text-gray-600 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((l) => {
                  const name = `${l.last_name || ''} ${l.first_name || ''}`.trim() || 'Sans nom';
                  const amount = l.order_amount_ht || l.estimated_revenue || 0;
                  return (
                    <tr
                      key={l.id}
                      onClick={() => setDrawerLeadId(l.id)}
                      className={`border-b border-gray-100 hover:bg-blue-50/30 cursor-pointer transition-colors ${l.freshness.rowClasses}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{name}</div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                          {l.city && <span>{l.city}</span>}
                          {l.source_name && (
                            <span className="inline-flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: l.source_color || '#9ca3af' }} />
                              {l.source_name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className={`font-semibold ${amount > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                          {formatEuro(amount)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {formatShortDate(l.long_term_started_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium ${l.freshness.classes}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${l.freshness.dot}`} />
                          {l.freshness.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-xs">
                        <p className="truncate" title={l.long_term_notes || ''}>
                          {l.long_term_notes || <span className="text-gray-300 italic">—</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setAddInteractionLead(l); }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                          title="Ajouter une interaction"
                        >
                          <Plus className="h-3 w-3" />
                          Interaction
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Drawer fiche MT-LT */}
      <LongTermLeadDrawer
        lead={drawerLead}
        isOpen={!!drawerLeadId && !!drawerLead}
        onClose={() => setDrawerLeadId(null)}
        onLeadUpdated={refresh}
      />

      {/* Modale ajout interaction rapide depuis la table */}
      <AddInteractionModal
        isOpen={!!addInteractionLead}
        onClose={() => setAddInteractionLead(null)}
        onConfirm={async (input) => {
          await handleQuickAdd(input);
          setAddInteractionLead(null);
        }}
        loading={isCreating}
      />
    </div>
  );
}

export default LongTermTab;
