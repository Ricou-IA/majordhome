// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/catalogue/enrichissementAppareil.js — ne pas éditer.
// src/lib/catalogue/enrichissementAppareil.js
// Recherche web d'un APPAREIL INSTALLÉ (saisie terrain) — module PUR (aucun import hors ./enrichissement.js), copié
// pour l'edge equipment-model-enrich par `npm run sync:tournee-engine`. Le prompt demande jusqu'à 3 appareils
// candidats quand la saisie est ambiguë ; la lecture ne croit rien sur parole (URL publiques seulement, textes bornés,
// caractéristiques du schéma converties). Spec : docs/superpowers/specs/2026-11-11-referentiel-appareils-installes-saisie-terrain-design.md § 5.

import { urlPublique, extraireJson, convertir } from './enrichissement.js';

const TEXTE_MAX = 200;
const MAX_APPAREILS = 3;
const MAX_SOURCES = 3;

/**
 * Prompt de recherche d'un appareil saisi sur le terrain.
 * @param {{ brand: string, model: string, typeLabel?: string | null }} saisie
 * @param {Array<{ key: string, label: string, unit: string | null, type: string, options?: string[] }>} champs
 * @returns {string}
 */
export function construirePromptAppareil(saisie, champs) {
  const lignes = (champs || []).map((c) => {
    let l = `- ${c.key} : ${c.label}`;
    if (c.unit) l += ` (en ${c.unit})`;
    if (c.type === 'number') l += ' — nombre';
    if (c.type === 'boolean') l += ' — true ou false';
    if (c.options) l += ` — une valeur parmi : ${c.options.join(' | ')}`;
    return l;
  });
  return [
    'Un technicien chauffagiste a relevé chez un client un appareil installé (chauffage, climatisation, eau chaude).',
    'Identifie cet appareil sur le web, de préférence sur le site du fabricant. Il peut ne plus être vendu.',
    '',
    `Marque saisie : ${saisie.brand}`,
    `Modèle saisi : ${saisie.model}`,
    ...(saisie.typeLabel ? [`Type d'appareil : ${saisie.typeLabel}`] : []),
    '',
    `Si la saisie peut désigner plusieurs appareils (tailles, puissances, coloris, générations), donne jusqu'à ${MAX_APPAREILS} candidats, le plus probable d'abord.`,
    'Pour chaque appareil :',
    '- brand : la marque exacte ; model_name : le nom commercial exact ; reference : la référence fabricant (null si inconnue) ;',
    '- category : le type d\'appareil ; en_vente : true s\'il est encore vendu, false sinon, null si tu ne sais pas ;',
    '- photo_url : URL directe d\'une image (.jpg, .png, .webp) ; notice_url : URL directe de la notice en PDF ;',
    '- fiche_url : URL directe de la fiche technique en PDF ; source_urls : les pages lues (3 au plus) ;',
    '- specs : les caractéristiques suivantes, uniquement celles LUES sur une source (null sinon) :',
    ...(lignes.length ? lignes : ['(aucune caractéristique demandée)']),
    '- remarque : ce qui distingue ce candidat des autres, ou une incertitude.',
    'N\'invente rien : mets null plutôt qu\'une valeur d\'un modèle voisin.',
    'Termine ta réponse par un unique objet JSON, sans autre texte après :',
    '{"appareils": [{"brand": string, "model_name": string, "reference": string|null, "category": string|null, "en_vente": boolean|null, "photo_url": string|null, "notice_url": string|null, "fiche_url": string|null, "source_urls": string[], "specs": {"<clé>": valeur|null}, "remarque": string|null}]}',
  ].join('\n');
}

/** Texte non vide borné, sinon null. */
function texte(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim().slice(0, TEXTE_MAX);
  return s || null;
}

/**
 * Lecture tolérante de la réponse de l'IA. Ne lève jamais.
 * @param {string} reponse
 * @param {Array<{ key: string, label: string, unit: string | null, type: string, options?: string[] }>} champs
 * @returns {{ erreur?: 'reponse_illisible' | 'aucun_appareil', appareils: Array<{ brand: string, model_name: string, reference: string | null, category: string | null, en_vente: boolean | null, photo_url: string | null, notice_url: string | null, fiche_url: string | null, source_urls: string[], specs: Record<string, string | number | boolean>, remarque: string | null }> }}
 */
export function lireAppareils(reponse, champs) {
  const o = extraireJson(reponse);
  if (!o) return { erreur: 'reponse_illisible', appareils: [] };
  const brutes = Array.isArray(o.appareils) ? o.appareils : [];
  const url = (v) => (urlPublique(v) ? v : null);
  const appareils = [];
  for (const a of brutes) {
    if (!a || typeof a !== 'object') continue;
    const brand = texte(a.brand);
    const modelName = texte(a.model_name);
    if (!brand || !modelName) continue;
    /** @type {Record<string, string | number | boolean>} */
    const specs = {};
    const s = a.specs && typeof a.specs === 'object' ? a.specs : {};
    for (const c of champs || []) {
      const v = convertir(c, s[c.key]);
      if (v != null) specs[c.key] = v;
    }
    appareils.push({
      brand, model_name: modelName, reference: texte(a.reference), category: texte(a.category),
      en_vente: typeof a.en_vente === 'boolean' ? a.en_vente : null,
      photo_url: url(a.photo_url), notice_url: url(a.notice_url), fiche_url: url(a.fiche_url),
      source_urls: (Array.isArray(a.source_urls) ? a.source_urls : []).filter((u) => urlPublique(u)).slice(0, MAX_SOURCES),
      specs,
      remarque: typeof a.remarque === 'string' && a.remarque.trim() ? a.remarque.trim().slice(0, 500) : null,
    });
    if (appareils.length >= MAX_APPAREILS) break;
  }
  if (!appareils.length) return { erreur: 'aucun_appareil', appareils: [] };
  return { appareils };
}
