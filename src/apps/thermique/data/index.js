// Point d'entrée unique des données de référence du module Thermique.
// ⚠ communes.json (~7 Mo) et pac-catalogue.json (~4 Mo) sont volumineux → import() dynamique uniquement.
export { default as climat } from './climat.json';
export { default as materiaux } from './materiaux.json';
export { default as paroisTypes } from './parois-types.json';
export { default as uDefauts } from './u-defauts.json';
export { default as menuiseries } from './menuiseries.json';
export { default as coefficientsB } from './coefficients-b.json';
export { default as ventilation } from './ventilation.json';
export { default as tarifsEnergie } from './tarifs-energie.json';
export const loadCommunes = () => import('./communes.json').then((m) => m.default);
export const loadPacCatalogue = () => import('./pac-catalogue.json').then((m) => m.default);
