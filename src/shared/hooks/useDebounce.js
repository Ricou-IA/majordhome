/**
 * useDebounce.js — Hook utilitaire de debounce
 * ============================================================================
 * Remplace les implémentations manuelles de debounce dupliquées dans
 * useClientSearch, useLeadSearch, useDuplicateCheck, etc.
 * ============================================================================
 */

import { useState, useEffect } from 'react';

/**
 * Retourne une valeur debounced qui ne se met à jour qu'après le délai
 *
 * @param {*} value - Valeur à debouncer
 * @param {number} [delay=300] - Délai en ms
 * @returns {*} Valeur debounced
 */
export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
