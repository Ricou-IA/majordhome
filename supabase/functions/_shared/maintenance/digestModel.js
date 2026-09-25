// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/maintenance/digestModel.js — ne pas éditer.
// src/lib/maintenance/digestModel.js
// ============================================================================
// Contenu de l'e-mail du soir du module Maintenance — module PUR, testé par
// `node --test scripts/maintenance/digest-model.test.mjs`, copié pour Deno
// (edge maintenance-digest) par `npm run sync:tournee-engine`. Construit le
// récapitulatif ; n'envoie rien. Les états viennent d'echeances.js (seule
// définition de « dû / en retard »).
//
// L'e-mail part même quand tout est à jour : un soir sans e-mail = une panne.
// ============================================================================
import { etatDuJour, dernierLogParTache, jourParis } from './echeances.js';

const TIME_ZONE = 'Europe/Paris';
const HEURE = new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });

/** @param {string} jour 'YYYY-MM-DD' @returns {string} « vendredi 25 septembre 2026 » */
function dateLongue(jour) {
  const [a, m, j] = jour.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(Date.UTC(a, m - 1, j)));
}

const parOrdre = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name));

/**
 * @param {object} p
 * @param {Array<{id:string,name:string,sort_order?:number}>} p.units
 * @param {Array<object>} p.tasks tâches (avec leur fréquence)
 * @param {Array<{task_id:string,operator_id:string,status:string,comment:?string,due_date:string,done_at:string}>} p.logs journal (au moins le dernier log de chaque tâche + ceux du jour)
 * @param {Array<{id:string,first_name:string,locked_until:?string}>} p.operators
 * @param {string} p.aujourdhui 'YYYY-MM-DD' (Paris)
 * @param {string} p.maintenant instant ISO
 * @param {string} p.orgName
 * @returns {{ sujet: string, titre: string, orgName: string, toutAJour: boolean,
 *   faitsParUnite: Array<{unite:string,n:number}>,
 *   enAttente: Array<{unite:string,tache:string,echeance:string,joursDeRetard:number}>,
 *   nonFaits: Array<{unite:string,tache:string,operateur:string,commentaire:string}>,
 *   bloques: Array<{prenom:string,jusqua:string}> }}
 */
export function construireDigest({ units, tasks, logs, operators, aujourdhui, maintenant, orgName }) {
  const unitesTriees = [...(units || [])].sort(parOrdre);
  const rang = new Map(unitesTriees.map((u, i) => [u.id, i]));
  const nomUnite = new Map(unitesTriees.map((u) => [u.id, u.name]));
  const tacheParId = new Map((tasks || []).map((t) => [t.id, t]));
  const prenom = new Map((operators || []).map((o) => [o.id, o.first_name]));
  const duJour = (logs || []).filter((l) => jourParis(l.done_at) === aujourdhui);

  const faits = new Map();
  for (const l of duJour) {
    if (l.status !== 'done') continue;
    const t = tacheParId.get(l.task_id);
    if (!t) continue;
    faits.set(t.unit_id, (faits.get(t.unit_id) || 0) + 1);
  }
  const faitsParUnite = [...faits.entries()]
    .sort(([a], [b]) => (rang.get(a) ?? 99) - (rang.get(b) ?? 99))
    .map(([unitId, n]) => ({ unite: nomUnite.get(unitId) || 'Unité', n }));

  const derniers = dernierLogParTache(logs);
  const enAttente = [];
  for (const t of tasks || []) {
    const e = etatDuJour(t, derniers.get(t.id), aujourdhui);
    if (e.etat !== 'a_faire' && e.etat !== 'en_retard') continue;
    enAttente.push({ unite: nomUnite.get(t.unit_id) || 'Unité', tache: t.label, echeance: e.echeance, joursDeRetard: e.joursDeRetard });
  }
  enAttente.sort((a, b) => b.joursDeRetard - a.joursDeRetard || a.unite.localeCompare(b.unite) || a.tache.localeCompare(b.tache));

  const nonFaits = duJour
    .filter((l) => l.status === 'not_done')
    .sort((a, b) => new Date(a.done_at) - new Date(b.done_at))
    .map((l) => {
      const t = tacheParId.get(l.task_id);
      return {
        unite: nomUnite.get(t?.unit_id) || 'Unité',
        tache: t?.label || 'Tâche supprimée',
        operateur: prenom.get(l.operator_id) || 'Opérateur inconnu',
        commentaire: l.comment || '',
      };
    });

  const instant = new Date(maintenant);
  const bloques = (operators || [])
    .filter((o) => o.locked_until && new Date(o.locked_until) > instant)
    .map((o) => ({ prenom: o.first_name, jusqua: HEURE.format(new Date(o.locked_until)) }));

  const toutAJour = enAttente.length === 0 && nonFaits.length === 0;
  const titre = `Maintenance — ${dateLongue(aujourdhui)}`;
  const n = enAttente.length;
  const sujet = toutAJour
    ? `${titre} — ✓ Tout est à jour`
    : `${titre} — ${n} tâche${n > 1 ? 's' : ''} en attente${nonFaits.length ? `, ${nonFaits.length} « pas pu faire »` : ''}`;

  return { sujet, titre, orgName: orgName || '', toutAJour, faitsParUnite, enAttente, nonFaits, bloques };
}

