// src/apps/solaire/lib/pvDossierStatus.js
// Ordre canonique des états d'un dossier PV (miroir client de la règle forward-only
// appliquée en DB par la RPC pv_dossier_advance + le trigger backstop).
// PUR : aucun import React/Supabase — testé via node --test.
export const PV_DOSSIER_STATUSES = [
  'offre',
  'dossier_valide',
  'urbanisme_depose',
  'urbanisme_valide',
  'raccordement_enedis',
  'consuel_demande',
  'projet_en_service',
];

/** Rang de l'état dans l'ordre canonique, ou null si inconnu. */
export function statusRank(status) {
  const i = PV_DOSSIER_STATUSES.indexOf(status);
  return i === -1 ? null : i;
}

/** true si `to` est strictement en aval de `from` (jamais redescendre, jamais no-op). */
export function canAdvance(from, to) {
  const a = statusRank(from);
  const b = statusRank(to);
  if (a === null || b === null) return false;
  return b > a;
}
