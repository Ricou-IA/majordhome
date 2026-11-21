// src/lib/leadReactivation.js
// ============================================================================
// Réactiver un lead passé en « Perdu » : il reprend la place qu'il avait juste avant
// (Eric 2026-11-21 : « sinon c'est impossible de le sortir du game »).
//
// La place d'avant se lit dans l'historique, du plus sûr au moins sûr :
//   1. le journal d'audit (`majordhome.audit_log`, écrit par la base) ;
//   2. les activités de la fiche (`lead_activities`, déclaratives) ;
//   3. à défaut de trace : le premier statut du pipeline (« Nouveau »).
// Module PUR (aucun import) — testé par `node --test scripts/lead-reactivation.test.mjs`.
// ============================================================================

/**
 * Un statut « perdu » : terminal et non gagné.
 * @param {{ is_final?: boolean, is_won?: boolean }|null|undefined} statut
 * @returns {boolean}
 */
export function estStatutPerdu(statut) {
  return statut?.is_final === true && statut?.is_won !== true;
}

const instant = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * Statut dans lequel un lead perdu revient quand on le réactive.
 * `null` si le lead n'est pas perdu (rien à réactiver).
 *
 * @param {object} p
 * @param {Array<{ id: string, label: string, display_order: number, is_final?: boolean, is_won?: boolean }>} p.statuses
 * @param {string|null|undefined} p.statutActuelId
 * @param {Array<{ table_name?: string, changed_fields?: string[], old_values?: object, new_values?: object, changed_at?: string }>} [p.auditRows]
 * @param {Array<{ old_status_id?: string, new_status_id?: string, created_at?: string }>} [p.activities]
 * @returns {{ id: string, label: string, display_order: number }|null}
 */
export function statutDeRetour({ statuses, statutActuelId, auditRows = [], activities = [] }) {
  const parId = new Map((statuses || []).map((s) => [s.id, s]));
  const actuel = parId.get(statutActuelId);
  if (!estStatutPerdu(actuel)) return null;

  // Passages VERS le statut perdu actuel, avec le statut quitté.
  const passages = [];
  for (const r of auditRows || []) {
    if (r?.table_name && r.table_name !== 'leads') continue;
    if (!(r?.changed_fields || []).includes('status_id')) continue;
    if (r?.new_values?.status_id !== statutActuelId) continue;
    passages.push({ avant: r?.old_values?.status_id, quand: instant(r.changed_at), sur: 2 });
  }
  for (const a of activities || []) {
    if (a?.new_status_id !== statutActuelId || !a?.old_status_id) continue;
    passages.push({ avant: a.old_status_id, quand: instant(a.created_at), sur: 1 });
  }

  // Le plus récent ; à instant égal, le journal d'audit prime sur l'activité.
  passages.sort((x, y) => y.quand - x.quand || y.sur - x.sur);
  for (const p of passages) {
    const avant = parId.get(p.avant);
    // On ne revient ni dans un statut terminal ni dans un statut qui n'existe plus.
    if (avant && avant.is_final !== true) return avant;
  }

  // Aucune trace exploitable : le premier statut ouvert du pipeline.
  const ouverts = (statuses || []).filter((s) => s.is_final !== true);
  if (ouverts.length === 0) return null;
  return ouverts.reduce((min, s) => (s.display_order < min.display_order ? s : min));
}
