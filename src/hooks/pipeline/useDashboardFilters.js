import { useState } from 'react';

// Format: 'YYYY-MM'
const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export const useDashboardFilters = () => {
  const [filters, setFilters] = useState({
    months: [getCurrentMonth()],
    sourceIds: [],
  });

  const updateMonths = (months) => {
    setFilters((prev) => ({ ...prev, months }));
  };

  const updateSourceIds = (sourceIds) => {
    setFilters((prev) => ({ ...prev, sourceIds }));
  };

  const resetFilters = () => {
    setFilters({
      months: [getCurrentMonth()],
      sourceIds: [],
    });
  };

  return {
    filters,
    updateMonths,
    updateSourceIds,
    resetFilters,
  };
};
