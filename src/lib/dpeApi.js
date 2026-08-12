/**
 * dpeApi.js — Donnée bâtiment publique pour une adresse client
 * ============================================================================
 * Module PUR (aucun import React / Supabase / alias) → testable via
 * `node --test scripts/dpe-api.test.mjs`, même convention que `pvEngine` et
 * `thermalEngine`. Les fonctions réseau prennent un `fetchImpl` injectable
 * pour être testées sans réseau.
 *
 * Chaîne : adresse client → BAN (api-adresse.data.gouv.fr) → `identifiant_ban`
 *          → DPE ADEME (data.ademe.fr, ~15,3 M de diagnostics).
 * Deux APIs publiques, sans clé, sans authentification, CORS ouvert.
 *
 * ⚠️ AUCUNE écriture en base. Le résultat n'est jamais persisté (décision
 * produit du 2026-08-12 : on mesure la pertinence avant d'envisager un cache).
 *
 * ⚠️ Divergence assumée avec `geocoding.service.js`, qui appelle déjà la BAN.
 * Ce module refait son propre appel plutôt que de réutiliser `geocodeAddress()`,
 * pour deux raisons qui ne sont pas cosmétiques :
 *   1. il lui faut `properties.id` (l'identifiant BAN) — que `geocodeAddress`
 *      ne remonte pas, et c'est LA clé de jointure exacte avec le DPE ;
 *   2. `geocodeAddress` renvoie `null` en dessous d'un score de 0,3, ce qui
 *      efface l'information dont l'UI a besoin pour dire « adresse incertaine ».
 * Si un 3ᵉ appelant a besoin du `banId`, il faudra étendre
 * `geocoding.service.js` — surtout pas recopier ce module une fois de plus.
 * ============================================================================
 */

export const BAN_SEARCH_URL = 'https://api-adresse.data.gouv.fr/search/';
export const ADEME_DPE_URL =
  'https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines';

/** En dessous de ce score BAN, l'adresse est affichée avec un avertissement. */
export const BAN_LOW_CONFIDENCE_SCORE = 0.6;

/**
 * Rayons proposés pour l'exploration du voisinage, en mètres.
 *
 * 80 m — la valeur d'origine — convenait au repli « même immeuble / voisin
 * immédiat ». Depuis que la recherche élargie est un geste délibéré, l'intention
 * a changé : on veut se faire une idée du bâti du secteur. Or 80 m ne suffit pas
 * en pavillonnaire. Mesuré à Pechbonnieu depuis le point BAN du client :
 * 80 m → 1 DPE, 150 m → 13, 300 m → 75.
 */
export const NEARBY_RADII_M = [150, 300, 600];
export const PROXIMITY_RADIUS_M = NEARBY_RADII_M[0];

/**
 * Sous ce score, le géocodage fait par l'ADEME est un rapprochement approximatif
 * et le DPE peut être attaché à la mauvaise adresse.
 *
 * Mesuré sur les 69 166 DPE du Tarn le 2026-08-12 : 23 % sont sous 0,5, et les
 * cas à 0,28-0,29 montrent de vraies erreurs — « 11 Impasse de Laborie »
 * rattachée à « 11 Impasse de la Borie » (rue différente), ou un simple lieu-dit
 * rattaché à la commune entière (identifiant à 5 caractères, sans voie).
 * Le seuil ne DISQUALIFIE rien : il déclenche un avertissement. Le juge final
 * reste l'humain, qui compare `rawAddress` à l'adresse de la fiche.
 */
export const BAN_MATCH_LOW_SCORE = 0.5;

/** Nombre max de logements remontés pour une adresse exacte (immeubles). */
export const MAX_RECORDS = 12;

/**
 * Plafond en exploration du voisinage. Plus haut : les résultats deviennent des
 * repères sur une carte, pas des cartes empilées. **Tout écart entre `total` et
 * le nombre remonté DOIT être affiché** — une troncature muette laisse croire
 * que le secteur est vide alors qu'on n'en montre qu'un sixième.
 */
export const MAX_NEARBY_RECORDS = 40;

/**
 * Champs demandés à l'API DPE. Noms vérifiés contre le schéma du dataset
 * (230 champs) — un nom erroné ne provoque PAS d'erreur, la colonne revient
 * simplement absente. Toute modification doit être revérifiée contre
 * `GET https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe`.
 */
