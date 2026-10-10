/**
 * parcSousContrat.js — Module PUR : répartition du parc sous contrat
 * ============================================================================
 * Agrège les lignes de la vue `majordhome_contract_parc` (1 ligne par
 * (contrat, équipement lié), equipment_id NULL pour un contrat sans
 * équipement) en :
 *   - familles d'intervention (catégories du référentiel) → types ;
 *   - composition des contrats (nombre d'équipements, combinaisons de
 *     familles).
 *
 * Aucun import React / Supabase. Les libellés viennent de l'index du
 * référentiel (`indexReferentiel`), jamais d'une constante locale : un
 * équipement sans type ou sans catégorie reste VISIBLE (« Sans type »,
 * « Non catégorisé ») — c'est un signal, pas un détail à cacher.
 *
 * Testé : node --test scripts/parc-sous-contrat.test.mjs
 * ============================================================================
 */

export const LABEL_SANS_TYPE = 'Sans type';
export const LABEL_SANS_CATEGORIE = 'Non catégorisé';
export const LABEL_SANS_EQUIPEMENT = 'Sans équipement';

const SANS = '__sans__';

/**
 * @typedef {{ contract_id: string, equipment_id?: string|null, equipment_type_id?: string|null, category_id?: string|null }} LigneParc
 */

/**
 * Rang d'une catégorie / d'un type dans l'ordre du référentiel (Map id → rang).
 * @param {Array<{ id: string }>} liste
 */
function rangs(liste) {
  const m = new Map();
  liste.forEach((x, i) => m.set(x.id, i));
  return m;
}

/**
 * Libellé de la tranche « nombre d'équipements » d'un contrat.
 * @param {number} n
 */
export function trancheEquipements(n) {
  if (n <= 0) return '0';
  if (n >= 3) return '3+';
  return String(n);
}

/**
 * Agrège le parc.
 *
 * @param {LigneParc[]} lignes
 * @param {{ categories: Array<{id,label}>, equipmentTypes: Array<{id,label,category_id}>, labelCategorie: Function, labelType: Function }} index
 *   Index du référentiel (`indexReferentiel`). Catégories et types déjà ordonnés.
 * @returns {{
 *   contrats: number,
 *   contratsSansEquipement: number,
 *   equipements: number,
 *   equipementsSansType: number,
 *   familles: Array<{ id: string|null, label: string, contrats: number, equipements: number, part: number,
 *                     types: Array<{ id: string|null, label: string, contrats: number, equipements: number, part: number }> }>,
 *   composition: {
 *     parNombre: Array<{ tranche: '0'|'1'|'2'|'3+', contrats: number }>,
 *     monoFamille: number, multiFamilles: number,
 *     combinaisons: Array<{ label: string, familles: number, contrats: number }>,
 *   },
 * }}
 */
