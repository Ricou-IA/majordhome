// Parseurs des fiches menuiseries du logiciel Thermique historique.
//
// Format commun aux 5 fichiers sources (Vitrages.txt, Menuiseries.txt, Volets.txt,
// WarmEdge.txt, CoffreVolets.txt) : une ligne par entrée, toute la ligne entre guillemets,
// champs séparés par des tabulations, avec un champ vide final (tabulation traînante avant
// le guillemet fermant). Fin de ligne CRLF. Encodage ANSI/Windows-1252 (accents FR).
//
// Exemple brut (Vitrages.txt) :
//   "Saint-Gobain - double vitrage - Planitherm argon\t4/12/4\t0.70\t1.40\t0.81\t"
// -> champs : [nom, format, g?, ug, TL?, ""]
//
// Menuiseries.txt / Volets.txt / WarmEdge.txt / CoffreVolets.txt n'ont que 2 champs utiles :
//   [nom, valeur, ""]
import { unquote, parseFrNumber } from './sourceFiles.js';

/** Déballe chaque ligne non vide "a\tb\t..." -> ['a','b',...] (guillemets retirés, split tab). */
export function parseTabQuoted(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    rows.push(unquote(raw).split('\t'));
  }
  return rows;
}

/**
 * Vitrages.txt : nom \t format \t g \t ug \t TL \t ""
 * Le 4e champ (index 3) est le Ug (W/(m².K)) — confirmé par l'exemple métier
 * "double vitrage 4/16/4 argon" -> ug 1.10, qui correspond à la ligne
 * "Planilux + Planitherm Ultra N + Argon 90%\t4/16/4\t0.64\t1.10\t0.81".
 * g (index 2, facteur solaire) et TL (index 4, transmission lumineuse) existent dans la
 * source mais ne font pas partie du besoin cible (vitrages: nom+ug) ; non exposés ici.
 * @returns {{nom:string, format:string, ug:number}[]}
 */
export function parseVitrages(text) {
  const out = [];
  for (const c of parseTabQuoted(text)) {
    const ug = parseFrNumber(c[3]);
    if (!c[0] || ug == null) continue;
    out.push({ nom: c[0].trim(), format: (c[1] || '').trim(), ug });
  }
  return out;
}

/**
 * Menuiseries.txt : nom \t uf \t ""  (Uf = coefficient de la menuiserie/profil, W/(m².K))
 * @returns {{nom:string, uf:number}[]}
 */
export function parseMenuiseriesProfils(text) {
  const out = [];
  for (const c of parseTabQuoted(text)) {
    const uf = parseFrNumber(c[1]);
    if (!c[0] || uf == null) continue;
    out.push({ nom: c[0].trim(), uf });
  }
  return out;
}

/**
 * Volets.txt : nom \t deltaR \t ""  (résistance thermique additionnelle apportée par la
 * fermeture, m².K/W — utilisée dans le calcul Ujour/Unuit des baies).
 * @returns {{nom:string, deltaR:number}[]}
 */
export function parseVolets(text) {
  const out = [];
  for (const c of parseTabQuoted(text)) {
    const deltaR = parseFrNumber(c[1]);
    if (!c[0] || deltaR == null) continue;
    out.push({ nom: c[0].trim(), deltaR });
  }
  return out;
}

/**
 * WarmEdge.txt : nom \t psi \t ""  (coefficient linéique de l'intercalaire de vitrage
 * "warm edge", W/(m.K)) — grandeur différente de ug/uf/deltaR, hors du besoin cible
 * (vitrages/menuiseriesTypes/volets/fenetresTypes) mais conservée car source explicitement
 * à inspecter par la tâche.
 * @returns {{nom:string, psi:number}[]}
 */
export function parseWarmEdge(text) {
  const out = [];
  for (const c of parseTabQuoted(text)) {
    const psi = parseFrNumber(c[1]);
    if (!c[0] || psi == null) continue;
    out.push({ nom: c[0].trim(), psi });
  }
  return out;
}

/**
 * CoffreVolets.txt : nom \t uc \t ""  (coefficient de transmission thermique du coffre de
 * volet roulant, W/(m².K)).
 * @returns {{nom:string, uc:number}[]}
 */
export function parseCoffresVolets(text) {
  const out = [];
  for (const c of parseTabQuoted(text)) {
    const uc = parseFrNumber(c[1]);
    if (!c[0] || uc == null) continue;
    out.push({ nom: c[0].trim(), uc });
  }
  return out;
}