export const DPE_FIELDS = [
  'numero_dpe',
  'adresse_ban',
  'identifiant_ban',
  // Traçabilité du rattachement — indispensable, cf. `assessMatch` :
  // `adresse_brut` est ce que le diagnostiqueur a ÉCRIT, avant normalisation.
  // C'est le seul élément qu'un humain peut comparer d'un coup d'oeil.
  'adresse_brut',
  'nom_commune_brut',
  'code_postal_brut',
  'score_ban',
  'statut_geocodage',
  'etiquette_dpe',
  'etiquette_ges',
  'type_batiment',
  'annee_construction',
  'surface_habitable_logement',
  'nombre_niveau_logement',
  'type_generateur_chauffage_principal',
  'type_energie_principale_chauffage',
  'type_generateur_chauffage_principal_ecs',
  'type_installation_ecs',
  'periode_installation_generateur_froid',
  'type_ventilation',
  'qualite_isolation_enveloppe',
  'qualite_isolation_murs',
  'qualite_isolation_menuiseries',
  // Toiture : trois champs mutuellement exclusifs selon la configuration du
  // bâti. On NE prend PAS `isolation_toiture`, qui est un booléen 0/1 et
  // s'affichait « Toiture · 1 » — illisible à côté des libellés qualitatifs.
  'qualite_isolation_plancher_haut_comble_perdu',
  'qualite_isolation_plancher_haut_comble_amenage',
  'qualite_isolation_plancher_haut_toit_terrasse',
  'conso_5_usages_par_m2_ep',
  'ubat_w_par_m2_k',
  // Bilan de déperditions (W/K) — renseigné à 100 % sur le Tarn.
  // `deperditions_enveloppe` est le TOTAL : il vaut la somme des 7 postes
  // ci-dessous, renouvellement d'air inclus (vérifié sur DPE 2281E1013231P).
  'deperditions_enveloppe',
  'deperditions_murs',
  'deperditions_planchers_hauts',
  'deperditions_planchers_bas',
  'deperditions_baies_vitrees',
  'deperditions_portes',
  'deperditions_ponts_thermiques',
  'deperditions_renouvellement_air',
  // Coût annuel ventilé par usage — renseigné à 100 %
  'cout_total_5_usages',
  'cout_chauffage',
  'cout_ecs',
  'cout_refroidissement',
  'cout_eclairage',
  'cout_auxiliaires',
  'date_etablissement_dpe',
  'date_fin_validite_dpe',
  // Coordonnées du DPE. data-fair ne les renvoie PAS d'office quand un `select`
  // est fourni (vérifié) — il faut les demander explicitement, sinon pas de carte.
  '_geopoint',
];

/**
 * Postes de déperdition, dans l'ordre du bilan.
 * Le 3ᵉ élément est la forme AVEC article, pour les phrases rédigées du
 * document client (« s'échappe par les murs ») — sans lui on produit des
 * « par murs » qui font amateur sur un document remis en main propre.
 */
export const HEAT_LOSS_POSTS = [
  ['walls', 'Murs', 'les murs'],
  ['thermalBridges', 'Ponts thermiques', 'les ponts thermiques'],
  ['airRenewal', "Renouvellement d'air", "le renouvellement d'air"],
  ['windows', 'Baies vitrées', 'les baies vitrées'],
  ['doors', 'Portes', 'les portes'],
  ['floorsLow', 'Planchers bas', 'les planchers bas'],
  ['floorsHigh', 'Planchers hauts', 'les planchers hauts'],
];

// ============================================================================
// PARTIE PURE (aucun réseau) — c'est ce que couvrent les tests
// ============================================================================

/**
 * Construit la requête texte envoyée à la BAN.
 * @returns {string} chaîne vide si l'adresse est inexploitable
 */
export function buildAddressQuery({ address, postalCode, city } = {}) {
  const q = [address, postalCode, city]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // La BAN renvoie du bruit en dessous de ~5 caractères utiles
  return q.length < 5 ? '' : q;
}

/**
 * Normalise une feature GeoJSON de la BAN.
 * @returns {{banId: string|null, label: string, score: number, lon: number, lat: number}|null}
 */
