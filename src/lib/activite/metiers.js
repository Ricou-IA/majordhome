// Mon activité (Paramètres → Mon activité) : une grille métier par métier, deux colonnes à cocher.
//   - « Projets et devis » : le type de projet proposé dans les leads et « Nouveau devis » (settings.devis.familles).
//   - « Parc client » : la catégorie et le type d'équipement que l'on recense chez le client et que l'on entretient
//     (majordhome.equipment_categories / pricing_equipment_types).
// Module PUR : catalogue neutre des métiers (aucune valeur d'une entreprise) et règles de lecture et d'écriture.
// Rien n'est supprimé : décocher DÉSACTIVE (les équipements des clients gardent leur type).
// Un code connu d'un référentiel existant (alias) est reconnu sans être recréé.

/**
 * @typedef {{ code: string, label: string, alias?: string[], certificate_profile: string, default_vat_rate: number }} CategorieMetier
 * @typedef {{ code: string, label: string, alias?: string[], reception_profile: string }} TypeMetier
 * @typedef {{ key: string, label: string, groupe: 'pose'|'hors_pose', famille: string|null,
 *   categorie: CategorieMetier|null, type: TypeMetier|null }} Metier
 */

const POELE = { code: 'poele', label: 'Poêle', certificate_profile: 'combustion_bois', default_vat_rate: 5.5 };
const ENERGIE = ['energie'];

/** @type {ReadonlyArray<Metier>} */
export const METIERS = Object.freeze([
  {
    key: 'poele_granules', label: 'Poêle à granulés', groupe: 'pose', famille: 'poele_granules',
    categorie: POELE,
    type: { code: 'poele_granules', label: 'Poêle à granulés', alias: ['poele_granules_elec'], reception_profile: 'poele_granules' },
  },
  {
    key: 'poele_bois', label: 'Poêle à bois ou insert', groupe: 'pose', famille: 'poele_bois',
    categorie: POELE,
    type: { code: 'poele_bois', label: 'Poêle à bois ou insert', alias: ['poele_bois_insert'], reception_profile: 'poele_buches' },
  },
  {
    key: 'chaudiere_bois', label: 'Chaudière bois ou granulés', groupe: 'pose', famille: null,
    categorie: { code: 'chaudiere_bois', label: 'Chaudière bois', certificate_profile: 'combustion_bois', default_vat_rate: 5.5 },
    type: { code: 'chaudiere_bois', label: 'Chaudière bois ou granulés', alias: ['chaudiere_granules'], reception_profile: 'generique' },
  },
  {
    key: 'chaudiere_fossile', label: 'Chaudière gaz ou fioul', groupe: 'pose', famille: null,
    categorie: { code: 'chaudiere_fossile', label: 'Chaudière gaz ou fioul', certificate_profile: 'combustion_fossile', default_vat_rate: 10 },
    type: { code: 'chaudiere_gaz_fioul', label: 'Chaudière gaz ou fioul', reception_profile: 'generique' },
  },
  {
    key: 'pac_air_eau', label: 'Pompe à chaleur air / eau', groupe: 'pose', famille: 'chauffage_pac',
    categorie: { code: 'pac_air_eau', label: 'PAC air / eau', certificate_profile: 'pac', default_vat_rate: 5.5 },
    type: { code: 'pac_air_eau', label: 'PAC air / eau', reception_profile: 'pac_air_eau' },
  },
  {
    key: 'climatisation', label: 'Climatisation, PAC air / air', groupe: 'pose', famille: 'climatisation',
    categorie: { code: 'climatisation', label: 'Climatisation', alias: ['pac_air_air'], certificate_profile: 'pac', default_vat_rate: 10 },
    type: { code: 'pac_air_air', label: 'Climatisation, PAC air / air', alias: ['gainable'], reception_profile: 'pac_air_air' },
  },
  {
    key: 'chauffe_eau_thermo', label: 'Chauffe-eau thermodynamique', groupe: 'pose', famille: null,
    categorie: { code: 'chauffe_eau_thermo', label: 'Chauffe-eau thermodynamique', certificate_profile: 'ecs_thermo', default_vat_rate: 10 },
    type: { code: 'ballon_thermo', label: 'Chauffe-eau thermodynamique', reception_profile: 'chauffe_eau' },
  },
  {
    key: 'vmc', label: 'VMC', groupe: 'pose', famille: 'vmc',
    categorie: { code: 'vmc', label: 'VMC', certificate_profile: 'aeraulique', default_vat_rate: 10 },
    type: { code: 'vmc', label: 'VMC', reception_profile: 'generique' },
  },
  {
    key: 'photovoltaique', label: 'Photovoltaïque', groupe: 'pose', famille: 'photovoltaique',
    categorie: { code: 'photovoltaique', label: 'Photovoltaïque', alias: ENERGIE, certificate_profile: 'generique', default_vat_rate: 10 },
    type: { code: 'panneau_photovoltaique', label: 'Installation photovoltaïque', reception_profile: 'generique' },
  },
  { key: 'batterie', label: 'Batterie', groupe: 'pose', famille: 'batterie', categorie: null, type: null },
  {
    key: 'borne_recharge', label: 'Borne de recharge', groupe: 'pose', famille: 'borne_recharge',
    categorie: { code: 'borne_recharge', label: 'Borne de recharge', alias: ENERGIE, certificate_profile: 'generique', default_vat_rate: 20 },
    type: { code: 'irve', label: 'Borne de recharge', reception_profile: 'generique' },
  },
  { key: 'electricite', label: 'Électricité', groupe: 'pose', famille: 'electricite', categorie: null, type: null },
  { key: 'sav', label: 'Dépannage / SAV', groupe: 'hors_pose', famille: 'sav', categorie: null, type: null },
  { key: 'entretien', label: 'Entretien / ramonage', groupe: 'hors_pose', famille: 'entretien', categorie: null, type: null },
  { key: 'pieces', label: 'Pièces détachées', groupe: 'hors_pose', famille: 'pieces', categorie: null, type: null },
  { key: 'autre', label: 'Autre', groupe: 'hors_pose', famille: 'autre', categorie: null, type: null },
]);

