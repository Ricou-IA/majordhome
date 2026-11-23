/**
 * entretienVisitStatus.js
 * Lecture du statut de la visite de l'année d'un contrat d'entretien — module PUR.
 * Testé : node --test scripts/entretien-visit-status.test.mjs
 *
 * Règle (Eric, 2026-09-30) : **un contrat dont le client a refusé l'entretien de
 * l'année n'est pas « à faire »**. Le refus est une visite `cancelled` de l'année
 * (saisie « Proposé mais refusé par le client ») ; la vue `majordhome_contracts`
 * la remonte dans `current_year_visit_status`. Le moteur de tournées et l'auto-RDV
 * l'excluaient déjà (allowlist `=== null`) ; les listes et les compteurs, eux,
 * traitaient tout ce qui n'est pas `completed` comme « à faire » — 13 contrats
 * actifs refusés gardaient le bouton Planifier et la bulle SMS de rappel.
 */

/**
 * Statut de la visite de l'année d'un contrat, lu sur `current_year_visit_status`.
 * Source unique pour les listes et les compteurs (Programmation, onglet
 * Contrats, KPI) — ne pas recopier le test `=== 'completed'` ailleurs.
 *
 * @param {{ current_year_visit_status?: string|null }|null|undefined} contract
 * @returns {'realise'|'refuse'|'a_faire'}
 */
export function statutVisiteAnnee(contract) {
  const s = contract?.current_year_visit_status;
  if (s === 'completed') return 'realise';
  if (s === 'cancelled') return 'refuse';
  return 'a_faire';
}

/**
 * Décompte d'une liste de contrats par statut de visite de l'année.
 * @param {Array<{ current_year_visit_status?: string|null }>|null|undefined} contracts
 * @returns {{ total: number, realises: number, refuses: number, aFaire: number, tauxRealisation: number }}
 *   `tauxRealisation` en % entier, calculé sur les contrats À FAIRE cette année
 *   (réalisés + restants) : un refus sort du dénominateur.
 */
export function compterVisitesAnnee(contracts) {
  let realises = 0;
  let refuses = 0;
  let aFaire = 0;
  for (const c of contracts || []) {
    const s = statutVisiteAnnee(c);
    if (s === 'realise') realises += 1;
    else if (s === 'refuse') refuses += 1;
    else aFaire += 1;
  }
  const attendus = realises + aFaire;
  return {
    total: realises + refuses + aFaire,
    realises,
    refuses,
    aFaire,
    tauxRealisation: attendus > 0 ? Math.round((realises / attendus) * 100) : 0,
  };
}

/**
 * Où en est l'entretien de l'année d'un contrat, pour la programmation (Eric 2026-11-23 :
 * l'en-tête disait 161 « à faire », la Programmation 193). Partition unique :
 *   realise · refuse · planifie (une carte d'entretien est ouverte : posée ou à poser) ·
 *   a_planifier (rien d'ouvert). « Reste à faire » = planifie + a_planifier.
 * `plannedIds` = contrats qui ont une carte d'entretien non réalisée
 * (`getPlannedContractIds`, seule définition). Liste inconnue ⇒ null : on ne devine pas.
 * @param {{ id?: string, current_year_visit_status?: string|null }} contract
 * @param {Set<string>|null|undefined} plannedIds
 * @returns {'realise'|'refuse'|'planifie'|'a_planifier'|null}
 */
export function statutProgrammation(contract, plannedIds) {
  const s = statutVisiteAnnee(contract);
  if (s !== 'a_faire') return s;
  if (!plannedIds) return null;
  return plannedIds.has(contract?.id) ? 'planifie' : 'a_planifier';
}

/**
 * Décompte de la partition ci-dessus.
 * @param {Array<{ id?: string, current_year_visit_status?: string|null, amount?: (number|string|null) }>|null|undefined} contracts
 * @param {Set<string>|null|undefined} plannedIds
 * @returns {{ realises: number, refuses: number, planifies: number, aPlanifier: number, resteAFaire: number,
 *   caAPlanifier: number, caRealise: number, connu: boolean }}
 *   `connu` faux quand la liste des contrats planifiés manque : planifies / aPlanifier valent alors 0.
 */
export function compterProgrammation(contracts, plannedIds) {
  const r = { realises: 0, refuses: 0, planifies: 0, aPlanifier: 0, resteAFaire: 0, caAPlanifier: 0, caRealise: 0, connu: !!plannedIds };
  for (const c of contracts || []) {
    const montant = Number(c.amount) || 0;
    const s = statutProgrammation(c, plannedIds);
    if (s === 'realise') { r.realises += 1; r.caRealise += montant; }
    else if (s === 'refuse') r.refuses += 1;
    else {
      r.resteAFaire += 1;
      if (s === 'planifie') r.planifies += 1;
      else if (s === 'a_planifier') { r.aPlanifier += 1; r.caAPlanifier += montant; }
    }
  }
  return r;
}

/**
 * Dérive le statut d'affichage du bloc "Visite {année}" du modal entretien.
 * Source unique = visites enregistrées (contract_visits) + carte entretien active.
 *
 * Une visite de l'année courante qui n'est pas `completed` est une TÂCHE CLOSE
 * (≠ "à faire") : `cancelled` = refusé par le client → 'refuse' ; tout autre
 * statut (`skipped`…) → 'non_realise'.
 *
 * @param {Object} p
 * @param {Array<{visit_year:number,status:string}>} [p.visits]
 * @param {{workflow_status?:string}|null} [p.activeCard]
 * @param {number} p.currentYear
 * @returns {'realise'|'refuse'|'non_realise'|'planifie'|'a_planifier'}
 */
export function deriveVisitBadgeStatus({ visits = [], activeCard = null, currentYear }) {
  const currentYearVisit = (visits || []).find((v) => v.visit_year === currentYear);
  if (currentYearVisit?.status === 'completed') return 'realise';
  if (currentYearVisit?.status === 'cancelled') return 'refuse';
  if (currentYearVisit) return 'non_realise'; // skipped / autre = tâche close
  if (activeCard?.workflow_status === 'planifie') return 'planifie';
  return 'a_planifier';
}
