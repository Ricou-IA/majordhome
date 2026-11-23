/**
 * LongTermTab.jsx - Majord'home Artisan
 * ============================================================================
 * Onglet "Suivi MT-LT" du Pipeline. Liste les leads basculés en projet long-terme.
 *
 * Caractéristiques :
 *  - Bande de repères (projets suivis, sans contact, jamais relancés, montant)
 *  - Table dense, tri par défaut : les plus négligés en haut
 *  - L'ancienneté du dernier contact est écrite en jours ; au-delà de 60 jours elle
 *    est en gras ambre (le texte porte l'information, pas la couleur seule)
 *  - Filtres : recherche + commercial + ancienneté du dernier contact
 *  - Click ligne → ouvre le drawer dédié
 *
 * @version 2.0.0 - Présentation alignée sur le Dashboard du pipeline
 * ============================================================================
 */

import { useState, useMemo, useEffect } from 'react';
import { Loader2, Search, X, RefreshCw, Hourglass, ChevronDown, Check, UserCircle, Plus, Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLongTermLeads, useLeadInteractionMutations } from '@hooks/useLeadInteractions';
import { useLeadCommercials } from '@hooks/useLeads';
import { useKanbanCards } from '@hooks/useKanbanCards';
import { formatEuroCeil, cn } from '@/lib/utils';
import { StatStrip } from '@/apps/artisan/components/shared/StatStrip';
import { Th, Td } from '@components/pipeline/dashboard/Tableau';
import { computeFreshness, formatShortDate } from './longTermUtils';
import { LongTermLeadDrawer } from './LongTermLeadDrawer';
import { AddInteractionModal } from './AddInteractionModal';

const FRESHNESS_FILTERS = [
  { value: 'all', label: 'Tous les délais' },
  { value: 'forgotten', label: 'Sans contact depuis plus de 90 j' },
  { value: 'stale', label: 'Sans contact depuis 60 à 90 j' },
  { value: 'medium', label: 'Sans contact depuis 30 à 60 j' },
  { value: 'fresh', label: 'Contact de moins de 30 j' },
  { value: 'never', label: 'Jamais relancés' },
];

/** Niveaux de fraîcheur « négligés » : plus de 60 jours sans contact. */
const NEGLIGES = new Set(['stale', 'forgotten']);

