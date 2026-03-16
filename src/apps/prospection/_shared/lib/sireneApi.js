/**
 * sireneApi.js — Client HTTP pour l'API Recherche Entreprises
 * https://recherche-entreprises.api.gouv.fr/search
 * Pas d'authentification requise.
 */

const BASE_URL = 'https://recherche-entreprises.api.gouv.fr/search';

// Lookup tranche effectif salarie → label humain
const TRANCHE_EFFECTIF = {
  NN: 'Non communiqué',
  '00': '0 salarié',
  '01': '1 ou 2',
  '02': '3 à 5',
  '03': '6 à 9',
  '11': '10 à 19',
  '12': '20 à 49',
  '21': '50 à 99',
  '22': '100 à 199',
  '31': '200 à 249',
  '32': '250 à 499',
  '33': '500 à 999',
  '41': '1 000 à 1 999',
  '42': '2 000 à 4 999',
  '51': '5 000 à 9 999',
  '52': '10 000+',
};

// Lookup nature juridique (codes les plus courants)
const NATURE_JURIDIQUE = {
  1000: 'Entrepreneur individuel',
  5410: 'SARL',
  5422: 'SARL unipersonnelle',
  5498: 'SARL (divers)',
  5499: 'Société à responsabilité limitée',
  5505: 'SA à conseil d\'administration',
  5510: 'SA à directoire',
  5599: 'SA (divers)',
  5710: 'SAS',
  5720: 'SASU',
  5699: 'Autre SA à capital variable',
  6540: 'SCI',
  6542: 'SCI de construction-vente',
  5306: 'SNC',
};

/**
 * Recherche d'entreprises via l'API gouvernementale.
 * @param {Object} params
 * @param {string} params.query - Texte libre
 * @param {string[]} [params.codeNaf] - Codes NAF à filtrer (ex: ['43.22A'])
 * @param {string} [params.departement] - Code département
 * @param {string} [params.commune] - Code INSEE commune (ex: '81004' pour Albi)
 * @param {number} [params.page=1]
 * @param {number} [params.perPage=25]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{results: Object[], total_results: number, page: number, per_page: number, total_pages: number}>}
 */
export async function searchSirene({ query, codeNaf, departement, commune, page = 1, perPage = 25, signal }) {
  const params = new URLSearchParams();
  // L'API accepte une query vide si activite_principale est fourni
  if (query) {
    params.set('q', query);
  }
  params.set('page', String(page));
  params.set('per_page', String(perPage));

  if (codeNaf?.length) {
    params.set('activite_principale', codeNaf.join(','));
  }
  if (departement) {
    params.set('departement', departement);
  }
  if (commune) {
    params.set('commune', commune);
  }

  // Seulement les entreprises actives
  params.set('etat_administratif', 'A');

  const url = `${BASE_URL}?${params.toString()}`;

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`API Sirene: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return {
    results: json.results || [],
    total_results: json.total_results || 0,
    page: json.page || 1,
    per_page: json.per_page || perPage,
    total_pages: json.total_pages || 0,
  };
}

/**
 * Transforme un résultat API en shape compatible DB majordhome.prospects.
 * @param {Object} apiResult - Un élément de results[]
 * @param {string} module - 'cedants' | 'commercial'
 * @returns {Object} Prospect-shaped object (sans org_id, created_by)
 */
export function mapResultToProspect(apiResult, module) {
  const siege = apiResult.siege || {};

  // Extraire le dirigeant personne physique principal
  const dirigeantPP = (apiResult.dirigeants || []).find(
    (d) => d.type_dirigeant === 'personne physique'
  );

  // Extraire les finances les plus récentes
  let caAnnuel = null;
  let resultatNet = null;
  let anneeBilan = null;
  if (apiResult.finances && typeof apiResult.finances === 'object') {
    const annees = Object.keys(apiResult.finances).sort().reverse();
    if (annees.length > 0) {
      const derniere = apiResult.finances[annees[0]];
      caAnnuel = derniere?.ca ?? null;
      resultatNet = derniere?.resultat_net ?? null;
      anneeBilan = parseInt(annees[0], 10) || null;
    }
  }

  return {
    siren: apiResult.siren,
    siret_siege: siege.siret || null,
    raison_sociale: apiResult.nom_complet || apiResult.nom_raison_sociale || '',
    naf: apiResult.activite_principale || siege.activite_principale || null,
    naf_libelle: null, // L'API ne fournit pas le libellé directement
    departement: siege.departement || null,
    commune: siege.libelle_commune || null,
    adresse: siege.geo_adresse || siege.adresse || null,
    code_postal: siege.code_postal || null,
    forme_juridique: formatNatureJuridique(apiResult.nature_juridique),
    date_creation: apiResult.date_creation || siege.date_creation || null,
    tranche_effectif_salarie: formatTrancheEffectif(
      apiResult.tranche_effectif_salarie || siege.tranche_effectif_salarie
    ),
    dirigeant_nom: dirigeantPP?.nom || null,
    dirigeant_prenoms: dirigeantPP?.prenoms || null,
    dirigeant_annee_naissance: dirigeantPP?.annee_de_naissance
      ? parseInt(dirigeantPP.annee_de_naissance, 10)
      : null,
    dirigeant_qualite: dirigeantPP?.qualite || null,
    ca_annuel: caAnnuel,
    resultat_net: resultatNet,
    annee_bilan: anneeBilan,
    latitude: siege.latitude ? parseFloat(siege.latitude) : null,
    longitude: siege.longitude ? parseFloat(siege.longitude) : null,
    module,
    statut: module === 'commercial' ? 'a_contacter' : 'nouveau',
  };
}

/**
 * Formate le code nature juridique en label.
 */
function formatNatureJuridique(code) {
  if (!code) return null;
  return NATURE_JURIDIQUE[code] || `Code ${code}`;
}

/**
 * Formate la tranche effectif en label humain.
 */
function formatTrancheEffectif(code) {
  if (!code) return null;
  return TRANCHE_EFFECTIF[code] || code;
}

// Re-export les lookups pour usage dans les composants
export { TRANCHE_EFFECTIF, NATURE_JURIDIQUE };
