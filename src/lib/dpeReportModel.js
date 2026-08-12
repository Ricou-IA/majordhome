/**
 * dpeReportModel.js — Modèle de la synthèse énergétique remise au client
 * ============================================================================
 * Module PUR (aucun import React / Supabase / réseau) → testé par
 * `node --test scripts/dpe-report-model.test.mjs`. Même rôle que
 * `rapportModel.js` (Thermique) ou `etudeModel.js` (Solaire) : **source unique
 * de mise en forme, il ne recalcule rien**. Il traduit en français ce que le
 * DPE dit déjà, et en tire des recommandations de prestations.
 *
 * Positionnement du document (décidé avec Eric le 2026-08-12) :
 *   - il n'imite PAS la mise en page réglementaire et ne se présente jamais
 *     comme un DPE — c'est un document commercial, il le dit ;
 *   - il ASSUME sa source : n° de DPE et date d'établissement en couverture.
 *     Un DPE de 2022 peut décrire une chaudière déjà remplacée ; le dire
 *     protège l'artisan et ouvre la conversation ;
 *   - **Mayer ne vend ni isolation ni menuiseries.** Quand les murs dominent
 *     les pertes (cas fréquent), on ne renvoie pas vers une prestation qu'on
 *     n'assure pas : on l'énonce honnêtement en « hors périmètre » et on
 *     positionne le chauffage comme ce qui fait baisser la facture MALGRÉ des
 *     murs qu'on ne touche pas.
 * ============================================================================
 */

// Extension explicite : le runner `node --test` ne résout pas les imports sans
// extension, contrairement à Vite.
import { buildHeatLossBreakdown, buildCostBreakdown } from './dpeApi.js';

/** Postes de déperdition sur lesquels Mayer n'a rien à proposer. */
export const OUT_OF_SCOPE_POSTS = ['walls', 'windows', 'doors'];

/** Au-delà de cette part des pertes, le renouvellement d'air justifie une VMC. */
export const AIR_RENEWAL_VMC_THRESHOLD = 15;

/** Un générateur au-delà de cet âge est considéré comme à remplacer. */
export const AGING_GENERATOR_YEARS = 15;

// ============================================================================
// LECTURE DU LIBELLÉ DE GÉNÉRATEUR
// ============================================================================

/**
 * Extrait la période d'installation portée par le libellé ADEME.
 * Formes rencontrées : « avant 1981 », « 1991-2000 », « 2001-2015 »,
 * « après 2015 », « à partir de 2015 », « entre 2008 et 2014 ».
 *
 * @returns {{from: number|null, to: number|null}|null}
 */
export function extractGeneratorPeriod(label) {
  if (!label) return null;
  const s = String(label);

  const range = s.match(/(?:entre\s+)?(\d{4})\s*(?:-|–|et)\s*(\d{4})/i);
  if (range) return { from: Number(range[1]), to: Number(range[2]) };

  const before = s.match(/avant\s+(\d{4})/i);
  if (before) return { from: null, to: Number(before[1]) };

  const after = s.match(/(?:après|apres|à partir de|a partir de)\s+(\d{4})/i);
  if (after) return { from: Number(after[1]), to: null };

  const lone = s.match(/\b(19|20)\d{2}\b/);
  if (lone) return { from: Number(lone[0]), to: Number(lone[0]) };

  return null;
}

/**
 * Le générateur est-il vieillissant ?
 * On raisonne sur la BORNE HAUTE de la période : « 2001-2015 » veut dire « au
 * plus tard 2015 ». Sans borne haute (« après 2015 »), on ne conclut pas — on
 * préfère taire une recommandation que d'annoncer au client que sa chaudière
 * neuve est à changer.
 *
 * @returns {boolean|null} null si l'âge est indéterminable
 */
export function isAgingGenerator(label, refYear) {
  const period = extractGeneratorPeriod(label);
  if (!period) return null;
  if (period.to === null) return false;
  return refYear - period.to >= AGING_GENERATOR_YEARS;
}

const has = (value, re) => re.test(String(value || ''));

const isWood = (r) =>
  has(r.heatingEnergy, /bois|granul|pellet|b[ûu]che|plaquette/i) ||
  has(r.heatingGenerator, /bois|granul|pellet|po[êe]le|insert|b[ûu]che/i);

