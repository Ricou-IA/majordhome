/**
 * CommercialPipeline.jsx — Page principale module Prospection Commerciale
 * Tabs : Pipeline (table + KPIs) | Screener (recherche SIRENE)
 */

import { useState, useCallback } from 'react';
import { Target, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { useProspects, useProspectStats } from '@hooks/useProspects';
import { computeScoreCommercial } from '../_shared/lib/scoringCommercial';
import { COMMERCIAL_NAF_CODES, COMMERCIAL_DEPARTEMENTS, COMMERCIAL_STATUSES, COMMERCIAL_TRANSITIONS } from './config';
import ProspectKPIs from '../_shared/components/ProspectKPIs';
import ProspectFilters from '../_shared/components/ProspectFilters';
import ProspectTable from '../_shared/components/ProspectTable';
import ProspectDrawer from '../_shared/components/ProspectDrawer';
import SearchSireneModal from '../_shared/components/SearchSireneModal';

const TABS = [
  { key: 'pipeline', label: 'Pipeline', icon: Target },
  { key: 'screener', label: 'Screener', icon: Search },
];

export default function CommercialPipeline() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const navigate = useNavigate();

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
  } = useProspects({ orgId, module: 'commercial' });

  const { stats, isLoading: statsLoading } = useProspectStats(orgId, 'commercial');

  // Scoring wrapper avec config
  const scoringFn = useCallback((prospect) => {
    return computeScoreCommercial(prospect, {
      targetNaf: COMMERCIAL_NAF_CODES,
      targetDepartements: COMMERCIAL_DEPARTEMENTS,
    });
  }, []);

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

  const handleConverted = useCallback((client) => {
    setDrawerOpen(false);
    if (client?.id) {
      navigate(`/clients/${client.id}`);
    }
  }, [navigate]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Prospection</h1>
          <p className="text-sm text-secondary-500 mt-1">
            Prospection commerciale · {totalCount} prospect{totalCount > 1 ? 's' : ''}
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
          <ProspectKPIs stats={stats} module="commercial" isLoading={statsLoading} />
          <ProspectFilters
            filters={filters}
            onChange={setFilters}
            module="commercial"
            statuses={COMMERCIAL_STATUSES}
          />
          <ProspectTable
            prospects={prospects}
            statuses={COMMERCIAL_STATUSES}
            module="commercial"
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
          module="commercial"
          defaultNafCodes={COMMERCIAL_NAF_CODES}
          defaultDepartements={COMMERCIAL_DEPARTEMENTS}
          scoringFn={scoringFn}
        />
      )}

      {/* Drawer */}
      <ProspectDrawer
        prospectId={selectedProspectId}
        isOpen={drawerOpen}
        onClose={handleDrawerClose}
        module="commercial"
        statuses={COMMERCIAL_STATUSES}
        transitions={COMMERCIAL_TRANSITIONS}
        onDeleted={handleDrawerClose}
        onConverted={handleConverted}
      />
    </div>
  );
}
