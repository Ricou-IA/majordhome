// src/lib/aspirateur/relais.js
// Module PUR (copié pour Deno) : règles du relais modèle de l'aspirateur (edge fournisseur-aspirer-modele). Le service
// VPS n'a aucune clé de l'API Claude : chaque appel passe par l'edge, qui FIXE le modèle selon l'usage, refuse tout
// outil autre que les six de l'agent (aucun outil serveur : ni recherche web, ni exécution de code), plafonne les
// tokens et compte le coût de chaque appel contre le plafond du travail.
// Tarifs : référence de l'API Claude (cache du 2026-11-03) — à revoir si Anthropic change ses prix.
// Testé : node --test scripts/aspirateur/relais.test.mjs

/** Outils que le service peut déclarer (définis côté service, exécutés côté service). */
export const OUTILS_AGENT = Object.freeze(['aller', 'lire_page', 'cliquer', 'se_connecter', 'essayer_recette', 'proposer_recette']);

/** Modèles par défaut selon l'usage (surchargeables par secret). */
export const MODELES_DEFAUT = Object.freeze({ apprendre: 'claude-sonnet-5-5', lire: 'claude-haiku-5-5' });

const EFFORT = Object.freeze({ apprendre: 'medium', lire: 'low' });
const MAX_TOKENS = 4000;

// $ par million de tokens : entrée, sortie, lecture de cache ; l'écriture de cache (5 min) vaut 1,25 × l'entrée.
const TARIFS = Object.freeze({
  'claude-sonnet-5-5': { entree: 2, sortie: 10, lecture: 0.1 },
  'claude-sonnet-5': { entree: 2, sortie: 10, lecture: 0.2 },
  'claude-haiku-5-5': { entree: 0.1, sortie: 0.5, lecture: 0.01 },
  'claude-opus-5-5': { entree: 4, sortie: 20, lecture: 0.2 },
});
// Un modèle inconnu (repli après refus, par ex.) est compté au tarif le plus haut connu : le plafond ne doit jamais
// être dépassé faute de tarif.
const TARIF_PRUDENT = { entree: 5, sortie: 25, lecture: 0.5 };

/**
 * Coût en dollars d'un appel, d'après son `usage`.
 * @param {string} modele
 * @param {{ input_tokens?: number, output_tokens?: number, cache_read_input_tokens?: number, cache_creation_input_tokens?: number } | null | undefined} usage
 * @returns {number}
 */
export function coutUsd(modele, usage) {
  if (!usage) return 0;
  const t = TARIFS[/** @type {keyof typeof TARIFS} */ (modele)] || TARIF_PRUDENT;
  const n = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const usd = (n(usage.input_tokens) * t.entree + n(usage.output_tokens) * t.sortie
    + n(usage.cache_read_input_tokens) * t.lecture + n(usage.cache_creation_input_tokens) * t.entree * 1.25) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * Vrai si les outils déclarés sont tous des outils de l'agent, définis par le service (pas de `type` : un outil
 * serveur ou un outil « défini par Anthropic » porte un `type`).
 * @param {unknown} outils
 * @returns {boolean}
 */
export function outilsValides(outils) {
  if (outils === undefined || outils === null) return true;
  if (!Array.isArray(outils)) return false;
  return outils.every((o) => o && typeof o === 'object' && !Array.isArray(o)
    && !Object.hasOwn(o, 'type') && OUTILS_AGENT.includes(/** @type {any} */ (o).name));
}

/**
 * Paramètres de l'appel au modèle pour un usage ; null pour un usage inconnu. La pensée n'est pas configurée (adaptative
 * par défaut sur ces modèles ; « disabled » est refusé par Sonnet 5.5) ; l'effort la règle. Sonnet 5.5 reçoit le repli
 * serveur en cas de refus (`fallbacks: "default"`) ; Haiku 5.5 n'en a pas.
 * @param {string} usage 'apprendre' | 'lire'
 * @param {{ system: string, messages: unknown[], tools?: unknown[], max_tokens?: number }} demande
 * @param {{ apprendre?: string, lire?: string }} surcharges modèles posés par secret
 * @returns {Record<string, unknown> | null}
 */
export function parametresModele(usage, demande, surcharges) {
  if (usage !== 'apprendre' && usage !== 'lire') return null;
  const model = (surcharges && surcharges[usage]) || MODELES_DEFAUT[usage];
  const max = Number.isFinite(demande.max_tokens) && demande.max_tokens > 0 ? Math.min(demande.max_tokens, MAX_TOKENS) : MAX_TOKENS;
  /** @type {Record<string, unknown>} */
  const p = { model, max_tokens: max, system: demande.system, messages: demande.messages, output_config: { effort: EFFORT[usage] } };
  if (Array.isArray(demande.tools) && demande.tools.length) p.tools = demande.tools;
  if (model.startsWith('claude-sonnet-5-5') || model.startsWith('claude-opus-5-5')) {
    p.betas = ['server-side-fallback-2026-07-01'];
    p.fallbacks = 'default';
  }
  return p;
}

/**
 * Coût MAXIMAL d'un appel, réservé contre le plafond avant de le faire (relecture I6) : entrée estimée à un token pour
 * trois caractères (arrondi au-dessus), sortie comptée à `max_tokens`. Le relais régularise ensuite avec le coût réel.
 * @param {{ model: string, max_tokens: number, system?: unknown, messages?: unknown, tools?: unknown }} params
 * @returns {number}
 */
export function coutMaximalUsd(params) {
  const entree = Math.ceil(JSON.stringify({ system: params.system, messages: params.messages, tools: params.tools ?? null }).length / 3);
  return coutUsd(params.model, { input_tokens: entree, output_tokens: params.max_tokens });
}
