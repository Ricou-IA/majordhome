/**
 * CedantsPipeline.jsx — Page principale module Cédants
 * Tabs : Pipeline (table + KPIs) | Screener (recherche SIRENE)
 */

import { useState, useCallback } from 'react';
import { Factory, Search } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useProspects, useProspectStats } from '@hooks/useProspects';
import { computeScoreCedants } from '../_shared/lib/scoringCedants';
import { CEDANTS_NAF_CODES, CEDANTS_DEPARTEMENTS, CEDANTS_STATUSES, CEDANTS_TRANSITIONS } from './config';
import ProspectKPIs from '../_shared/components/ProspectKPIs';
import ProspectFilters from '../_shared/components/ProspectFilters';
import ProspectTable from '../_shared/components/ProspectTable';
import ProspectDrawer from '../_shared/components/ProspectDrawer';
import SearchSireneModal from '../_shared/components/SearchSireneModal';

const TABS = [
  { key: 'pipeline', label: 'Pipeline', icon: Factory },
  { key: 'screener', label: 'Screener', icon: Search },
];

export default function CedantsPipeline() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const [activeTab, setActiveTab] = useState('pipeline');
  const [selectedProspectId, setSelectedProspectId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Hooks data
  const {
    prospects,
    isLoading,
    filters,
    setFilters,
    totalCount,
    hasMore,
    loadMore,
  } = useProspects({ orgId, module: 'cedants' });

  const { stats, isLoading: statsLoading } = useProspectStats(orgId, 'cedants');

  // Handlers
  const handleRowClick = useCallback((prospect) => {
    setSelectedProspectId(prospect.id);
    setDrawerOpen(true);
  }, []);

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setSelectedProspectId(null);
  }, []);

  const handleSort = useCallback((field) => {
    setFilters((prev) => ({
      ...prev,
      orderBy: field,
      ascending: prev.orderBy === field ? !prev.ascending : false,
    }));
  }, [setFilters]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Cédants</h1>
          <p className="text-sm text-secondary-500 mt-1">
            Prospection acquisition · {totalCount} prospect{totalCount > 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-secondary-200">
        <nav className="flex gap-4" aria-label="Tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-2 px-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-[#2196F3] text-[#2196F3]'
                    : 'border-transparent text-secondary-500 hover:text-secondary-700 hover:border-secondary-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'pipeline' && (
        <div className="space-y-4">
          <ProspectKPIs stats={stats} module="cedants" isLoading={statsLoading} />
          <ProspectFilters
            filters={filters}
            onChange={setFilters}
            module="cedants"
            statuses={CEDANTS_STATUSES}
          />
          <ProspectTable
            prospects={prospects}
            statuses={CEDANTS_STATUSES}
            module="cedants"
            isLoading={isLoading}
            onRowClick={handleRowClick}
            onSort={handleSort}
            sortField={filters.orderBy}
            sortAsc={filters.ascending}
          />
          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                className="px-4 py-2 text-sm text-[#2196F3] hover:bg-[#2196F3]/10 rounded-lg transition-colors"
              >
                Charger plus...
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'screener' && (
        <SearchSireneModal
          module="cedants"
          defaultNafCodes={CEDANTS_NAF_CODES}
          defaultDepartements={CEDANTS_DEPARTEMENTS}
          scoringFn={computeScoreCedants}
        />
      )}

      {/* Drawer */}
      <ProspectDrawer
        prospectId={selectedProspectId}
        isOpen={drawerOpen}
        onClose={handleDrawerClose}
        module="cedants"
        statuses={CEDANTS_STATUSES}
        transitions={CEDANTS_TRANSITIONS}
        onDeleted={handleDrawerClose}
      />
    </div>
  );
}