/** @param {unknown} s @returns {string} */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const TD = 'style="padding:4px 8px;border-bottom:1px solid #e5e7eb;font-size:14px"';
const TD_AMBRE = 'style="padding:4px 8px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#b45309"';

/**
 * Corps HTML autonome (sans dépendance au squelette d'e-mail de l'org).
 * @param {ReturnType<typeof construireDigest>} d
 * @returns {string}
 */
export function digestHtml(d) {
  const bloc = (titre, contenu) => `<h3 style="margin:20px 0 6px;font-size:15px;color:#1f2937">${esc(titre)}</h3>${contenu}`;
  const table = (lignes) => `<table style="border-collapse:collapse;width:100%">${lignes.join('')}</table>`;
  const parts = [];

  parts.push(`<p style="font-size:13px;color:#6b7280;margin:0">${esc(d.orgName)}</p>`);
  parts.push(`<h2 style="margin:4px 0 12px;font-size:18px;color:#1f2937">${esc(d.titre)}</h2>`);
  if (d.toutAJour) {
    parts.push('<p style="font-size:15px;color:#1d4ed8;font-weight:bold">✓ Tout est à jour.</p>');
  }
  if (d.enAttente.length) {
    parts.push(bloc(`Tâches en attente (${d.enAttente.length})`, table(d.enAttente.map((r) =>
      `<tr><td ${TD}>${esc(r.unite)}</td><td ${TD}>${esc(r.tache)}</td><td ${TD_AMBRE}>${
        r.joursDeRetard > 0 ? `en retard de ${r.joursDeRetard} j` : "prévue aujourd'hui"}</td></tr>`))));
  }
  if (d.nonFaits.length) {
    parts.push(bloc(`« Pas pu faire » aujourd'hui (${d.nonFaits.length})`, table(d.nonFaits.map((r) =>
      `<tr><td ${TD}>${esc(r.unite)}</td><td ${TD}>${esc(r.tache)}</td><td ${TD}>${esc(r.operateur)}</td><td ${TD}>${esc(r.commentaire)}</td></tr>`))));
  }
  parts.push(bloc("Réalisé aujourd'hui", d.faitsParUnite.length
    ? table(d.faitsParUnite.map((r) => `<tr><td ${TD}>${esc(r.unite)}</td><td ${TD}>${r.n} tâche${r.n > 1 ? 's' : ''}</td></tr>`))
    : '<p style="font-size:14px;color:#6b7280">Aucune tâche réalisée aujourd\'hui.</p>'));
  if (d.bloques.length) {
    parts.push(bloc('Opérateurs bloqués (codes PIN erronés)', `<p style="font-size:14px">${
      d.bloques.map((b) => `${esc(b.prenom)} jusqu'à ${esc(b.jusqua)}`).join(', ')}</p>`));
  }
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px">${parts.join('')}</div>`;
}