export function parseBanFeature(feature) {
  const props = feature?.properties;
  const coords = feature?.geometry?.coordinates;
  if (!props || !Array.isArray(coords) || coords.length < 2) return null;

  const [lon, lat] = coords;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  return {
    banId: props.id || null,
    label: props.label || '',
    score: Number.isFinite(props.score) ? props.score : 0,
    lon,
    lat,
  };
}

/** `null` / `''` / `'non renseigné'` → null, sinon la valeur nettoyée. */
function clean(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^(non\s+renseign|inconnu|indetermine|indéterminé)/i.test(s)) return null;
  return s;
}

function num(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Transforme une ligne brute de l'API DPE en objet exploitable par l'UI.
 * Tolère les champs absents : l'API ne renvoie pas les colonnes vides.
 */
export function mapDpeRecord(raw = {}) {
  const distance = num(raw._geo_distance);
  // `_geopoint` est une chaîne « lat,lon » — l'ordre est inverse de GeoJSON.
  // ⚠️ Passer par `num()` et exiger DEUX parties : `Number('')` vaut 0, donc un
  // champ absent produirait des coordonnées (0, 0) — au large de l'Afrique, et
  // le point serait tracé sur la carte comme s'il était valide.
  const geo = String(raw._geopoint ?? '').split(',');
  const gLat = geo.length === 2 ? num(geo[0]) : null;
  const gLon = geo.length === 2 ? num(geo[1]) : null;

  return {
    lat: gLat,
    lon: gLon,
    id: clean(raw.numero_dpe) || clean(raw.identifiant_ban) || null,
    // Distinct de `id` : `id` peut retomber sur le banId (clé React), alors que
    // `dpeNumber` doit rester le vrai n° ADEME ou rien — c'est lui qui part
    // dans la fiche client.
    dpeNumber: clean(raw.numero_dpe),
    address: clean(raw.adresse_ban),
    banId: clean(raw.identifiant_ban),
    // Adresse telle que saisie par le diagnostiqueur, non normalisée
    rawAddress: [clean(raw.adresse_brut), clean(raw.code_postal_brut), clean(raw.nom_commune_brut)]
      .filter(Boolean)
      .join(' ') || null,
    // Qualité du géocodage effectué par l'ADEME, PAS celui de notre côté
    banScore: num(raw.score_ban),
    geocodeStatus: clean(raw.statut_geocodage),

    dpeLabel: clean(raw.etiquette_dpe),
    gesLabel: clean(raw.etiquette_ges),

    buildingType: clean(raw.type_batiment),
    year: num(raw.annee_construction),
    surface: num(raw.surface_habitable_logement),
    levels: num(raw.nombre_niveau_logement),

    heatingGenerator: clean(raw.type_generateur_chauffage_principal),
    heatingEnergy: clean(raw.type_energie_principale_chauffage),
    ecsGenerator: clean(raw.type_generateur_chauffage_principal_ecs),
    ecsInstallation: clean(raw.type_installation_ecs),
    coolingPeriod: clean(raw.periode_installation_generateur_froid),
    ventilation: clean(raw.type_ventilation),

    insulationEnvelope: clean(raw.qualite_isolation_enveloppe),
    insulationWalls: clean(raw.qualite_isolation_murs),
    insulationWindows: clean(raw.qualite_isolation_menuiseries),
    // Les trois configurations de toiture s'excluent : on prend celle qui est
    // renseignée. (`isolation_toiture` existe aussi mais c'est un booléen 0/1.)
    insulationRoof:
      clean(raw.qualite_isolation_plancher_haut_comble_perdu) ||
      clean(raw.qualite_isolation_plancher_haut_comble_amenage) ||
      clean(raw.qualite_isolation_plancher_haut_toit_terrasse),

    consoPerM2: num(raw.conso_5_usages_par_m2_ep),
    annualCost: num(raw.cout_total_5_usages),
    ubat: num(raw.ubat_w_par_m2_k),

    // Bilan de déperditions en W/K
    heatLoss: {
      total: num(raw.deperditions_enveloppe),
      walls: num(raw.deperditions_murs),
      floorsHigh: num(raw.deperditions_planchers_hauts),
      floorsLow: num(raw.deperditions_planchers_bas),
      windows: num(raw.deperditions_baies_vitrees),
      doors: num(raw.deperditions_portes),
      thermalBridges: num(raw.deperditions_ponts_thermiques),
      airRenewal: num(raw.deperditions_renouvellement_air),
    },

    // Coût annuel ventilé par usage, en euros
    costs: {
      total: num(raw.cout_total_5_usages),
      heating: num(raw.cout_chauffage),
      ecs: num(raw.cout_ecs),
      cooling: num(raw.cout_refroidissement),
      lighting: num(raw.cout_eclairage),
      aux: num(raw.cout_auxiliaires),
    },

    dpeDate: clean(raw.date_etablissement_dpe),
    dpeValidUntil: clean(raw.date_fin_validite_dpe),

    // Renseigné uniquement en repli par proximité (`_geo_distance` en mètres)
    distanceM: distance === null ? null : Math.round(distance),
  };
}

/**
 * Répartition des déperditions, triée du poste le plus lourd au plus léger.
 *
 * Le total vient de `deperditions_enveloppe` quand il est fourni, sinon de la
 * somme des postes — mais on ne mélange jamais les deux : réutiliser le total
 * officiel garantit que les parts affichées somment bien à 100 %.
 *
 * @returns {{key: string, label: string, watts: number, share: number}[]}
 *          `share` en pourcentage (0-100). Tableau vide si rien d'exploitable.
 */
export function buildHeatLossBreakdown(record) {
  const loss = record?.heatLoss;
  if (!loss) return [];

  const posts = HEAT_LOSS_POSTS
    .map(([key, label, labelArticle]) => ({ key, label, labelArticle, watts: loss[key] }))
    .filter((p) => Number.isFinite(p.watts) && p.watts > 0);

  if (posts.length === 0) return [];

  const total = Number.isFinite(loss.total) && loss.total > 0
    ? loss.total
    : posts.reduce((sum, p) => sum + p.watts, 0);

  return posts
    .map((p) => ({ ...p, share: (p.watts / total) * 100 }))
    .sort((a, b) => b.watts - a.watts);
}

/**
 * Ventilation du coût annuel par usage, triée par montant décroissant.
 *
 * Sur ~2 % des DPE, la somme des 5 usages ne retombe pas sur
 * `cout_total_5_usages` (écart constaté : +22 € environ, sur de petites
 * surfaces — poste fixe non ventilé). On ajoute alors une ligne « Autres »
 * pour le reliquat, sinon le client additionne la colonne et trouve un trou.
 *
 * @returns {{key: string, label: string, euros: number}[]}
 */
export function buildCostBreakdown(record) {
  const c = record?.costs;
  if (!c) return [];

  const items = [
    ['heating', 'Chauffage', c.heating],
    ['ecs', 'Eau chaude', c.ecs],
    ['cooling', 'Refroidissement', c.cooling],
    ['lighting', 'Éclairage', c.lighting],
    ['aux', 'Auxiliaires', c.aux],
  ]
    .filter(([, , euros]) => Number.isFinite(euros) && euros > 0)
    .map(([key, label, euros]) => ({ key, label, euros }))
    .sort((a, b) => b.euros - a.euros);

  if (items.length > 0 && Number.isFinite(c.total) && c.total > 0) {
    const rest = c.total - items.reduce((s, i) => s + i.euros, 0);
    if (rest / c.total > 0.01) items.push({ key: 'other', label: 'Autres', euros: rest });
  }

  return items;
}

/**
 * Fiabilité du rattachement d'un DPE à l'adresse du client.
 *
 * Deux géocodages indépendants sont en jeu et il ne faut pas les confondre :
 *   - le NÔTRE, qui transforme l'adresse de la fiche en identifiant BAN ;
 *   - CELUI DE L'ADEME, déjà figé dans le DPE (`score_ban`), sur lequel on
 *     n'a aucune prise et qui est parfois franchement mauvais.
 * Un identifiant BAN identique des deux côtés ne prouve donc rien si l'ADEME
 * a mal géocodé au départ.
 *
 * @returns {{level: 'exact'|'a_verifier', reason: string|null}}
 */
export function assessMatch(record, { matchMode } = {}) {
  if (matchMode === 'proximity') {
    return {
      level: 'a_verifier',
      reason: 'DPE trouvé dans le voisinage, pas sur le numéro exact',
    };
  }

  if (Number.isFinite(record?.banScore) && record.banScore < BAN_MATCH_LOW_SCORE) {
    return {
      level: 'a_verifier',
      reason: "l'ADEME a rattaché ce DPE à son adresse de façon approximative",
    };
  }

  if (record?.geocodeStatus && !/à l'adresse|a l'adresse/i.test(record.geocodeStatus)) {
    return { level: 'a_verifier', reason: record.geocodeStatus };
  }

  return { level: 'exact', reason: null };
}

/**
 * `type_batiment` du DPE → `HOUSING_TYPES` de `clients.service.js`.
 * Le DPE ne connaît que ces trois valeurs (vérifié sur le Tarn) ; les autres
 * types de la fiche (`local_commercial`, `autre`) n'ont pas d'équivalent et
 * ne doivent donc jamais être devinés.
 */
export const HOUSING_TYPE_FROM_DPE = {
  maison: 'maison',
  appartement: 'appartement',
  immeuble: 'immeuble',
};

/**
 * Champs de la fiche client renseignables depuis un DPE.
 * N'inclut QUE les clés effectivement trouvées : un champ absent du DPE ne doit
 * pas écraser une saisie existante par une valeur vide.
 *
 * @returns {{dpeNumber?: string, surface?: string, housingType?: string}}
 */
export function toClientPatch(record) {
  if (!record) return {};
  const patch = {};

  if (record.dpeNumber) patch.dpeNumber = record.dpeNumber;
  if (record.surface) patch.surface = String(record.surface);

  const housing = HOUSING_TYPE_FROM_DPE[String(record.buildingType || '').toLowerCase()];
  if (housing) patch.housingType = housing;

  return patch;
}

/**
 * Un DPE est-il périmé à la date donnée ? (validité 10 ans, portée par l'API)
 * @returns {boolean|null} null si la date de fin de validité est absente
 */
export function isDpeExpired(record, today = new Date()) {
  if (!record?.dpeValidUntil) return null;
  const end = new Date(record.dpeValidUntil);
  if (Number.isNaN(end.getTime())) return null;
  return end.getTime() < today.getTime();
}

// ============================================================================
// PARTIE RÉSEAU — `fetchImpl` injectable pour les tests
// ============================================================================

async function getJson(url, fetchImpl, signal) {
  const res = await fetchImpl(url, { signal });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Géocode une adresse via la BAN et retourne son identifiant.
 * @returns {Promise<object|null>} `null` si aucune adresse ne correspond
 */
export async function lookupBanAddress(
  { address, postalCode, city },
  { fetchImpl = fetch, signal } = {}
) {
  const q = buildAddressQuery({ address, postalCode, city });
  if (!q) return null;

  const params = new URLSearchParams({ q, limit: '1' });
  if (postalCode) params.set('postcode', String(postalCode).trim());

  const json = await getJson(`${BAN_SEARCH_URL}?${params}`, fetchImpl, signal);
  const feature = json?.features?.[0];
  return feature ? parseBanFeature(feature) : null;
}

/**
 * @param {object} extra   filtres spécifiques (qs, geo_distance…)
 * @param {number} limit   taille de page
 * @param {string|null} sort  `null` = ordre par défaut du serveur. Sur une
 *   requête `geo_distance`, data-fair trie alors PAR DISTANCE croissante, ce
 *   qui est le seul ordre correct quand on plafonne les résultats.
 */
function dpeParams(extra, limit = MAX_RECORDS, sort = '-date_etablissement_dpe') {
  const params = new URLSearchParams({
    size: String(limit),
    select: DPE_FIELDS.join(','),
    ...extra,
  });
  if (sort) params.set('sort', sort);
  return params;
}

/** Tous les DPE portant exactement cet identifiant BAN. */
export async function fetchDpeByBanId(banId, { fetchImpl = fetch, signal } = {}) {
  if (!banId) return { total: 0, records: [] };

  const params = dpeParams({ qs: `identifiant_ban:"${banId}"` });
  const json = await getJson(`${ADEME_DPE_URL}?${params}`, fetchImpl, signal);

  return {
    total: json?.total ?? 0,
    records: (json?.results || []).map(mapDpeRecord),
  };
}

/**
 * Les DPE dans un rayon autour du point, du plus proche au plus lointain.
 * `total` peut dépasser `records.length` (plafond) — l'appelant DOIT l'afficher.
 */
export async function fetchDpeNearby(
  lon,
  lat,
  { radiusM = PROXIMITY_RADIUS_M, limit = MAX_NEARBY_RECORDS, fetchImpl = fetch, signal } = {}
) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { total: 0, records: [] };
  }

  // Le rayon finit tel quel dans l'URL : un `onClick={fn}` mal branché y
  // injecterait un événement React, et `geo_distance=lon,lat,[object Object]`
  // renvoie un HTTP 400 que l'UI présente comme « service indisponible » —
  // une panne de chez nous maquillée en panne de l'ADEME. Vu en prod le
  // 2026-08-12. On ne fait jamais confiance au caller sur ce paramètre.
  const radius = Number.isFinite(radiusM) && radiusM > 0 ? radiusM : PROXIMITY_RADIUS_M;

  // Pas de `sort` : data-fair ordonne alors par distance croissante. Le champ
  // `_geo_distance` n'est PAS triable explicitement (400), et trier par date
  // ferait rater les voisins immédiats — vérifié à Pechbonnieu, où le DPE à
  // 79 m n'apparaissait pas dans les 6 premiers résultats triés par date.
  const params = dpeParams({ geo_distance: `${lon},${lat},${radius}` }, limit, null);
  const json = await getJson(`${ADEME_DPE_URL}?${params}`, fetchImpl, signal);

  return {
    total: json?.total ?? 0,
    records: (json?.results || []).map(mapDpeRecord),
  };
}