const codesDe = (def) => (def ? [def.code, ...(def.alias || [])] : []);

/** Catégorie existante de l'organisation pour ce métier (code puis alias, la plus ancienne d'abord). */
function categorieExistante(metier, categories) {
  for (const code of codesDe(metier.categorie)) {
    const c = categories.find((x) => x.code === code);
    if (c) return c;
  }
  return null;
}

/** Types existants de l'organisation reconnus pour ce métier. */
function typesExistants(metier, types) {
  const codes = new Set(codesDe(metier.type));
  return types.filter((t) => codes.has(t.code));
}

/**
 * État d'une ligne de la grille. `null` = la colonne ne concerne pas ce métier.
 * Parc client coché = au moins un type reconnu actif, dans une catégorie active.
 * @param {Metier} metier
 * @param {{ familles: Array<{ key: string, actif: boolean }>, categories: Array<object>, types: Array<object> }} r
 * @returns {{ projet: boolean|null, parc: boolean|null }}
 */
export function etatMetier(metier, { familles, categories, types }) {
  const projet = metier.famille ? Boolean(familles.find((f) => f.key === metier.famille)?.actif) : null;
  if (!metier.type) return { projet, parc: null };
  const actives = new Set(categories.filter((c) => c.is_active).map((c) => c.id));
  const parc = typesExistants(metier, types).some((t) => t.is_active && actives.has(t.category_id));
  return { projet, parc };
}

/**
 * Familles de devis avec ce type de projet activé ou non (les autres inchangées).
 * @param {Array<object>} familles
 * @param {string} key
 * @param {boolean} actif
 */
