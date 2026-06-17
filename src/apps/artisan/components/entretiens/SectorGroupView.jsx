/**
 * SectorGroupView.jsx - Vue contrats groupés par grand secteur (Programmation)
 * ============================================================================
 * Affiche les contrats groupés par grand secteur géographique (regroupement de
 * codes postaux proches, nommé par sa ville principale), dépliables, avec la
 * commune réelle de chaque client sur sa ligne.
 *
 * Sprint 8 — Enrichissements :
 *   - Filtre par mois de référence (maintenance_month)
 *   - CTA « Planifier » par contrat → crée un entretien à planifier
 *   - CTA « Planifier le grand secteur » bulk → crée pour tous les contrats
 *
 * @version 4.0.0 - Grands secteurs géographiques (2 niveaux)
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import {
  MapPin,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Check,
  Clock,
  Calendar,
  Loader2,
  Map as MapIcon,
  MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { VisitBadge } from './VisitBadge';
import { SearchBar } from '../shared/SearchBar';

// ============================================================================
// CONSTANTES
// ============================================================================

const MONTHS = [
  { value: 1, label: 'Janvier' },
  { value: 2, label: 'Février' },
  { value: 3, label: 'Mars' },
  { value: 4, label: 'Avril' },
  { value: 5, label: 'Mai' },
  { value: 6, label: 'Juin' },
  { value: 7, label: 'Juillet' },
  { value: 8, label: 'Août' },
  { value: 9, label: 'Septembre' },
  { value: 10, label: 'Octobre' },
  { value: 11, label: 'Novembre' },
  { value: 12, label: 'Décembre' },
];

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

function GrandSecteurHeader({ group, isExpanded, onToggle, canPlan, onPlanGroup, isPlanningDisabled, plannableCount }) {
  const completionPct =
    group.totalContracts > 0 ? Math.round((group.visitsDone / group.totalContracts) * 100) : 0;
  const isNonLocalise = group.id === 'non-localise';

  return (
    <div className="flex items-center gap-1 bg-gray-50">
      <button onClick={onToggle} className="flex-1 flex items-center gap-3 px-4 py-3 text-left min-w-0">
        <div className="flex-shrink-0 text-gray-400">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <MapPin className={`h-4 w-4 flex-shrink-0 ${isNonLocalise ? 'text-gray-400' : 'text-indigo-500'}`} />
          <span className="font-semibold text-gray-900 truncate uppercase">{group.name}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">
            {group.totalContracts} contrat{group.totalContracts > 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${completionPct}%` }} />
            </div>
            <span className="text-xs text-gray-500 w-8 text-right">{completionPct}%</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {group.visitsDone}
            </span>
            <span className="text-gray-300">|</span>
            <span className="inline-flex items-center gap-1 text-amber-600">
              <Clock className="h-3.5 w-3.5" />
              {group.visitsPending}
            </span>
          </div>
        </div>
      </button>

      {canPlan && plannableCount > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onPlanGroup?.(group); }}
          disabled={isPlanningDisabled}
          className="mr-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-50 flex-shrink-0"
          title={`Programmer ${plannableCount} entretien${plannableCount > 1 ? 's' : ''} sur ce grand secteur`}
        >
          <Calendar className="h-3.5 w-3.5" />
          Planifier le grand secteur ({plannableCount})
        </button>
      )}
    </div>
  );
}

function ContractRow({
  contract,
  onContractClick,
  canPlan,
  onPlanContract,
  isPlanningDisabled,
  isAlreadyPlanned,
  remindedClientIds,
  onSendReminder,
  canSendReminder,
}) {
  // Statut visite : basé sur current_year_visit_status (visite année en cours)
  const visitStatus =
    contract.current_year_visit_status === 'completed' ? 'completed' : 'pending';

  // Traité pour l'année = entretien en cours OU visite effectuée
  const isDone = isAlreadyPlanned || visitStatus === 'completed';

  // Mois de référence
  const monthLabel = contract.maintenance_month
    ? MONTHS.find((m) => m.value === contract.maintenance_month)?.label
    : null;

  // Bulle SMS : visible uniquement quand le contrat est « à planifier »
  // (même condition que le bouton « Planifier » — jamais sur une ligne grisée).
  const canShowReminder =
    canSendReminder && !isAlreadyPlanned && visitStatus !== 'completed';
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsSent, setSmsSent] = useState(
    remindedClientIds?.has(contract.client_id) ?? false,
  );

  const handleReminderClick = async (e) => {
    e.stopPropagation();
    if (smsLoading || smsSent) return;
    setSmsLoading(true);
    const { error } = await onSendReminder(contract);
    setSmsLoading(false);
    if (error) {
      toast.error(error.message || 'Échec de l\'envoi du SMS');
    } else {
      setSmsSent(true);
      toast.success('Rappel envoyé par SMS');
    }
  };

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 pl-11 transition-colors group ${
        isDone ? 'opacity-50 bg-gray-50' : 'hover:bg-gray-100'
      }`}
    >
      {/* Nom (cliquable) */}
      <span
        onClick={() => onContractClick?.(contract)}
        className="font-medium text-gray-900 truncate flex-1 min-w-0 cursor-pointer hover:text-blue-600 transition-colors"
      >
        {contract.client_name || 'Sans nom'}
      </span>

      {/* Commune réelle du client */}
      {contract.client_city && (
        <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:inline">
          {contract.client_city}
        </span>
      )}

      {/* Mois de référence */}
      {monthLabel && (
        <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:inline">
          {monthLabel}
        </span>
      )}

      {/* Tarif */}
      {contract.amount ? (
        <span className="text-xs font-medium text-blue-700 flex-shrink-0">
          {new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0,
          }).format(contract.amount)}
        </span>
      ) : null}

      {/* Badge visite */}
      <VisitBadge status={visitStatus} />

      {/* Bulle SMS rappel — uniquement « à planifier » */}
      {canShowReminder && (
        <button
          onClick={handleReminderClick}
          disabled={smsLoading || smsSent}
          title={
            smsSent
              ? 'Rappel déjà envoyé cette année'
              : 'Envoyer un rappel d\'entretien par SMS'
          }
          className={`inline-flex items-center justify-center p-1.5 rounded border transition-colors flex-shrink-0 ${
            smsSent
              ? 'border-green-300 text-green-600 bg-green-50'
              : 'border-gray-300 text-gray-600 bg-white hover:bg-teal-50 hover:border-teal-400 hover:text-teal-700'
          } disabled:opacity-60`}
        >
          {smsLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : smsSent ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5" />
          )}
        </button>
      )}

      {/* CTA Planifier / badge Planifié / rien (si visite déjà effectuée) */}
      {canPlan &&
        (isAlreadyPlanned ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded flex-shrink-0">
            <CheckCircle2 className="h-3 w-3" />
            Planifié
          </span>
        ) : visitStatus === 'completed' ? null : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlanContract?.(contract);
            }}
            disabled={isPlanningDisabled}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-all disabled:opacity-50 flex-shrink-0"
            title="Programmer un entretien"
          >
            <Calendar className="h-3 w-3" />
            Planifier
          </button>
        ))}
    </div>
  );
}

