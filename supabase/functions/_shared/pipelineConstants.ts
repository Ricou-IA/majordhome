// ============================================================================
// _shared/pipelineConstants.ts — Constantes métier du pipeline commercial
// ============================================================================
//
// SOURCE UNIQUE côté Deno. Importée par les 3 edge functions Pennylane :
//   - pennylane-sync-quote-status  → filtre l'auto-attache d'un nouveau devis
//   - pennylane-backfill-quotes    → filtre le backfill historique
//   - pennylane-sync-cron          → décide de CRÉER un lead (⚠️ pas un simple
//                                     filtre : sous le seuil, aucun lead n'existe)
//
// ⚠️ DUPLICATION IRRÉDUCTIBLE frontend ↔ Deno
// La même valeur vit dans `src/lib/constants.js` (Deno ne peut pas importer le
// code frontend). Ces DEUX fichiers — et eux seuls — doivent bouger ensemble.
// Il n'y a plus aucune autre copie : toute nouvelle edge function qui a besoin
// du seuil doit importer ce module, jamais redéclarer la valeur.
//
// ⚠️ DÉPLOIEMENT
// Le module est bundlé dans chaque edge function (pas résolu à l'exécution) :
// modifier ce fichier impose de REDÉPLOYER LES TROIS fonctions ci-dessus, sinon
// elles tournent avec l'ancien seuil en silence. Passer `../_shared/
// pipelineConstants.ts` comme `name` dans le `files` array du MCP
// `deploy_edge_function` (même convention que `../_shared/auth.ts`).
// ============================================================================

/**
 * Seuil (€ HT) sous lequel un devis Pennylane est considéré SAV/entretien et
 * sort du pipeline commercial.
 *
 * Historique : 1000 → 500 le 2026-08-05 (demande équipe — le SAV est sous 500).
 */
export const PIPELINE_MIN_AMOUNT_HT = 500;
