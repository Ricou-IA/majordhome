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

/** Libellés UI (badges Historique / drawer Dossier). */
export const PV_DOSSIER_STATUS_LABELS = {
  offre: 'Offre',
  dossier_valide: 'Dossier validé',
  urbanisme_depose: 'DP déposée',
  urbanisme_valide: 'DP accordée',
  raccordement_enedis: 'Raccordement Enedis',
  consuel_demande: 'Consuel demandé',
  projet_en_service: 'En service',
};

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
