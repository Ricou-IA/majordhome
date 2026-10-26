// src/lib/devisCaracteristiques.js
// Module PUR (aucun import React / Supabase / alias) : met en forme les caractéristiques d'un article
// (`specs` du catalogue) en lignes de texte imprimées sous une ligne de devis.
// Le module reçoit le TABLEAU de champs du schéma de la catégorie, jamais le registre `src/shared/specs`.
// Testé : node --test scripts/devis-caracteristiques.test.mjs

/**
 * Remplace les glyphes absents de la police PDF de base (Helvetica / cp1252) et normalise les espaces.
 * @param {unknown} texte
 * @returns {string}
 */
export function pdfSafe(texte) {
  return String(texte ?? '')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/≈/g, '~')
    .replace(/−/g, '-')
    .replace(/↔/g, '<->')
    .replace(/→/g, '->')
    .replace(/×/g, 'x')
    .replace(/[\u202F\u00A0]/g, ' ')
    .trim();
}

/**
 * Valeur brute -> texte (nombre en virgule FR), chaîne vide si rien à imprimer.
 * @param {unknown} valeur
 * @returns {string}
 */
function texteDeValeur(valeur) {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? String(valeur).replace('.', ',') : '';
  return String(valeur).trim();
}

/**
 * Libellé d'une valeur d'enum : option dont `value` (ou la chaîne elle-même) correspond, sinon la valeur telle quelle.
 * @param {{ options?: Array<string | { value: string, label?: string }> }} champ
 * @param {string} texte
 * @returns {string}
 */
function libelleEnum(champ, texte) {
  for (const option of champ.options || []) {
    if (option && typeof option === 'object') {
      if (String(option.value) === texte) return texteDeValeur(option.label) || texte;
    } else if (String(option) === texte) {
      return texte;
    }
  }
  return texte;
}

/**
 * Lignes « Libellé : valeur [unité] » d'un article : champs canoniques dans l'ordre du schéma, puis extras.
 * Un booléen vrai s'imprime « oui », faux n'est pas imprimé ; une valeur vide est sautée.
 * Sans schéma (`champs` vide), le canonique est ignoré et seuls les extras sont imprimés.
 * @param {{ category?: string, specs?: { canonical?: Record<string, unknown> | null, extras?: Array<{ label?: unknown, value?: unknown, unit?: unknown }> | null } } | null | undefined} article
 * @param {Array<{ key: string, label?: string, unit?: string | null, type?: string, options?: Array<string | { value: string, label?: string }> }>} [champs]
 * @returns {string[]}
 */
export function lignesCaracteristiques(article, champs = []) {
  const specs = article?.specs || {};
  const canonical = specs.canonical || {};
  const lignes = [];

  for (const champ of champs || []) {
    if (!champ || !champ.key) continue;
    const brut = canonical[champ.key];
    const libelle = texteDeValeur(champ.label) || champ.key;
    if (champ.type === 'boolean') {
      if (brut === true) lignes.push(pdfSafe(`${libelle} : oui`));
      continue;
    }
    let valeur = texteDeValeur(brut);
    if (!valeur) continue;
    if (champ.type === 'enum') valeur = libelleEnum(champ, valeur);
    else if (champ.unit) valeur = `${valeur} ${champ.unit}`;
    lignes.push(pdfSafe(`${libelle} : ${valeur}`));
  }

  for (const extra of Array.isArray(specs.extras) ? specs.extras : []) {
    const libelle = texteDeValeur(extra?.label);
    const valeur = texteDeValeur(extra?.value);
    if (!libelle || !valeur) continue;
    const unite = texteDeValeur(extra.unit);
    lignes.push(pdfSafe(`${libelle} : ${unite ? `${valeur} ${unite}` : valeur}`));
  }

  return lignes;
}

/**
 * Article d'un id, que la source soit une Map ou un objet.
 * @param {Map<string, object> | Record<string, object> | null | undefined} source
 * @param {string} id
 * @returns {any}
 */
function articleDe(source, id) {
  return source instanceof Map ? source.get(id) : source?.[id];
}

/**
 * Fige les caractéristiques sur les lignes d'un devis : une ligne cochée (`show_specs === true`) rattachée à un
 * article connu reçoit ses lignes de texte ; cochée mais article ABSENT du résultat (non chargé, supprimé, RLS),
 * elle CONSERVE ses `caracteristiques` existantes (jamais vidées en silence, cf. `lignesNonResolues`) ;
 * les autres lignes (décochées, sans article) reçoivent `caracteristiques: []`.
 * Renvoie de NOUVEAUX objets de ligne (aucune mutation).
 * @template {{ show_specs?: boolean, catalog_item_id?: string | null }} L
 * @param {L[]} lines
 * @param {Map<string, { category?: string, specs?: object }> | Record<string, { category?: string, specs?: object }>} articlesParId Map (retour du hook) ou objet indexé par id
 * @param {(category: string | undefined) => Array<{ key: string, label?: string, unit?: string | null, type?: string, options?: Array<string | { value: string, label?: string }> }>} champsParCategorie
 * @returns {Array<L & { caracteristiques: string[] }>}
 */
export function figerCaracteristiques(lines, articlesParId, champsParCategorie) {
  return (lines || []).map((ligne) => {
    const cochee = ligne.show_specs === true && !!ligne.catalog_item_id;
    const article = cochee ? articleDe(articlesParId, ligne.catalog_item_id) : null;
    let caracteristiques = [];
    if (article) caracteristiques = lignesCaracteristiques(article, champsParCategorie(article.category));
    else if (cochee && Array.isArray(ligne.caracteristiques)) caracteristiques = ligne.caracteristiques;
    return { ...ligne, caracteristiques };
  });
}

/**
 * Nombre de lignes cochées (`show_specs === true`, avec `catalog_item_id`) dont l'article est absent du résultat :
 * leurs caractéristiques n'ont pas pu être actualisées (`figerCaracteristiques` les conserve).
 * @param {Array<{ show_specs?: boolean, catalog_item_id?: string | null }>} lines
 * @param {Map<string, object> | Record<string, object>} articlesParId
 * @returns {number}
 */
export function lignesNonResolues(lines, articlesParId) {
  return (lines || []).filter((l) => l.show_specs === true && l.catalog_item_id && !articleDe(articlesParId, l.catalog_item_id)).length;
}