function FilterDropdown({ value, onChange, options, icon: Icon, placeholder }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const hasValue = value && value !== 'all';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          hasValue
            ? 'border-primary-200 bg-primary-50 text-primary-800'
            : 'border-secondary-200 bg-white text-secondary-700 hover:bg-secondary-50',
        )}
      >
        {Icon && <Icon className="h-4 w-4" />}
        <span className="max-w-[200px] truncate">{selected?.label || placeholder}</span>
        <ChevronDown className={cn('h-4 w-4 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-md border border-secondary-200 bg-white py-1 shadow-md">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
                  option.value === value ? 'bg-primary-50 text-primary-800' : 'text-secondary-700 hover:bg-secondary-50',
                )}
              >
                <span>{option.label}</span>
                {option.value === value && <Check className="h-4 w-4 shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Ancienneté du dernier contact : le nombre de jours, puis ce qu'il mesure. */
function DernierContact({ lead }) {
  const { freshness } = lead;
  if (freshness.days === null) return <span className="text-secondary-400">—</span>;
  const depuis = freshness.days === 0 ? 'aujourd’hui' : `il y a ${freshness.days} j`;
  return (
    <>
      <span className={NEGLIGES.has(freshness.level) ? 'font-semibold text-amber-700' : 'text-secondary-800'}>
        {depuis}
      </span>
      {!freshness.hasInteraction && (
        <span className="ml-1.5 text-xs text-secondary-500">jamais relancé</span>
      )}
    </>
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

  const commercialNames = useMemo(() => new Map(commercials.map((c) => [c.id, c.full_name])), [commercials]);

  const [search, setSearch] = useState('');
  const [freshnessFilter, setFreshnessFilter] = useState('all');
  const [commercialFilter, setCommercialFilter] = useState('');

  const [drawerLeadId, setDrawerLeadId] = useState(null);
  const [addInteractionLead, setAddInteractionLead] = useState(null);

  // Le suivi MT-LT est une VUE, pas un statut : un projet que Pennylane a classé
  // (devis accepté → Gagné, tous refusés → Perdu) sort de la liste tout seul et
  // apparaît dans la colonne correspondante du board. Source unique = la vue des
  // cartes (même placement que le Kanban). Sans devis PL : statut classique final.
  // Rien n'est écrit : un devis renvoyé (à nouveau en attente) ramène le projet.
  const { cards } = useKanbanCards();
  const classifiedLeadIds = useMemo(() => {
    const ids = new Set();
    cards.forEach((c) => {
      if (c.column_key === 'gagne' || c.column_key === 'perdu') ids.add(c.lead_id);
    });
    return ids;
  }, [cards]);

  // Filtres et enrichissement (calcul fraîcheur)
  const enrichedLeads = useMemo(() => {
    return leads
      .filter((l) => !classifiedLeadIds.has(l.id) && !['Gagné', 'Perdu'].includes(l.status_label))
      .map((l) => ({
        ...l,
        freshness: computeFreshness(l.last_interaction_at, l.long_term_started_at),
      }));
  }, [leads, classifiedLeadIds]);

  // Le périmètre de l'utilisateur : un commercial ne voit que ses projets
  const scopedLeads = useMemo(() => {
    if (effectiveRole === 'commercial' && myCommercialId) {
      return enrichedLeads.filter((l) => l.assigned_user_id === myCommercialId);
    }
    if (canFilterCommercial && commercialFilter) {
      return enrichedLeads.filter((l) => l.assigned_user_id === commercialFilter);
    }
    return enrichedLeads;
  }, [enrichedLeads, effectiveRole, myCommercialId, canFilterCommercial, commercialFilter]);

  const filteredLeads = useMemo(() => {
    let out = scopedLeads;

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
  }, [scopedLeads, freshnessFilter, search]);

  // Repères de la bande : sur le périmètre de l'utilisateur, avant recherche et filtre d'ancienneté
  const stats = useMemo(() => ({
    total: scopedLeads.length,
    negliges: scopedLeads.filter((l) => NEGLIGES.has(l.freshness.level)).length,
    jamais: scopedLeads.filter((l) => !l.last_interaction_at).length,
    montant: scopedLeads.reduce((s, l) => s + (Number(l.order_amount_ht) || Number(l.estimated_revenue) || 0), 0),
  }), [scopedLeads]);

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
        <Loader2 className="h-6 w-6 animate-spin text-secondary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StatStrip
        items={[
          { key: 'total', label: 'Projets en suivi', value: stats.total.toLocaleString('fr-FR') },
          {
            key: 'negliges',
            label: 'Sans contact depuis plus de 60 j',
            value: stats.negliges.toLocaleString('fr-FR'),
            sub: stats.total > 0 ? `${Math.round((stats.negliges / stats.total) * 100)} % des projets` : null,
          },
          { key: 'jamais', label: 'Jamais relancés', value: stats.jamais.toLocaleString('fr-FR'), sub: 'depuis leur mise en suivi' },
          { key: 'montant', label: 'Montant suivi HT', value: formatEuroCeil(stats.montant) },
        ]}
      />

      {/* Filtres */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="relative mr-auto">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un projet…"
            aria-label="Rechercher un projet"
            className="h-9 w-64 rounded-md border border-secondary-200 bg-white pl-9 pr-9 text-sm text-secondary-900 placeholder:text-secondary-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Effacer la recherche"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-secondary-400 hover:text-secondary-600"
            >
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
          icon={Clock}
          placeholder="Dernier contact"
        />

        <button
          type="button"
          onClick={refresh}
          className="rounded-md p-2 text-secondary-500 hover:bg-secondary-100 hover:text-secondary-700"
          title="Rafraîchir"
          aria-label="Rafraîchir"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Table */}
      {filteredLeads.length === 0 ? (
        <div className="rounded-lg border border-secondary-200 bg-white px-6 py-12 text-center">
          <Hourglass className="mx-auto h-8 w-8 text-secondary-300" />
          <h3 className="mt-3 text-sm font-semibold text-secondary-900">
            {enrichedLeads.length === 0 ? 'Aucun projet en suivi des objectifs' : 'Aucun projet ne correspond'}
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-secondary-500">
            {enrichedLeads.length === 0
              ? 'Le sablier d’une carte du tableau (Nouveau, Contacté, RDV planifié ou Devis envoyé) fait passer un lead en suivi des objectifs.'
              : 'Modifiez la recherche ou les filtres pour voir d’autres projets.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-secondary-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-secondary-200 bg-secondary-50">
                <tr>
                  <Th gauche>Client</Th>
                  <Th gauche>Commercial</Th>
                  <Th>Montant HT</Th>
                  <Th gauche>En suivi depuis</Th>
                  <Th gauche>Dernier contact</Th>
                  <Th gauche className="w-full">Notes</Th>
                  <Th><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {filteredLeads.map((l) => {
                  const name = `${l.last_name || ''} ${l.first_name || ''}`.trim() || 'Sans nom';
                  const amount = Number(l.order_amount_ht) || Number(l.estimated_revenue) || 0;
                  return (
                    <tr
                      key={l.id}
                      onClick={() => setDrawerLeadId(l.id)}
                      className="cursor-pointer transition-colors hover:bg-secondary-50/60"
                    >
                      <Td gauche>
                        <div className="font-medium text-secondary-900">{name}</div>
                        <div className="mt-0.5 text-xs font-normal text-secondary-500">
                          {[l.city, l.source_name].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </Td>
                      <Td gauche className="text-secondary-700">
                        {commercialNames.get(l.assigned_user_id) || <span className="text-secondary-400">—</span>}
                      </Td>
                      <Td>{amount > 0 ? formatEuroCeil(amount) : <span className="text-secondary-400">—</span>}</Td>
                      <Td gauche className="text-secondary-700">{formatShortDate(l.long_term_started_at)}</Td>
                      <Td gauche><DernierContact lead={l} /></Td>
                      <Td gauche className="max-w-0 whitespace-normal">
                        <p className="truncate text-secondary-600" title={l.long_term_notes || ''}>
                          {l.long_term_notes || <span className="text-secondary-300">—</span>}
                        </p>
                      </Td>
                      <Td>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setAddInteractionLead(l); }}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                          title="Noter une interaction"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Interaction
                        </button>
                      </Td>
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
