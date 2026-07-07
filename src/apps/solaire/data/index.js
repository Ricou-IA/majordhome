// Point d'entrée des données de référence du module Solaire (bundlées, 8760 h).
// Régénérables via scripts/fetch-enedis-res1-profile.mjs et scripts/fetch-pvgis-fixture.mjs.
export { default as enedisProfile } from './enedis-res1-base-normalized.json';
export { default as pvgisExample } from './pvgis-gaillac-1kwc.json';
