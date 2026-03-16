/**
 * useModalManager.js - Majord'home
 * ============================================================================
 * Manages multiple named modal open/close states with associated data.
 *
 * Replaces the pattern of having N separate useState calls per modal:
 *   const [pendingLost, setPendingLost] = useState(null);
 *   const [pendingQuote, setPendingQuote] = useState(null);
 *   const [selectedItem, setSelectedItem] = useState(null);
 *
 * Usage:
 *   const modals = useModalManager();
 *
 *   // Open a modal with data
 *   modals.open('quote', { leadId, amount: 1200 });
 *
 *   // Check if a modal is open
 *   modals.isOpen('quote')  // true
 *
 *   // Get the data passed when opening
 *   modals.getData('quote') // { leadId, amount: 1200 }
 *
 *   // Close a modal
 *   modals.close('quote');
 *
 *   // Close all open modals at once
 *   modals.closeAll();
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useState, useCallback, useMemo } from 'react';

/**
 * Hook to manage multiple modal open/close states with associated data.
 *
 * @returns {{ open, close, closeAll, isOpen, getData }}
 */
export function useModalManager() {
  // State: { [modalName]: data | true }
  // A key is present iff the modal is open.
  const [state, setState] = useState({});

  /**
   * Open a modal by name, optionally passing associated data.
   * If data is omitted, defaults to `true` so isOpen still works.
   *
   * @param {string} name - Unique modal identifier
   * @param {*} [data=true] - Data to associate with this modal opening
   */
  const open = useCallback((name, data = true) => {
    setState((prev) => ({ ...prev, [name]: data }));
  }, []);

  /**
   * Close a modal by name, removing its data.
   *
   * @param {string} name - Modal identifier to close
   */
  const close = useCallback((name) => {
    setState((prev) => {
      if (!(name in prev)) return prev; // no-op if already closed
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  /**
   * Close all open modals at once.
   */
  const closeAll = useCallback(() => {
    setState({});
  }, []);

  /**
   * Check if a modal is currently open.
   *
   * @param {string} name - Modal identifier
   * @returns {boolean}
   */
  const isOpen = useCallback((name) => {
    return name in state;
  }, [state]);

  /**
   * Get the data associated with an open modal.
   * Returns `null` if the modal is not open.
   *
   * @param {string} name - Modal identifier
   * @returns {*|null}
   */
  const getData = useCallback((name) => {
    if (!(name in state)) return null;
    const val = state[name];
    // If opened without data (defaults to `true`), return null for consistency
    return val === true ? null : val;
  }, [state]);

  return useMemo(
    () => ({ open, close, closeAll, isOpen, getData }),
    [open, close, closeAll, isOpen, getData],
  );
}