const isOil = (r) => has(r.heatingEnergy, /fioul|fuel/i) || has(r.heatingGenerator, /fioul|fuel/i);
const isGas = (r) => has(r.heatingEnergy, /gaz|gpl|propane|butane/i);
const isHeatPump = (r) => has(r.heatingGenerator, /\bPAC\b|pompe.{0,8}chaleur/i);

// ============================================================================
// RECOMMANDATIONS
// ============================================================================

/**
 * Prestations à proposer, de la plus structurante à la plus légère.
 * Chaque entrée porte le POURQUOI (tiré du DPE, vérifiable par le client) et
 * la prestation. Aucun chiffrage : sans métrés ce serait un devis à l'aveugle,
 * et un chiffre faux détruit la confiance construite par les pages précédentes.
 *
 * @returns {{key: string, titre: string, pourquoi: string, prestation: string}[]}
 */
export function buildRecommendations(record, { refYear = new Date().getFullYear() } = {}) {
  if (!record) return [];

  const out = [];
  const aging = isAgingGenerator(record.heatingGenerator, refYear);
  const label = String(record.dpeLabel || '').toUpperCase();
  const posts = buildHeatLossBreakdown(record);
  const airRenewal = posts.find((p) => p.key === 'airRenewal');

  if (isOil(record)) {
    out.push({
      key: 'pac_fioul',
      titre: 'Remplacer la chaudière fioul par une pompe à chaleur',
      pourquoi:
        'Le fioul est aujourd’hui l’énergie de chauffage la plus chère au kWh, et son remplacement est le poste sur lequel votre facture peut le plus baisser.',
      prestation: 'Étude et installation d’une pompe à chaleur air/eau',
    });
  } else if (isGas(record) && aging === true) {
    out.push({
      key: 'pac_gaz',
      titre: 'Remplacer une chaudière gaz en fin de vie',
      pourquoi: `Votre générateur (${record.heatingGenerator}) a dépassé ${AGING_GENERATOR_YEARS} ans : son rendement s’est dégradé et une panne immobilise le chauffage en plein hiver.`,
      prestation: 'Pompe à chaleur air/eau ou chaudière à condensation',
    });
  } else if (isHeatPump(record) && aging === true) {
    out.push({
      key: 'pac_remplace',
      titre: 'Renouveler une pompe à chaleur vieillissante',
      pourquoi: `Votre pompe à chaleur (${record.heatingGenerator}) a plus de ${AGING_GENERATOR_YEARS} ans. Les modèles actuels produisent nettement plus de chaleur pour la même électricité consommée.`,
      prestation: 'Remplacement de la pompe à chaleur',
    });
  }

  if (isWood(record)) {
    out.push({
      key: 'ramonage',
      titre: 'Entretenir et ramoner votre appareil bois',
      pourquoi:
        'Le ramonage d’un conduit desservant un appareil bois est obligatoire chaque année. Il conditionne aussi la prise en charge en cas de sinistre.',
      prestation: 'Contrat d’entretien avec ramonage annuel',
    });
  }

  if (!record.coolingPeriod && ['E', 'F', 'G'].includes(label)) {
    out.push({
      key: 'clim',
      titre: 'Traiter le confort d’été',
      pourquoi:
        'Le logement n’est équipé d’aucun système de refroidissement, alors que son isolation le rend sensible aux fortes chaleurs.',
      prestation: 'Climatisation réversible',
    });
  }

  if (airRenewal && airRenewal.share > AIR_RENEWAL_VMC_THRESHOLD) {
    out.push({
      key: 'vmc',
      titre: 'Maîtriser le renouvellement d’air',
      pourquoi: `${Math.round(airRenewal.share)} % de vos pertes de chaleur partent par le renouvellement d’air. Une ventilation pilotée renouvelle l’air sans jeter la chaleur avec.`,
      prestation: 'Installation d’une VMC',
    });
  }

  if (['F', 'G'].includes(label)) {
    out.push({
      key: 'aides',
      titre: 'Faire le point sur les aides',
      pourquoi: `Une étiquette ${label} ouvre l’accès aux dispositifs d’aide les plus favorables, sous conditions.`,
      prestation: 'Accompagnement au montage du dossier',
    });
  }

  return out;
}

/**
 * Postes majeurs sur lesquels Mayer n'intervient pas, à énoncer plutôt qu'à
 * masquer. Ne remonte que ceux qui pèsent vraiment (part >= seuil) : signaler
 * des portes à 3 % n'apporte rien.
 */
