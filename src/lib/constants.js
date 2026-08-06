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
//
// ⚠️ MIROIR UNIQUE : supabase/functions/_shared/pipelineConstants.ts
// Deno ne peut pas importer src/lib/, donc la valeur existe à exactement DEUX
// endroits — ici et ce module partagé — qui doivent bouger ensemble. Côté Deno
// les 3 edge functions Pennylane importent le module (aucune autre copie), mais
// il faut les REDÉPLOYER pour que le nouveau seuil s'applique.
export const PIPELINE_MIN_AMOUNT_HT = 500;
