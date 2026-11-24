/**
 * mailStats.js — période et tri du tableau Mailing → Stats (module pur, brief UX P2-13).
 * ============================================================================
 * Les statistiques sont agrégées par campagne : la période retient les campagnes dont le
 * DERNIER envoi tombe dans la fenêtre (une campagne envoyée hier et il y a un an compte donc
 * pour « 30 jours »). Le tri porte sur une colonne du tableau ; une valeur absente va en fin.
 * Testé : scripts/mail-stats.test.mjs.
 * ============================================================================
 */

export const PERIODES_STATS = Object.freeze([
  { value: '30', label: '30 jours', jours: 30 },
  { value: '90', label: '90 jours', jours: 90 },
  { value: '365', label: '12 mois', jours: 365 },
  { value: 'tout', label: 'Tout', jours: null },
]);

const taux = (num, den) => (den > 0 ? (num / den) * 100 : null);

/** Valeur triable d'une ligne pour une colonne. */
export function valeurDeTri(row, cle) {
  const envois = row.total_sent || 0;
  const delivres = row.total_delivered || 0;
  switch (cle) {
    case 'campagne': return String(row.campaign_name || '').toLowerCase();
    case 'envois': return envois;
    case 'ouverts': return taux(row.total_opened || 0, delivres);
    case 'cliques': return taux(row.total_clicked || 0, delivres);
    case 'dernier': return row.last_sent_at ? new Date(row.last_sent_at).getTime() : null;
    default: return null;
  }
}

/**
 * @param {object[]} stats
 * @param {{ periode?: string, tri?: { cle: string, ascendant: boolean }, maintenant?: Date }} p
 */
export function statsAffichees(stats = [], { periode = 'tout', tri = { cle: 'dernier', ascendant: false }, maintenant = new Date() } = {}) {
  const jours = PERIODES_STATS.find((p) => p.value === periode)?.jours ?? null;
  const depuis = jours ? maintenant.getTime() - jours * 86400000 : null;
  const retenues = depuis == null ? [...stats] : stats.filter((r) => r.last_sent_at && new Date(r.last_sent_at).getTime() >= depuis);
  return retenues.sort((a, b) => {
    const va = valeurDeTri(a, tri.cle);
    const vb = valeurDeTri(b, tri.cle);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = va < vb ? -1 : va > vb ? 1 : 0;
    return tri.ascendant ? c : -c;
  });
}
