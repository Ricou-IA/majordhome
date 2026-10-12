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
// DÉFAUT du seuil sous lequel un devis Pennylane n'est pas rattaché automatiquement
// à une carte (rattachement manuel dans /devis). La valeur effective est un réglage
// d'org : `settings.pennylane.pipeline_min_amount_ht`, lu par
// `pennylanePipelineMinAmountHt(settings)` (useOrgSettings.js) côté front et par
// `majordhome.pl_pipeline_min_amount_ht(org)` côté base / edges (20261012_5).
// Ne plus consommer cette constante directement : passer par le réglage.
export const PIPELINE_MIN_AMOUNT_HT = 500;