export function agregerParc(lignes, index) {
  const rangCat = rangs(index.categories || []);
  const rangType = rangs(index.equipmentTypes || []);

  /** @type {Map<string, { equipements: Set<string>, familles: Set<string> }>} */
  const parContrat = new Map();
  /** @type {Map<string, { contrats: Set<string>, equipements: number, types: Map<string, { contrats: Set<string>, equipements: number }> }>} */
  const parFamille = new Map();
  let equipements = 0;
  let equipementsSansType = 0;

  for (const l of lignes || []) {
    if (!l?.contract_id) continue;
    if (!parContrat.has(l.contract_id)) parContrat.set(l.contract_id, { equipements: new Set(), familles: new Set() });
    const c = parContrat.get(l.contract_id);
    if (!l.equipment_id) continue; // contrat sans équipement (LEFT JOIN)
    if (c.equipements.has(l.equipment_id)) continue; // doublon de lien
    c.equipements.add(l.equipment_id);
    equipements += 1;

    const catKey = l.category_id || SANS;
    const typeKey = l.equipment_type_id || SANS;
    if (typeKey === SANS) equipementsSansType += 1;
    c.familles.add(catKey);

    if (!parFamille.has(catKey)) parFamille.set(catKey, { contrats: new Set(), equipements: 0, types: new Map() });
    const f = parFamille.get(catKey);
    f.contrats.add(l.contract_id);
    f.equipements += 1;
    if (!f.types.has(typeKey)) f.types.set(typeKey, { contrats: new Set(), equipements: 0 });
    const t = f.types.get(typeKey);
    t.contrats.add(l.contract_id);
    t.equipements += 1;
  }

  const part = (n) => (equipements > 0 ? n / equipements : 0);
  const labelCat = (key) => (key === SANS ? LABEL_SANS_CATEGORIE : index.labelCategorie(key));
  const labelType = (key) => (key === SANS ? LABEL_SANS_TYPE : index.labelType(key) ?? LABEL_SANS_TYPE);
  const ordre = (rangMap) => (a, b) => {
    if (a === SANS) return 1;
    if (b === SANS) return -1;
    return (rangMap.get(a) ?? Number.MAX_SAFE_INTEGER) - (rangMap.get(b) ?? Number.MAX_SAFE_INTEGER);
  };

  const familles = [...parFamille.keys()].sort(ordre(rangCat)).map((catKey) => {
    const f = parFamille.get(catKey);
    const types = [...f.types.keys()].sort(ordre(rangType)).map((typeKey) => {
      const t = f.types.get(typeKey);
      return { id: typeKey === SANS ? null : typeKey, label: labelType(typeKey), contrats: t.contrats.size, equipements: t.equipements, part: part(t.equipements) };
    });
    return { id: catKey === SANS ? null : catKey, label: labelCat(catKey), contrats: f.contrats.size, equipements: f.equipements, part: part(f.equipements), types };
  });

  // Composition des contrats
  const parNombreMap = new Map([['0', 0], ['1', 0], ['2', 0], ['3+', 0]]);
  const combinaisonsMap = new Map();
  let monoFamille = 0;
  let multiFamilles = 0;
  for (const c of parContrat.values()) {
    const tranche = trancheEquipements(c.equipements.size);
    parNombreMap.set(tranche, parNombreMap.get(tranche) + 1);
    const cles = [...c.familles].sort(ordre(rangCat));
    if (cles.length === 0) {
      const k = LABEL_SANS_EQUIPEMENT;
      combinaisonsMap.set(k, { label: k, familles: 0, contrats: (combinaisonsMap.get(k)?.contrats ?? 0) + 1 });
      continue;
    }
    if (cles.length === 1) monoFamille += 1; else multiFamilles += 1;
    const label = cles.map(labelCat).join(' + ');
    combinaisonsMap.set(label, { label, familles: cles.length, contrats: (combinaisonsMap.get(label)?.contrats ?? 0) + 1 });
  }
  const combinaisons = [...combinaisonsMap.values()].sort((a, b) => b.contrats - a.contrats || a.label.localeCompare(b.label, 'fr'));

  return {
    contrats: parContrat.size,
    contratsSansEquipement: parNombreMap.get('0'),
    equipements,
    equipementsSansType,
    familles,
    composition: {
      parNombre: [...parNombreMap].map(([tranche, contrats]) => ({ tranche, contrats })),
      monoFamille,
      multiFamilles,
      combinaisons,
    },
  };
}

// ============================================================================
// ARBRE Famille → Type → Marque → Modèle → Contrat
// ============================================================================

export const LABEL_SANS_MARQUE = 'Marque non renseignée';
export const LABEL_SANS_MODELE = 'Modèle non renseigné';
export const NIVEAUX = ['famille', 'type', 'marque', 'modele', 'contrat'];

const normaliser = (s) => String(s ?? '').trim();
const cleTexte = (s) => normaliser(s).toLowerCase();

/**
 * @typedef {{ key: string, niveau: 'famille'|'type'|'marque'|'modele'|'contrat', label: string, aQualifier: boolean,
 *             equipements: number, contrats: number, part: number, enfants: NoeudParc[],
 *             contrat?: { id: string, numero: string|null, clientId: string|null, clientNom: string, clientVille: string|null } }} NoeudParc
 */