function SectorContracts({
  contracts,
  onContractClick,
  canPlan,
  onPlanContract,
  isPlanningDisabled,
  plannedContractIds,
  remindedClientIds,
  onSendReminder,
  canSendReminder,
}) {
  return (
    <div className="bg-white border-t border-gray-100">
      <div className="divide-y divide-gray-100">
        {contracts.map((contract) => (
          <ContractRow
            key={contract.id}
            contract={contract}
            onContractClick={onContractClick}
            canPlan={canPlan}
            onPlanContract={onPlanContract}
            isPlanningDisabled={isPlanningDisabled}
            isAlreadyPlanned={plannedContractIds?.has(contract.id) ?? false}
            remindedClientIds={remindedClientIds}
            onSendReminder={onSendReminder}
            canSendReminder={canSendReminder}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function SectorGroupView({
  sectors,
  isLoading,
  onContractClick,
  onPlanContract,
  onPlanSector,
  isPlanningDisabled = false,
  canPlan = false,
  plannedContractIds,
  remindedClientIds,
  onSendReminder,
  canSendReminder = false,
}) {
  const [selectedMonth, setSelectedMonth] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());

  // Filtrer par mois de référence + recherche full-text
  const filteredSectors = useMemo(() => {
    if (!sectors) return [];

    const monthValue = selectedMonth ? parseInt(selectedMonth, 10) : null;
    const query = searchQuery.trim().toLowerCase();

    return sectors
      .map((sector) => {
        let filtered = sector.contracts;

        if (monthValue) {
          filtered = filtered.filter((c) => c.maintenance_month === monthValue);
        }

        if (query) {
          filtered = filtered.filter((c) => {
            const haystack = [
              c.client_name,
              c.client_first_name,
              c.client_phone,
              c.client_email,
              c.client_address,
              c.contract_number,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return haystack.includes(query);
          });
        }

        const visitsDone = filtered.filter(
          (c) => c.current_year_visit_status === 'completed',
        ).length;

        return {
          ...sector,
          contracts: filtered,
          totalContracts: filtered.length,
          visitsDone,
          visitsPending: filtered.length - visitsDone,
        };
      })
      .filter((s) => s.contracts.length > 0);
  }, [sectors, selectedMonth, searchQuery]);

  // Regrouper les contrats filtrés sous leur grand secteur (2 niveaux : grand
  // secteur → clients). Le code postal n'est plus un niveau de l'arborescence ;
  // la commune réelle est portée par chaque ligne client.
  const grandSecteurs = useMemo(() => {
    const map = new Map();
    for (const s of filteredSectors) {
      const key = s.grandSecteurId || 'non-localise';
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: s.grandSecteurName || 'Non localisé',
          order: s.grandSecteurOrder ?? 9999,
          contracts: [],
          totalContracts: 0,
          visitsDone: 0,
          visitsPending: 0,
        });
      }
      const g = map.get(key);
      g.contracts.push(...s.contracts);
      g.totalContracts += s.totalContracts;
      g.visitsDone += s.visitsDone;
      g.visitsPending += s.visitsPending;
    }
    const groups = [...map.values()];
    // Tri des clients par commune puis nom → les clients d'une même ville restent groupés
    for (const g of groups) {
      g.contracts.sort(
        (a, b) =>
          (a.client_city || '').localeCompare(b.client_city || '') ||
          (a.client_name || '').localeCompare(b.client_name || ''),
      );
    }
    return groups.sort(
      (a, b) =>
        (a.id === 'non-localise' ? 1 : 0) - (b.id === 'non-localise' ? 1 : 0) ||
        a.order - b.order ||
        b.visitsPending - a.visitsPending ||
        a.name.localeCompare(b.name),
    );
  }, [filteredSectors]);

  const toggleGroup = (id) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setCollapsedGroups(new Set());
  const collapseAll = () => setCollapsedGroups(new Set(grandSecteurs.map((g) => g.id)));

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-12 bg-white rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!sectors || sectors.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <MapIcon className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-700 font-medium">Aucun secteur trouvé</p>
        <p className="text-sm text-gray-500 mt-1">
          Les contrats seront groupés par grand secteur géographique ici.
        </p>
      </div>
    );
  }

  // Stats globales (calculées sur les secteurs filtrés)
  const totalContracts = filteredSectors.reduce((s, sec) => s + sec.totalContracts, 0);
  const totalDone = filteredSectors.reduce((s, sec) => s + sec.visitsDone, 0);
  const totalPending = filteredSectors.reduce((s, sec) => s + sec.visitsPending, 0);

  return (
    <div className="space-y-4">
      {/* Barre de recherche */}
      <SearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Rechercher par nom, prénom, téléphone, email, adresse..."
        className="max-w-xl"
      />

      {/* Header stats + filtre mois + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            <strong>{grandSecteurs.length}</strong> secteur
            {grandSecteurs.length > 1 ? 's' : ''}
          </span>
          <span className="text-gray-300">|</span>
          <span>
            <strong>{totalContracts}</strong> contrat{totalContracts > 1 ? 's' : ''}
          </span>
          <span className="text-gray-300">|</span>
          <span className="text-green-600">
            <strong>{totalDone}</strong> fait{totalDone > 1 ? 's' : ''}
          </span>
          <span className="text-gray-300">|</span>
          <span className="text-amber-600">
            <strong>{totalPending}</strong> à faire
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Filtre mois de référence */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="">Tous les mois</option>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Expand/collapse */}
          <div className="flex gap-2">
            <button
              onClick={expandAll}
              className="text-xs text-blue-600 hover:underline"
            >
              Tout déplier
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={collapseAll}
              className="text-xs text-blue-600 hover:underline"
            >
              Tout replier
            </button>
          </div>
        </div>
      </div>

      {/* Message si filtre actif et aucun résultat */}
      {(selectedMonth || searchQuery.trim()) && filteredSectors.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Calendar className="h-8 w-8 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">
            Aucun contrat trouvé
            {selectedMonth && (
              <> pour le mois <strong>{MONTHS.find((m) => m.value === parseInt(selectedMonth))?.label}</strong></>
            )}
            {searchQuery.trim() && (
              <> correspondant à « <strong>{searchQuery.trim()}</strong> »</>
            )}
          </p>
        </div>
      )}

      {/* Liste des grands secteurs → clients */}
      {grandSecteurs.length > 0 && (
        <div className="space-y-3">
          {grandSecteurs.map((group) => {
            const isGroupExpanded = searchQuery.trim() ? true : !collapsedGroups.has(group.id);
            const groupPlannable = group.contracts.filter(
              (c) => !plannedContractIds?.has(c.id) && c.current_year_visit_status !== 'completed',
            ).length;
            return (
              <div key={group.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <GrandSecteurHeader
                  group={group}
                  isExpanded={isGroupExpanded}
                  onToggle={() => toggleGroup(group.id)}
                  canPlan={canPlan}
                  onPlanGroup={(g) =>
                    onPlanSector?.({
                      codePostal: g.name,
                      contracts: g.contracts.filter(
                        (c) =>
                          !plannedContractIds?.has(c.id) &&
                          c.current_year_visit_status !== 'completed',
                      ),
                    })
                  }
                  isPlanningDisabled={isPlanningDisabled}
                  plannableCount={groupPlannable}
                />
                {isGroupExpanded && (
                  <SectorContracts
                    contracts={group.contracts}
                    onContractClick={onContractClick}
                    canPlan={canPlan}
                    onPlanContract={onPlanContract}
                    isPlanningDisabled={isPlanningDisabled}
                    plannedContractIds={plannedContractIds}
                    remindedClientIds={remindedClientIds}
                    onSendReminder={onSendReminder}
                    canSendReminder={canSendReminder}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SectorGroupView;
