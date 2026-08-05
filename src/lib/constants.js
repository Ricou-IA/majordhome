/**
 * constants.js — Constantes globales partagées
 * ============================================================================
 * Centralise les valeurs utilisées à travers les services et hooks.
 * ============================================================================
 */

// Pagination
export const DEFAULT_PAGE_SIZE = 25;
export const LARGE_PAGE_SIZE = 50;
export const KANBAN_PAGE_SIZE = 200;

// Pipeline commercial
// Seuil sous lequel un devis Pennylane est considéré SAV/entretien et sort du
// pipeline commercial (sélecteur de rattachement + explorateur de devis).
// ⚠️ Valeur DUPLIQUÉE dans supabase/functions/pennylane-sync-quote-status/index.ts
// (Deno ne peut pas importer src/lib/). Toute modification doit toucher les deux.
export const PIPELINE_MIN_AMOUNT_HT = 500;
