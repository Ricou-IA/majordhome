// src/lib/maintenance/registreModel.js
// ============================================================================
// Registre de maintenance (PDF) — module PUR, testé par
// `node --test scripts/maintenance/registre-model.test.mjs`. Met en forme le
// journal SANS rien recalculer : un chiffre du PDF absent du journal est un bug
// de ce module. Le filtrage (période, unité, opérateur…) est fait par l'appelant.
// ============================================================================
const TIME_ZONE = 'Europe/Paris';
const HEURE = new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
const JOUR = new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });

/** 'YYYY-MM-DD' → 'JJ/MM/AAAA' (sans passer par un fuseau). */
const jourFr = (jour) => (jour ? jour.split('-').reverse().join('/') : '');

/**
 * @param {object} p
 * @param {Array<{id:string,name:string,sort_order?:number}>} p.units
 * @param {Array<{id:string,unit_id:string,label:string}>} p.tasks
 * @param {Array<{task_id:string,unit_id?:string,operator_id:string,status:string,comment:?string,due_date:string,done_at:string}>} p.logs déjà filtrés
 * @param {Array<{id:string,first_name:string}>} p.operators
 * @param {string} p.du 'YYYY-MM-DD'
 * @param {string} p.au 'YYYY-MM-DD'
 * @returns {{ periode: string, total: number, sections: Array<{ unite: string, lignes: Array<{date:string,heure:string,tache:string,statut:string,operateur:string,commentaire:string,echeance:string}> }> }}
 */
export function construireRegistre({ units, tasks, logs, operators, du, au }) {
  const tacheParId = new Map((tasks || []).map((t) => [t.id, t]));
  const prenom = new Map((operators || []).map((o) => [o.id, o.first_name]));
  const unitesTriees = [...(units || [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)));

  const parUnite = new Map();
  for (const l of logs || []) {
    const unitId = l.unit_id || tacheParId.get(l.task_id)?.unit_id;
    if (!parUnite.has(unitId)) parUnite.set(unitId, []);
    parUnite.get(unitId).push(l);
  }

  const sections = [];
  for (const u of unitesTriees) {
    const lignes = parUnite.get(u.id);
    if (!lignes?.length) continue;
    lignes.sort((a, b) => new Date(a.done_at) - new Date(b.done_at));
    sections.push({
      unite: u.name,
      lignes: lignes.map((l) => {
        const instant = new Date(l.done_at);
        return {
          date: JOUR.format(instant),
          heure: HEURE.format(instant),
          tache: tacheParId.get(l.task_id)?.label || 'Tâche supprimée',
          statut: l.status === 'not_done' ? 'Pas pu faire' : 'Fait',
          operateur: prenom.get(l.operator_id) || 'Opérateur inconnu',
          commentaire: l.comment || '',
          echeance: jourFr(l.due_date),
        };
      }),
    });
  }

  return {
    periode: `du ${jourFr(du)} au ${jourFr(au)}`,
    total: sections.reduce((n, s) => n + s.lignes.length, 0),
    sections,
  };
}
