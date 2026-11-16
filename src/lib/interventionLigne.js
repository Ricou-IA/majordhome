/**
 * interventionLigne.js — ce qu'une ligne de l'onglet Interventions de la fiche client
 * doit dire (module PUR, testé : node --test scripts/intervention-ligne.test.mjs).
 *
 * L'onglet recense, il ne crée pas. Avant ce module, une demande SAV non planifiée
 * s'affichait « SAV · Demande » suivie d'un tiret : la date lue était `scheduled_date`
 * (vide tant que rien n'est posé au planning) et la description (`sav_description`)
 * n'était jamais affichée. Mesuré en base le 2026-11-16 : `technician_name` n'est
 * renseigné sur AUCUNE intervention — qui est passé se lit sur les RDV rattachés.
 *
 * Ce module ne formate pas les dates : il rend des faits, l'écran les met en forme.
 */

/** Statuts d'un RDV qui ne comptent pas comme un passage (ni à venir, ni fait). */
const RDV_INACTIFS = new Set(['cancelled', 'no_show']);

/** Une intervention est « faite » : carte réalisée / facturée, ou statut technique terminé. */
function estFaite(intervention) {
  return ['realise', 'facture'].includes(intervention.workflow_status) || intervention.status === 'completed';
}

function jourDe(valeur) {
  return valeur ? String(valeur).slice(0, 10) : null;
}

function heureDe(valeur) {
  const m = /^(\d{2}):(\d{2})/.exec(String(valeur || ''));
  return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * RDV actifs d'une intervention, du plus ancien au plus récent.
 * @param {Array<{ scheduled_date?: string, scheduled_start?: string, status?: string }>} [rdvs]
 */
export function rdvsActifs(rdvs = []) {
  return (rdvs || [])
    .filter((r) => r?.scheduled_date && !RDV_INACTIFS.has(r.status))
    .sort((a, b) => `${a.scheduled_date} ${a.scheduled_start || ''}`.localeCompare(`${b.scheduled_date} ${b.scheduled_start || ''}`));
}

/**
 * RDV de référence : le prochain à venir (aujourd'hui compris), sinon le dernier passé.
 * @param {Array<object>} rdvs
 * @param {string} aujourdhui - 'YYYY-MM-DD' (date LOCALE)
 * @returns {object|null}
 */
export function rdvDeReference(rdvs, aujourdhui) {
  const actifs = rdvsActifs(rdvs);
  if (actifs.length === 0) return null;
  const aVenir = actifs.find((r) => jourDe(r.scheduled_date) >= aujourdhui);
  return aVenir || actifs[actifs.length - 1];
}

/**
 * Faits à afficher pour une intervention.
 *
 * `moment.kind` :
 *   - 'rdv_a_venir' : un RDV est posé au planning, aujourd'hui ou plus tard
 *   - 'rdv_passe'   : le dernier RDV posé est passé
 *   - 'realise'     : pas de RDV, une date et une intervention faite (historique importé)
 *   - 'prevu'       : pas de RDV, une date, intervention non faite
 *   - 'demande'     : ni RDV ni date — on ne connaît que la création
 *
 * @param {object} intervention - ligne de `majordhome_interventions` enrichie de `rdvs`
 * @param {{ aujourdhui: string, nomsTechniciens?: Map<string, string> }} contexte
 * @returns {{
 *   moment: { kind: string, date: string|null, heure: string|null },
 *   demandeLe: string|null,
 *   joursDeRdv: number,
 *   techniciens: string[],
 *   objet: string|null,
 *   compteRendu: string|null,
 *   notes: string|null,
 * }}
 */
export function decrireIntervention(intervention, { aujourdhui, nomsTechniciens = new Map() }) {
  const actifs = rdvsActifs(intervention.rdvs);
  const reference = rdvDeReference(intervention.rdvs, aujourdhui);
  const datePrevue = jourDe(intervention.scheduled_date);
  const creation = intervention.created_at || null;

  let moment;
  if (reference) {
    const jour = jourDe(reference.scheduled_date);
    moment = { kind: jour >= aujourdhui ? 'rdv_a_venir' : 'rdv_passe', date: jour, heure: heureDe(reference.scheduled_start) };
  } else if (datePrevue) {
    moment = { kind: estFaite(intervention) ? 'realise' : 'prevu', date: datePrevue, heure: null };
  } else {
    moment = { kind: 'demande', date: creation, heure: null };
  }

  // Qui : les techniciens du RDV de référence (ordre du planning), sans doublon ; un id que
  // l'équipe active ne connaît plus est ignoré plutôt qu'affiché en identifiant.
  const techniciens = [];
  for (const id of reference?.technician_ids || []) {
    const nom = nomsTechniciens.get(String(id));
    if (nom && !techniciens.includes(nom)) techniciens.push(nom);
  }
  if (techniciens.length === 0 && intervention.technician_name) techniciens.push(intervention.technician_name);

  const texte = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  return {
    moment,
    // La date de la demande n'est répétée que si elle n'est pas déjà « le moment » affiché.
    demandeLe: moment.kind === 'demande' ? null : creation,
    joursDeRdv: new Set(actifs.map((r) => jourDe(r.scheduled_date))).size,
    techniciens,
    objet: intervention.intervention_type === 'sav' ? texte(intervention.sav_description) : null,
    compteRendu: texte(intervention.work_performed),
    notes: texte(intervention.report_notes),
  };
}

/**
 * Ordre de l'onglet : la plus récente en tête, d'après la date qui parle (RDV, date prévue,
 * sinon création). Les enfants (un certificat par équipement) suivent leur parent.
 * Ne modifie pas le tableau reçu.
 * @param {Array<object>} interventions
 * @param {string} aujourdhui
 * @returns {Array<object>} parents (avec `_hasChildren`) et enfants, dans l'ordre d'affichage
 */
export function ordonnerInterventions(interventions = [], aujourdhui) {
  const dateDe = (i) => {
    const ref = rdvDeReference(i.rdvs, aujourdhui);
    return String(ref?.scheduled_date || i.scheduled_date || i.created_at || '');
  };
  const parents = interventions.filter((i) => !i.parent_id).sort((a, b) => dateDe(b).localeCompare(dateDe(a)));
  const parentIds = new Set(parents.map((p) => p.id));
  const enfantsPar = new Map();
  for (const i of interventions) {
    if (!i.parent_id) continue;
    if (!enfantsPar.has(i.parent_id)) enfantsPar.set(i.parent_id, []);
    enfantsPar.get(i.parent_id).push(i);
  }

  const ordre = [];
  for (const p of parents) {
    const enfants = enfantsPar.get(p.id) || [];
    ordre.push({ ...p, _hasChildren: enfants.length > 0 });
    ordre.push(...enfants);
  }
  // Orphelins : enfants dont le parent n'est pas dans la liste (jamais masqués).
  for (const i of interventions) {
    if (i.parent_id && !parentIds.has(i.parent_id)) ordre.push(i);
  }
  return ordre;
}
