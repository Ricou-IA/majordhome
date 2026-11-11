// src/lib/equipements/saisieAppareil.js
// Règles PURES de la saisie d'un appareil installé (fenêtre « Ajouter un équipement ») : écriture de référence d'une
// marque, classement des fiches du référentiel et des articles proposés, champs écrits au rattachement, trace de la
// saisie d'origine. Aucun import React / Supabase / alias. Testé : scripts/equipements/saisie-appareil.test.mjs.
// Spec : docs/superpowers/specs/2026-11-11-referentiel-appareils-installes-saisie-terrain-design.md § 3-4.

import { cle, classerModeles } from '../catalogue/nomenclature.js';

/** Distance d'édition (Levenshtein) bornée : renvoie `max + 1` dès qu'elle dépasse `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prec = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cour = [i];
    let minLigne = i;
    for (let j = 1; j <= b.length; j++) {
      cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      minLigne = Math.min(minLigne, cour[j]);
    }
    if (minLigne > max) return max + 1;
    prec = cour;
  }
  return prec[b.length];
}

/**
 * Écriture de référence de la marque saisie. Même clé (sans casse, accents, ponctuation ni espaces) ⇒ `exacte`.
 * Sinon, sur une clé d'au moins 6 caractères, une SEULE marque à une lettre près est proposée (`exacte: false`) ;
 * deux candidates ou plus ⇒ rien, on ne devine pas.
 * @param {string} saisie
 * @param {Array<{ name: string, brand_key: string }>} marques
 * @returns {{ name: string, exacte: boolean } | null}
 */
export function marqueDeReference(saisie, marques) {
  const k = cle(saisie);
  if (!k) return null;
  const liste = marques || [];
  const meme = liste.find((m) => m.brand_key === k);
  if (meme) return { name: meme.name, exacte: true };
  if (k.length < 6) return null;
  const proches = liste.filter((m) => m.brand_key && m.brand_key.length >= 5 && distance(k, m.brand_key, 1) <= 1);
  return proches.length === 1 ? { name: proches[0].name, exacte: false } : null;
}

/**
 * Fiches du référentiel proposées pour la saisie : fusionnées exclues, ordre de `classerModeles`, à score égal les
 * fiches du même type d'équipement d'abord ; seules les fiches qui ressemblent (score > 0) sont gardées.
 * @param {object[]} fiches
 * @param {{ model?: string|null, equipmentTypeId?: string|null }} saisie
 * @returns {object[]}
 */