/**
 * Orchestration complète : adresse → BAN → DPE.
 *
 * ⚠️ **La recherche par voisinage n'est PAS automatique** (`includeNearby`,
 * faux par défaut). Un DPE trouvé à 51 m est celui du voisin, pas celui du
 * client : le déclencher tout seul revenait à présenter la maison d'à côté
 * comme « le » résultat, avec un simple bandeau pour nuancer. Personne ne lit
 * le bandeau. Quand la correspondance exacte ne donne rien, on répond
 * `no_dpe` en conservant `ban` (coordonnées comprises), et c'est l'UI qui
 * propose au besoin d'élargir — geste explicite, résultat assumé comme tel.
 *
 * Ne lève jamais : toute panne réseau ressort en `status: 'error'`, pour que
 * le panneau affiche un message plutôt que de faire tomber la fiche client.
 *
 * @returns {Promise<{
 *   status: 'ok'|'no_address'|'address_not_found'|'no_dpe'|'error',
 *   ban: object|null, lowConfidence: boolean,
 *   matchMode: 'ban_id'|'proximity'|null,
 *   records: object[], total: number, error: string|null
 * }>}
 */
export async function investigateAddress(
  { address, postalCode, city },
  { fetchImpl = fetch, signal, radiusM = PROXIMITY_RADIUS_M, includeNearby = false } = {}
) {
  const base = {
    ban: null,
    lowConfidence: false,
    matchMode: null,
    records: [],
    total: 0,
    error: null,
  };

  if (!buildAddressQuery({ address, postalCode, city })) {
    return { ...base, status: 'no_address' };
  }

  try {
    const ban = await lookupBanAddress(
      { address, postalCode, city },
      { fetchImpl, signal }
    );
    if (!ban) return { ...base, status: 'address_not_found' };

    const found = { ...base, ban, lowConfidence: ban.score < BAN_LOW_CONFIDENCE_SCORE };

    // 1. Correspondance exacte sur l'identifiant BAN
    const exact = await fetchDpeByBanId(ban.banId, { fetchImpl, signal });
    if (exact.records.length > 0) {
      return { ...found, status: 'ok', matchMode: 'ban_id', ...exact };
    }

    // 2. Voisinage — UNIQUEMENT sur demande explicite de l'utilisateur
    if (includeNearby) {
      const nearby = await fetchDpeNearby(ban.lon, ban.lat, {
        radiusM,
        fetchImpl,
        signal,
      });
      if (nearby.records.length > 0) {
        return { ...found, status: 'ok', matchMode: 'proximity', ...nearby };
      }
    }

    return { ...found, status: 'no_dpe' };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { ...base, status: 'error', error: err?.message || 'Erreur inconnue' };
  }
}
