// scripts/fumisterie/fixtures/g1-o150.mjs — extrait RÉEL du tarif MAYER002 (juin 2026), Ø150.
const A = (reference, name, tarif_public, purchase_price_ht, attrs) => ({ id: reference, reference, name, unit: 'pièce', tarif_public, purchase_price_ht, is_active: true, ...attrs });
const ptrI = { gamme_tarif: 'PTR30+ I', couleur: 'inox', diametre_int: 150 };
const ptrN = { gamme_tarif: 'PTR30+ LAQ', couleur: 'noir', diametre_int: 150 };
export const ARTICLES = [
  A('2PTICHARN150', 'PTR30+ I - CHAPEAU ANTI REFOULEUR 2024 - D 150', 173.4, 86.7, { ...ptrI, type_piece: 'chapeau_anti_refouleur' }),
  A('2PTICHARN150NO', 'PTR30+ LAQ - CHAPEAU ANTI REFOULEUR 2024 - D 150 - INOX NOIR', 216.7, 108.35, { ...ptrN, type_piece: 'chapeau_anti_refouleur' }),
  A('2PTIELDR1501000', 'PTR30+ I - ELT DROIT - D 150 - LG 1000', 216.9, 108.45, { ...ptrI, type_piece: 'element_droit', longueur_mm: 1000 }),
  A('2PTIELDR150500', 'PTR30+ I - ELT DROIT - D 150 - LG 500', 154.8, 77.4, { ...ptrI, type_piece: 'element_droit', longueur_mm: 500 }),
  A('2PTIELDR150250', 'PTR30+ I - ELT DROIT - D 150 - LG 250', 125, 62.5, { ...ptrI, type_piece: 'element_droit', longueur_mm: 250 }),
  A('2PTIELDR1501000NO', 'PTR30+ LAQ - ELT DROIT - D 150 - LG 1000 - INOX NOIR', 260.3, 130.15, { ...ptrN, type_piece: 'element_droit', longueur_mm: 1000 }),
  A('2PTIELDR150500NO', 'PTR30+ LAQ - ELT DROIT - D 150 - LG 500 - INOX NOIR', 185.7, 92.85, { ...ptrN, type_piece: 'element_droit', longueur_mm: 500 }),
  A('2PTIELDR150250NO', 'PTR30+ LAQ - ELT DROIT - D 150 - LG 250 - INOX NOIR', 149.9, 74.95, { ...ptrN, type_piece: 'element_droit', longueur_mm: 250 }),
  A('2PTIELRE150500', 'PTR30+ I - ELT REGLABLE - D 150 - LG 320 A 520', 215.2, 107.6, { ...ptrI, type_piece: 'element_reglable', longueur_mm: 320, longueur_max_mm: 520 }),
  A('2PTIELRE150500NO', 'PTR30+ LAQ - ELT REGLABLE - D 150 - LG 320 A 500 - INOX NOIR', 258.3, 129.15, { ...ptrN, type_piece: 'element_reglable', longueur_mm: 320, longueur_max_mm: 500 }),
  A('2PTICO15150', 'PTR30+ I - COUDE 15° - D 150', 141.2, 70.6, { ...ptrI, type_piece: 'coude', angle: 15 }),
  A('2PTICO30150', 'PTR30+ I - COUDE 30° - D 150', 141.2, 70.6, { ...ptrI, type_piece: 'coude', angle: 30 }),
  A('2PTICO45150', 'PTR30+ I - COUDE 45° - D 150', 141.2, 70.6, { ...ptrI, type_piece: 'coude', angle: 45 }),
  A('2PTICOJO150', 'PTR30+ I - COLLIER DE JONCTION - D 150 ( D EXT 210 )', 19.6, 9.8, { ...ptrI, type_piece: 'collier_jonction', diametre_ext: 210 }),
  A('2PTICOJO150NO', 'PTR30+ LAQ - COLLIER DE JONCTION - D 150 ( D EXT 210 ) - INOX NOIR', 25.2, 12.6, { ...ptrN, type_piece: 'collier_jonction', diametre_ext: 210 }),
  A('2PTIPPDR150', 'PTR30+ I - PLAQUE DE PROPRETE RT2012 - 560 X 560 - D 150 - INOX', 97.9, 48.95, { ...ptrI, type_piece: 'plaque_proprete' }),
  A('2PTGCOCF150', 'PTR30+ G - COURONNE COUPE FEU - D 150 ( D EXT 210 )', 33.6, 16.8, { gamme_tarif: 'PTR30+ G', couleur: 'galva', diametre_int: 150, type_piece: 'couronne_coupe_feu' }),
  A('2PTIRASR150148', 'PTR30+ I - RACCORD SIMPLE PAROI REDUIT - D 150 / D 148', 110.3, 55.15, { ...ptrI, type_piece: 'raccord_simple_paroi' }),
  A('2DIVCTOS150', 'COLLIER UNIVERSEL (SOUS TOIT) - D 150 - GALVA', 66, 34.98, { gamme_tarif: 'COLLIER UNIVERSEL (SOUS TOIT)', couleur: 'galva', diametre_int: 150, type_piece: 'collier_sous_toiture' }),
  A('2DIVS1525IN230KEI', 'SOLIN 15 A 25° INOX - PTR D 150', 180.1, 72.04, { gamme_tarif: 'SOLIN INOX', couleur: 'inox', diametre_int: 150, type_piece: 'solin', pente_min: 15, pente_max: 25 }),
  A('2DIVS2535IN230KEI', 'SOLIN 25 A 35° INOX - PTR D 150', 218.1, 87.24, { gamme_tarif: 'SOLIN INOX', couleur: 'inox', diametre_int: 150, type_piece: 'solin', pente_min: 25, pente_max: 35 }),
  A('2DIVS3040IN230KEI', 'SOLIN 30 A 40° INOX - PTR D 150', 218.1, 87.24, { gamme_tarif: 'SOLIN INOX', couleur: 'inox', diametre_int: 150, type_piece: 'solin', pente_min: 30, pente_max: 40 }),
  A('2LEPTUYA1501000NO', 'EMAIL LIGNE + - TUYAU - D 150 - LG 1000 - NOIR', 67.4, 26.96, { gamme_tarif: 'EMAIL LIGNE +', couleur: 'noir', diametre_int: 150, type_piece: 'element_droit', longueur_mm: 1000 }),
  A('2LEPTUYA150500NO', 'EMAIL LIGNE + - TUYAU - D 150 - LG 500 - NOIR', 43.8, 17.52, { gamme_tarif: 'EMAIL LIGNE +', couleur: 'noir', diametre_int: 150, type_piece: 'element_droit', longueur_mm: 500 }),
  A('2LEPTUYA150250NO', 'EMAIL LIGNE + - TUYAU - D 150 - LG 250 - NOIR', 33.9, 13.56, { gamme_tarif: 'EMAIL LIGNE +', couleur: 'noir', diametre_int: 150, type_piece: 'element_droit', longueur_mm: 250 }),
];
import { readFileSync } from 'node:fs';
export const COMPOSANTS = JSON.parse(readFileSync(new URL('../data/cfg24-composants.json', import.meta.url), 'utf8'));
export const MAPPING = JSON.parse(readFileSync(new URL('../data/cfg24-mapping.json', import.meta.url), 'utf8'));
export const GABARIT = JSON.parse(readFileSync(new URL('../data/gabarit-g1.json', import.meta.url), 'utf8'));
export const CONFIGURATION = { code: 'CFG-24', gabarit_code: 'G1', gamme_principale: 'PTR30' };
export const RELEVE = { diametre: 150, finition: 'noir', hBuse: 1.05, hsp1: 2.5, epPl: 0.25, nbEtages: 1, hsp2: 2.5,
  hCombles: 1.4, pente: 35, epToit: 0.3, dFaitage: 1.6, angle: 30, decal: 0.4, hSortie: 1.6 };