export function classerAppareils(fiches, saisie) {
  const vivantes = (fiches || []).filter((f) => !f.merged_into);
  const type = saisie?.equipmentTypeId || null;
  return classerModeles(vivantes, { model: saisie?.model })
    .map((c, i) => ({ ...c, i, memeType: type && c.modele.equipment_type_id === type ? 1 : 0 }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || b.memeType - a.memeType || a.i - b.i)
    .map((c) => c.modele);
}

/**
 * Articles du catalogue proposés : ceux dont le nom ou le code contient la clé du modèle saisi (3 caractères au
 * moins), dans l'ordre de ressemblance.
 * @param {object[]} articles lignes de la vue liste des articles (name, code)
 * @param {{ model?: string|null }} saisie
 * @returns {object[]}
 */
export function classerArticles(articles, saisie) {
  const k = cle(saisie?.model);
  if (k.length < 3) return [];
  const retenus = (articles || []).filter((a) => cle(`${a.name || ''} ${a.code || ''}`).includes(k));
  const parId = new Map(retenus.map((a) => [a.id, a]));
  return classerModeles(retenus.map((a) => ({ id: a.id, model_name: a.name, name: a.name, reference: a.code || '' })), { model: saisie?.model })
    .map((c) => parId.get(c.modele.id));
}

/**
 * Trace de la saisie d'avant nettoyage, rangée dans `equipments.metadata.saisie_origine`.
 * @param {{ brand?: string|null, model?: string|null }} equipement
 * @param {string} par
 * @param {string} le date AAAA-MM-JJ
 * @returns {{ brand: string|null, model: string|null, le: string, par: string }}
 */
export function saisieOrigine(equipement, par, le) {
  return { brand: equipement?.brand ?? null, model: equipement?.model ?? null, le, par };
}

/**
 * true si la saisie a vraiment changé (casse, accents, espaces et ponctuation ignorés). Une vraie modification de la
 * marque ou du modèle détache l'équipement de sa fiche : on ne garde pas un rattachement à un autre appareil.
 * @param {string|null|undefined} avant
 * @param {string|null|undefined} apres
 * @returns {boolean}
 */
export function saisieModifiee(avant, apres) {
  return cle(avant) !== cle(apres);
}

/**
 * Message de la recherche dans la base locale : une erreur de lecture ne se dit jamais « rien trouvé » (elle pousserait
 * vers une recherche web payante et une fiche en double). `null` quand il y a des résultats et pas d'erreur.
 * @param {{ erreur?: unknown, nbFiches: number, nbArticles: number, brand: string, model: string }} etat
 * @returns {string|null}
 */
export function messageBaseLocale({ erreur, nbFiches, nbArticles, brand, model }) {
  const vide = !nbFiches && !nbArticles;
  if (erreur && vide) return 'La base n\'a pas pu être lue : réessayez « Vérifier » avant de chercher sur le web.';
  if (erreur) return 'Liste incomplète : une partie de la base n\'a pas pu être lue.';
  if (vide) return `Rien de ressemblant dans la base pour « ${[brand, model].filter(Boolean).join(' ')} ».`;
  return null;
}

const SUITE = 'enregistrez l\'appareil tel quel, il pourra être rattaché plus tard.';
const MESSAGES_RPC = {
  fiche_fabricant: 'Une fiche relevée chez le fabricant ne se corrige pas ici.',
  fiche_fabricant_survit: 'Une fiche relevée chez le fabricant ne peut pas être absorbée : fusionnez dans l\'autre sens.',
  fiche_fusionnee: 'Cette fiche a déjà été fusionnée.',
  org_admin_required: 'Réservé à l\'administrateur.',
  clients_edit_required: 'Vous n\'avez pas le droit de modifier les fiches client.',
  marque_vide: 'La marque ne peut pas être vide.',
};

/**
 * Message à afficher pour un échec de la recherche web, de la création ou du contrôle d'une fiche. Ne lève jamais.
 * @param {{ code?: string|null, message?: string|null } | null | undefined} err
 * @returns {string}
 */
export function messageErreurAppareil(err) {
  const code = err?.code || null;
  const message = String(err?.message || '');
  if (code === 'quota') return `${message || 'Plafond de recherches web atteint'} : ${SUITE}`;
  if (code === 'delai') return `La recherche a pris trop de temps : réessayez, ou ${SUITE}`;
  if (code === 'droit') return 'Vous n\'avez pas le droit de modifier les fiches client.';
  // la clé la plus longue d'abord : « fiche_fabricant_survit » contient « fiche_fabricant »
  const cles = Object.keys(MESSAGES_RPC).sort((a, b) => b.length - a.length);
  for (const cleRpc of cles) if (message.includes(cleRpc)) return MESSAGES_RPC[cleRpc];
  return `La recherche n'a pas abouti : ${SUITE}`;
}

/**
 * Champs écrits sur l'équipement quand il se rattache à une fiche : marque de référence (majuscules), nom du modèle
 * de la fiche, et ligne fournisseur d'origine de l'article lié s'il y en a un.
 * @param {{ id: string, brand: string, model_name: string, catalog_source_product_id?: string|null }} fiche
 * @returns {{ brand: string, model: string, equipmentModelId: string, supplierProductId: string|null }}
 */
export function champsRattachement(fiche) {
  return {
    brand: String(fiche.brand || '').trim().toUpperCase(),
    model: String(fiche.model_name || '').trim(),
    equipmentModelId: fiche.id,
    supplierProductId: fiche.catalog_source_product_id ?? null,
  };
}