/**
 * Construit l'arbre du parc. Une feuille = un contrat sous un chemin
 * (famille, type, marque, modèle) ; un contrat à deux poêles identiques y
 * compte 2 équipements, et compte UNE fois dans `contrats` de chaque ancêtre.
 * Les lignes sans équipement (contrat vide) ne produisent pas de feuille.
 *
 * @param {Array<LigneParc & { contract_number?: string, client_id?: string, client_name?: string, client_city?: string, brand?: string, model?: string }>} lignes
 * @param {ReturnType<import('./equipmentReferential.js').indexReferentiel>} index
 * @returns {{ racines: NoeudParc[], equipements: number, contrats: number }}
 */
export function construireArbreParc(lignes, index) {
  const rangCat = rangs(index.categories || []);
  const rangType = rangs(index.equipmentTypes || []);
  const ordreRef = (rangMap) => (a, b) => {
    if (a.cle === SANS) return 1;
    if (b.cle === SANS) return -1;
    return (rangMap.get(a.cle) ?? Number.MAX_SAFE_INTEGER) - (rangMap.get(b.cle) ?? Number.MAX_SAFE_INTEGER);
  };
  const ordreVolume = (a, b) => {
    if (a.cle === SANS) return 1;
    if (b.cle === SANS) return -1;
    return b.equipements - a.equipements || a.label.localeCompare(b.label, 'fr');
  };
  const ordreClient = (a, b) => a.label.localeCompare(b.label, 'fr');

  // Nœud interne : { cle, label, aQualifier, equipements, contrats:Set, enfants:Map }
  const creer = (cle, label, aQualifier) => ({ cle, label, aQualifier, equipements: 0, contrats: new Set(), enfants: new Map() });
  const racine = creer('racine', '', false);
  const vus = new Set();
  let totalEquip = 0;

  for (const l of lignes || []) {
    if (!l?.contract_id || !l.equipment_id) continue;
    const dedup = `${l.contract_id}|${l.equipment_id}`;
    if (vus.has(dedup)) continue;
    vus.add(dedup);
    totalEquip += 1;
    racine.contrats.add(l.contract_id);

    const catKey = l.category_id || SANS;
    const typeKey = l.equipment_type_id || SANS;
    const marque = normaliser(l.brand);
    const modele = normaliser(l.model);
    const typeLabel = typeKey === SANS ? LABEL_SANS_TYPE : (index.labelType(typeKey) ?? LABEL_SANS_TYPE);
    const chemin = [
      [catKey, catKey === SANS ? LABEL_SANS_CATEGORIE : index.labelCategorie(catKey), catKey === SANS],
      [typeKey, typeLabel, typeKey === SANS || typeLabel === LABEL_SANS_TYPE],
      [marque ? cleTexte(marque) : SANS, marque || LABEL_SANS_MARQUE, !marque],
      [modele ? cleTexte(modele) : SANS, modele || LABEL_SANS_MODELE, !modele],
      [l.contract_id, normaliser(l.client_name) || 'Client inconnu', !l.client_name],
    ];

    let noeud = racine;
    for (const [cle, label, aQualifier] of chemin) {
      if (!noeud.enfants.has(cle)) noeud.enfants.set(cle, creer(cle, label, aQualifier));
      noeud = noeud.enfants.get(cle);
      noeud.equipements += 1;
      noeud.contrats.add(l.contract_id);
      if (cle === l.contract_id && !noeud.contrat) {
        noeud.contrat = {
          id: l.contract_id,
          numero: l.contract_number ?? null,
          clientId: l.client_id ?? null,
          clientNom: label,
          clientVille: normaliser(l.client_city) || null,
        };
      }
    }
  }

  const part = (n) => (totalEquip > 0 ? n / totalEquip : 0);
  const tris = [ordreRef(rangCat), ordreRef(rangType), ordreVolume, ordreVolume, ordreClient];
  const geler = (n, profondeur, prefixe) => {
    const enfants = [...n.enfants.values()].sort(tris[profondeur]);
    return enfants.map((e) => {
      const key = `${prefixe}/${e.cle}`;
      const out = {
        key,
        niveau: NIVEAUX[profondeur],
        label: e.label,
        aQualifier: e.aQualifier,
        equipements: e.equipements,
        contrats: e.contrats.size,
        part: part(e.equipements),
        enfants: profondeur + 1 < NIVEAUX.length ? geler(e, profondeur + 1, key) : [],
      };
      if (e.contrat) out.contrat = e.contrat;
      return out;
    });
  };

  return { racines: geler(racine, 0, ''), equipements: totalEquip, contrats: racine.contrats.size };
}