export function basculerFamille(familles, key, actif) {
  return familles.map((f) => (f.key === key ? { ...f, actif } : f));
}

const prochainOrdre = (liste) => liste.reduce((m, x) => Math.max(m, Number(x.sort_order) || 0), 0) + 1;

/**
 * Écritures pour mettre le métier au parc client. Réutilise ce qui existe (réactive), ne crée que ce qui manque.
 * `categorie.action` : 'creer' (payload) | 'reactiver' (id) | 'rien' (id) ; `type.action` : idem. Pour un type
 * à créer, `category_id` vaut `null` quand la catégorie est créée dans la même opération : l'appelant y met l'id rendu.
 * @param {Metier} metier
 * @param {{ categories: Array<object>, types: Array<object> }} r
 */
export function planMiseAuParc(metier, { categories, types }) {
  if (!metier.categorie || !metier.type) throw new Error(`metier_sans_parc:${metier.key}`);
  const cat = categorieExistante(metier, categories);
  const categorie = cat
    ? { action: cat.is_active ? 'rien' : 'reactiver', id: cat.id }
    : {
        action: 'creer',
        payload: {
          code: metier.categorie.code, label: metier.categorie.label, sort_order: prochainOrdre(categories), is_active: true,
          certificate_profile: metier.categorie.certificate_profile, default_vat_rate: metier.categorie.default_vat_rate,
        },
      };
  // Un type reconnu existe : on le garde (le plus actif d'abord), même s'il vit dans une autre catégorie.
  const existants = typesExistants(metier, types);
  const t = existants.find((x) => x.is_active) || existants[0];
  const type = t
    ? { action: t.is_active ? 'rien' : 'reactiver', id: t.id, category_id: t.category_id }
    : {
        action: 'creer',
        payload: {
          code: metier.type.code, label: metier.type.label, sort_order: prochainOrdre(types), is_active: true,
          reception_profile: metier.type.reception_profile, category_id: cat ? cat.id : null,
        },
      };
  // Type existant dans une catégorie inactive autre que celle du métier : la réactiver aussi.
  const categorieDuType = t && t.category_id !== cat?.id ? categories.find((c) => c.id === t.category_id) : null;
  return { categorie, type, categorieDuType: categorieDuType && !categorieDuType.is_active ? categorieDuType.id : null };
}

/**
 * Écritures pour retirer le métier du parc client : ses types reconnus actifs passent inactifs ; une catégorie
 * dont il ne reste plus aucun type actif passe inactive. Rien n'est supprimé.
 * @param {Metier} metier
 * @param {{ categories: Array<object>, types: Array<object> }} r
 * @returns {{ types: string[], categories: string[] }} ids à désactiver
 */
export function planRetraitDuParc(metier, { categories, types }) {
  const aRetirer = typesExistants(metier, types).filter((t) => t.is_active);
  const ids = new Set(aRetirer.map((t) => t.id));
  const touchees = new Set(aRetirer.map((t) => t.category_id));
  const videes = [...touchees].filter((catId) =>
    categories.some((c) => c.id === catId && c.is_active)
    && !types.some((t) => t.category_id === catId && t.is_active && !ids.has(t.id)));
  return { types: [...ids], categories: videes };
}

/**
 * Ce que l'entreprise a ajouté hors du catalogue des métiers (affiché à part, géré dans les onglets de détail).
 * @param {{ familles: Array<object>, types: Array<object> }} r
 * @returns {{ familles: Array<object>, types: Array<object> }}
 */
export function ajoutsHorsCatalogue({ familles, types }) {
  const cles = new Set(METIERS.map((m) => m.famille).filter(Boolean));
  const codes = new Set(METIERS.flatMap((m) => codesDe(m.type)));
  return {
    familles: familles.filter((f) => !cles.has(f.key)),
    types: types.filter((t) => !codes.has(t.code)),
  };
}
