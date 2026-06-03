/**
 * callWindow.js — Garde-fou plages horaires d'appel.
 * Défaut légal : 9h-20h, pas le dimanche. Override via params.
 */
export function isWithinCallWindow(params = {}, now = new Date()) {
  const startH = Number.isFinite(params.window_start) ? params.window_start : 9;
  const endH   = Number.isFinite(params.window_end)   ? params.window_end   : 20;
  const day = now.getDay();          // 0 = dimanche
  const h   = now.getHours();
  if (day === 0) return false;
  return h >= startH && h < endH;
}

export const DEFAULT_CALL_WINDOW = { window_start: 9, window_end: 20 };
