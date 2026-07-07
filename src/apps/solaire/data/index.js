// Point d'entrée des données de référence du module Solaire (bundlées, 8760 h).
// Régénérables via scripts/fetch-enedis-res{1,2}-profile.mjs et scripts/fetch-pvgis-fixture.mjs.
import enedisRes1 from './enedis-res1-base-normalized.json';
import enedisRes2 from './enedis-res2-base-normalized.json';

export { default as pvgisExample } from './pvgis-gaillac-1kwc.json';
export { enedisRes1, enedisRes2 };
// Alias legacy : le talon par défaut = RES1 (foyer sans chauffage électrique).
export const enedisProfile = enedisRes1;

// Profils de consommation type proposés à l'utilisateur (Step2) : pilotent le talon
// horaire du constat d'autoconso ET la répartition « depuis l'annuel ». Le talon d'un
// foyer chauffé à l'électricité (RES2) a une silhouette hiver très différente de RES1.
export const CONSO_PROFILES = {
  RES1: {
    key: 'RES1',
    label: 'Sans chauffage électrique',
    hint: 'Gaz, fioul, bois, PAC…',
    hourly: enedisRes1.hourly,
  },
  RES2: {
    key: 'RES2',
    label: 'Avec chauffage électrique',
    hint: 'Convecteurs, radiateurs, planchers élec',
    hourly: enedisRes2.hourly,
  },
};

/** Talon horaire (8760, Σ=1) du profil sélectionné ; fallback RES1 si inconnu. */
export function consoProfileHourly(profileKey) {
  return (CONSO_PROFILES[profileKey] || CONSO_PROFILES.RES1).hourly;
}
