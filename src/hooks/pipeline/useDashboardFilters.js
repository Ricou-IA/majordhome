import { useState } from 'react';

export const useDashboardFilters = () => {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [filters, setFilters] = useState({
    period: { from: firstDay, to: lastDay },
    sourceIds: [],
    commercialId: null,
  });

  const updatePeriod = (period) => {
    setFilters((prev) => ({ ...prev, period }));
  };

  const updateSourceIds = (sourceIds) => {
    setFilters((prev) => ({ ...prev, sourceIds }));
  };

  const updateCommercialId = (commercialId) => {
    setFilters((prev) => ({ ...prev, commercialId }));
  };

  const resetFilters = () => {
    setFilters({
      period: { from: firstDay, to: lastDay },
      sourceIds: [],
      commercialId: null,
    });
  };

  return {
    filters,
    updatePeriod,
    updateSourceIds,
    updateCommercialId,
    resetFilters,
  };
};