const sansAccents = (s) => cleTexte(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Filtre l'arbre sur un terme (client, ville, n° de contrat, marque, modèle,
 * type, famille). Un nœud qui correspond garde toute sa descendance ; sinon il
 * ne garde que ses descendants qui correspondent. Les compteurs sont
 * RECALCULÉS sur ce qui reste (un chiffre d'avant filtre serait un mensonge).
 *
 * @param {NoeudParc[]} racines
 * @param {string} terme
 * @returns {{ racines: NoeudParc[], aOuvrir: Set<string>, equipements: number, contrats: number }}
 */
export function filtrerArbre(racines, terme) {
  const t = sansAccents(terme);
  const contratsTotal = new Set();
  let equipTotal = 0;
  if (!t) {
    for (const r of racines) { equipTotal += r.equipements; }
    const compterContrats = (n) => { if (n.contrat) contratsTotal.add(n.contrat.id); n.enfants.forEach(compterContrats); };
    racines.forEach(compterContrats);
    return { racines, aOuvrir: new Set(), equipements: equipTotal, contrats: contratsTotal.size };
  }

  const aOuvrir = new Set();
  const correspond = (n) => {
    if (sansAccents(n.label).includes(t)) return true;
    const c = n.contrat;
    return !!c && (sansAccents(c.numero).includes(t) || sansAccents(c.clientVille).includes(t));
  };
  const copierTout = (n) => ({ ...n, enfants: n.enfants.map(copierTout) });
  const recalculer = (n) => {
    if (n.niveau === 'contrat') return { equipements: n.equipements, contrats: new Set([n.contrat?.id ?? n.key]) };
    let equipements = 0;
    const contrats = new Set();
    for (const e of n.enfants) {
      const r = recalculer(e);
      e.equipements = r.equipements;
      e.contrats = r.contrats.size;
      equipements += r.equipements;
      r.contrats.forEach((id) => contrats.add(id));
    }
    n.equipements = equipements;
    n.contrats = contrats.size;
    return { equipements, contrats };
  };
  const elaguer = (n) => {
    if (correspond(n)) return copierTout(n);
    const enfants = n.enfants.map(elaguer).filter(Boolean);
    if (enfants.length === 0) return null;
    aOuvrir.add(n.key);
    return { ...n, enfants };
  };

  const resultat = racines.map(elaguer).filter(Boolean);
  for (const r of resultat) {
    const c = recalculer(r);
    equipTotal += c.equipements;
    c.contrats.forEach((id) => contratsTotal.add(id));
  }
  const total = equipTotal;
  const reparter = (n) => { n.part = total > 0 ? n.equipements / total : 0; n.enfants.forEach(reparter); };
  resultat.forEach(reparter);
  return { racines: resultat, aOuvrir, equipements: equipTotal, contrats: contratsTotal.size };
}

/**
 * Pourcentage entier lisible d'une part (0,004 → « < 1 % », 0,563 → « 56 % »).
 * @param {number} part
 */
export function formatPart(part) {
  if (!part || part <= 0) return '0 %';
  const pct = Math.round(part * 100);
  return pct === 0 ? '< 1 %' : `${pct} %`;
}