export function buildOutOfScopeNote(record, { minShare = 10 } = {}) {
  const posts = buildHeatLossBreakdown(record).filter(
    (p) => OUT_OF_SCOPE_POSTS.includes(p.key) && p.share >= minShare
  );
  if (posts.length === 0) return null;

  const total = posts.reduce((s, p) => s + p.share, 0);
  return {
    posts,
    sharePct: Math.round(total),
    libelles: posts.map((p) => p.labelArticle),
  };
}

const MOIS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/**
 * `2022-05-11` → `11 mai 2022`.
 * Formatage local plutôt que `formatDateShortFR` de `@lib/utils` : ce module
 * doit rester PUR (ce fichier-là tire `clsx` et `tailwind-merge`).
 * @returns {string|null} null si la date est absente ou illisible
 */
export function formatDateFrLong(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const mois = MOIS_FR[Number(mo) - 1];
  if (!mois) return null;
  return `${Number(d)} ${mois} ${y}`;
}

// ============================================================================
// MODÈLE COMPLET
// ============================================================================

const QUALITY_PLAIN = {
  insuffisante: 'laisse passer beaucoup de chaleur',
  moyenne: 'freine partiellement les pertes',
  bonne: 'joue correctement son rôle',
  'très bonne': 'est performante',
};

/** Traduit un libellé de qualité ADEME en langage client. */
export function plainQuality(value) {
  if (!value) return null;
  return QUALITY_PLAIN[String(value).toLowerCase().trim()] || null;
}

/**
 * Modèle complet de la synthèse.
 *
 * @param {object} record     enregistrement DPE (mapDpeRecord)
 * @param {object} client     fiche client (display_name, address, postal_code, city)
 * @param {object} options    { dateLabel, refYear }
 */
export function buildDpeReportModel(record, client, { dateLabel = '', refYear } = {}) {
  const year = refYear ?? new Date().getFullYear();
  const posts = buildHeatLossBreakdown(record);
  const costs = buildCostBreakdown(record);
  const dominant = posts[0] || null;

  return {
    client: {
      nom: client?.display_name || [client?.last_name, client?.first_name].filter(Boolean).join(' ') || '',
      adresse: record?.address || [client?.address, client?.postal_code, client?.city].filter(Boolean).join(' '),
    },
    dateLabel,

    source: {
      numeroDpe: record?.dpeNumber || null,
      dateDpe: record?.dpeDate || null,
      dateDpeLabel: formatDateFrLong(record?.dpeDate),
      // Adresse telle que saisie par le diagnostiqueur : elle figure dans le
      // document pour que le client puisse constater lui-même que le
      // diagnostic exploité est bien celui de son logement.
      adresseDiagnostic: record?.rawAddress || null,
      // Mention affichée telle quelle en couverture et en pied de page
      mention:
        'Document établi à partir des données publiques du diagnostic de performance énergétique (base ADEME). Il n’est pas un diagnostic réglementaire et n’a pas de valeur contractuelle.',
    },

    logement: {
      surface: record?.surface ?? null,
      type: record?.buildingType || null,
      annee: record?.year ?? null,
      etiquette: record?.dpeLabel || null,
      ges: record?.gesLabel || null,
      consoPerM2: record?.consoPerM2 ?? null,
      ubat: record?.ubat ?? null,
    },

    chaleur: {
      posts,
      dominant,
      phrase: dominant
        ? `${Math.round(dominant.share)} % de la chaleur que vous payez s’échappe par ${dominant.labelArticle}.`
        : null,
    },

    argent: { total: record?.costs?.total ?? null, postes: costs },

    installation: {
      chauffage: record?.heatingGenerator || record?.heatingEnergy || null,
      energie: record?.heatingEnergy || null,
      ecs: record?.ecsGenerator || record?.ecsInstallation || null,
      ventilation: record?.ventilation || null,
      froid: record?.coolingPeriod || null,
      isolation: [
        ['Murs', record?.insulationWalls],
        ['Toiture', record?.insulationRoof],
        ['Menuiseries', record?.insulationWindows],
      ]
        .filter(([, v]) => v)
        .map(([label, value]) => ({ label, value, plain: plainQuality(value) })),
    },

    recommandations: buildRecommendations(record, { refYear: year }),
    horsPerimetre: buildOutOfScopeNote(record),
  };
}
