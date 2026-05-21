/**
 * logger.js — Wrapper console.* qui ne loggue qu'en mode dev
 * ============================================================================
 * P1.7 (2026-05-21) — Évite que les logs internes (console.error, console.warn,
 * console.log) ne fuitent en prod via DevTools côté navigateur ou via les
 * source maps. En prod (`import.meta.env.PROD === true`), les wrappers sont
 * des no-ops.
 *
 * Usage :
 *   import { logger } from '@lib/logger';
 *   logger.error('[clients] failed to load', err);
 *   logger.warn('[ContractPdf] retry');
 *   logger.info('[useAuth] session refreshed');
 *
 * `logger.error` reste actif en prod pour les erreurs critiques (Sentry-like)
 * — c'est `logger.debug` / `logger.info` / `logger.warn` qui sont muted.
 * Si tu veux tout muter, utilise `logger.silent.error()`.
 * ============================================================================
 */

const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;
const noop = () => {};

export const logger = {
  // Actifs en dev + prod (vraies erreurs)
  error: console.error.bind(console),

  // Actifs en dev uniquement
  warn: isDev ? console.warn.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  log: isDev ? console.log.bind(console) : noop,
  debug: isDev ? console.debug.bind(console) : noop,
  table: isDev ? console.table.bind(console) : noop,
  group: isDev ? console.group.bind(console) : noop,
  groupEnd: isDev ? console.groupEnd.bind(console) : noop,
};

// Variant silent : tout muté, même error. Pour les cas où on a vraiment besoin
// de log = nothing (ex: gestion d'erreur async qui retry).
logger.silent = {
  error: noop,
  warn: noop,
  info: noop,
  log: noop,
  debug: noop,
};
