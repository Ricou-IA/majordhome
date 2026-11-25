/**
 * joursIntervention.js — jours de pose d'un client, rangés par chantier (module PUR).
 *
 * La fenêtre d'un RDV d'installation ne montrait que son propre jour : un chantier posé sur
 * plusieurs jours, ou un client à deux chantiers (deux devis validés), laissait des jours
 * invisibles depuis le RDV ouvert (vécu CONDOM 2026-11-25 : 16/12 et 24/12, deux cartes
 * « Devis »). Cette règle regroupe les RDV d'installation du lead par chantier, celui du
 * RDV ouvert en premier.
 */

const INACTIFS = new Set(['cancelled', 'no_show']);

const parDate = (a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || '')
  || (a.scheduled_start || '').localeCompare(b.scheduled_start || '');

/**
 * @param {object[]} rdvs - RDV du lead (tous types ; seuls les `installation` actifs comptent)
 * @param {object[]} chantiers - lignes `majordhome_chantiers` du lead
 * @param {string|null} chantierCourantId - chantier du RDV ouvert
 * @returns {{ chantier: object|null, chantierId: string|null, courant: boolean, jours: object[] }[]}
 *   Chantier du RDV ouvert d'abord, puis les autres par premier jour. Un chantier sans jour
 *   n'apparaît que s'il est le chantier courant.
 */
export function joursParChantier(rdvs, chantiers, chantierCourantId) {
  const groupes = new Map();
  const groupe = (id) => {
    if (!groupes.has(id)) {
      groupes.set(id, {
        chantier: (chantiers || []).find((c) => c.id === id) || null,
        chantierId: id,
        courant: id === (chantierCourantId || null),
        jours: [],
      });
    }
    return groupes.get(id);
  };
  if (chantierCourantId) groupe(chantierCourantId);
  (rdvs || [])
    .filter((r) => r.appointment_type === 'installation' && !INACTIFS.has(r.status))
    .forEach((r) => groupe(r.chantier_id || null).jours.push(r));
  const liste = [...groupes.values()];
  liste.forEach((g) => g.jours.sort(parDate));
  return liste.sort((a, b) => {
    if (a.courant !== b.courant) return a.courant ? -1 : 1;
    return (a.jours[0]?.scheduled_date || '').localeCompare(b.jours[0]?.scheduled_date || '');
  });
}
