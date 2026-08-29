/**
 * useTournees.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour l'optimisation de tournées d'entretien (proposer des
 * contrats dus à insérer dans une journée technicien déjà planifiée, par
 * proximité géographique). Consomme `tourneesService`
 * (src/shared/services/tournees.service.js) — ce fichier ne décide rien, il
 * cache et remonte les erreurs.
 *
 * ⚠️ Asymétrie d'org (cf. bloc de tête du service) : `contracts`, `clients`
 * et `travel_cache` vivent côté CORE (core.organizations.id) tandis que
 * `team_members`/`appointments` vivent côté MAJORDHOME. Les trois méthodes du
 * service attendent donc `coreOrgId` — jamais `orgId` — et dérivent l'org
 * majordhome en interne quand il en faut une (`getJourneesHorizon`). Les
 * hooks ci-dessous reprennent le même nom de paramètre pour ne pas
 * réintroduire cette ambiguïté. Les clés de cache, elles, gardent le nom
 * générique `orgId` de la convention P0.11 (`cacheKeys.js`) — on leur passe
 * la même valeur (le coreOrgId côté appelant).
 * ============================================================================
 */

import { useQuery } from '@tanstack/react-query';
import { tourneesService } from '@services/tournees.service';
import { tourneeKeys } from '@hooks/cacheKeys';

// Re-export for backward compatibility
export { tourneeKeys } from '@hooks/cacheKeys';

/**
 * Contrats actifs dus (aucune visite enregistrée cette année), enrichis de
 * leur durée d'intervention et de leurs contraintes de saison. C'est la
 * liste "candidats" à passer telle quelle à `usePropositions`.
 *
 * @param {string} coreOrgId
 * @returns {import('@tanstack/react-query').UseQueryResult<Array<object>>}
 *   `data` = tableau de `Candidat` (cf. JSDoc du service).
 */
export function useContratsDus(coreOrgId) {
  return useQuery({
    queryKey: tourneeKeys.contratsDus(coreOrgId),
    queryFn: async () => {
      const { data, error } = await tourneesService.getContratsDus({ coreOrgId });
      if (error) throw error;
      return data;
    },
    enabled: !!coreOrgId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Journées de l'horizon (une entrée par technicien inclus dans le routing ×
 * jour disponible), avec leurs RDV déjà posés et la charge déjà occupée.
 * Le filtrage horizon ferme / journée amorcée (spec §3.2) n'est PAS fait ici
 * — à l'écran de croiser `estAmorcee` avec `horizon_ferme_jours` (réglages
 * org), ce hook ne fait que charger et cacher (cf. JSDoc du service).
 *
 * @param {string} coreOrgId
 * @param {number} [joursApres=45]
 * @returns {import('@tanstack/react-query').UseQueryResult<Array<object>>}
 *   `data` = tableau de `Journee` (cf. JSDoc du service).
 */
export function useJourneesHorizon(coreOrgId, joursApres = 45) {
  return useQuery({
    queryKey: tourneeKeys.journees(coreOrgId, joursApres),
    queryFn: async () => {
      const { data, error } = await tourneesService.getJourneesHorizon({ coreOrgId, joursApres });
      if (error) throw error;
      return data;
    },
    enabled: !!coreOrgId,
    staleTime: 60 * 1000,
  });
}

/**
 * Classement des candidats pour une journée donnée (insertion la moins
 * coûteuse dans la tournée déjà posée).
 *
 * `data` (une fois la query résolue) expose l'INTÉGRALITÉ de ce que renvoie
 * `proposerPourJournee` — jamais réduit à la seule liste, sous peine de
 * confondre deux situations qui appellent des messages opposés à l'écran :
 *   - `baseInfaisable: true` → la journée est DÉJÀ en dépassement avant tout
 *     ajout ; `raisonBase` porte la cause (`'budget'|'amplitude'|'fenetre'`).
 *     `propositions` est alors toujours vide — ce n'est PAS "aucun candidat
 *     à proximité", et l'écran doit le dire explicitement.
 *   - `baseInfaisable: false` + `propositions: []` → journée saine, mais
 *     aucun candidat ne s'insère (budget/amplitude/fenêtre une fois ajouté).
 *   - `propositions` non vide → le classement à afficher.
 * `estime: true` → au moins une durée de trajet de la matrice est
 * approximative (fallback haversine, pas un vrai calcul Mapbox) : à signaler.
 *
 * Une erreur du service (ex. dépôt non configuré, `siege_non_configure`) est
 * remontée à React Query (`isError`/`error`) plutôt que masquée dans `data` —
 * ne jamais l'afficher comme "personne à visiter à proximité".
 *
 * @param {object} params
 * @param {object} params.journee  cf. typedef `Journee` du service.
 * @param {object[]} params.candidats  cf. typedef `Candidat` du service
 *   (résultat de `useContratsDus`).
 * @param {string} params.coreOrgId
 * @param {object} params.settings  settings d'org (cf. `useOrgSettings()`),
 *   pour `construireReglages` et `getOrgHeadquarters` côté service.
 * @param {boolean} [params.enabled=true]  garde additionnelle côté appelant
 *   (ex. attendre une sélection explicite de journée dans l'UI).
 * @returns {import('@tanstack/react-query').UseQueryResult<{
 *   propositions: Array<object>,
 *   baseInfaisable: boolean,
 *   raisonBase: ('budget'|'amplitude'|'fenetre'|null),
 *   estime: boolean,
 * }>}
 */
export function usePropositions({ journee, candidats, coreOrgId, settings, enabled = true }) {
  // Empreinte des créneaux occupés. Deux journées de même charge mais dont un
  // RDV a changé d'heure n'ont RIEN à voir pour le classement : trié pour être
  // stable quel que soit l'ordre de retour des RDV, sinon la clé changerait
  // toute seule et relancerait le calcul sans raison.
  const empreinteCreneaux = (journee?.rdvs || [])
    .map((r) => `${r.id}@${r.scheduled_start ?? '?'}`)
    .sort()
    .join('|');

  return useQuery({
    queryKey: tourneeKeys.propositions(
      coreOrgId, journee?.date, journee?.technicienId, journee?.chargeMinutes, empreinteCreneaux,
    ),
    queryFn: async () => {
      const {
        data, baseInfaisable, raisonBase, estime, error,
      } = await tourneesService.proposerPourJournee({
        journee, candidats, coreOrgId, settings,
      });
      if (error) throw error;
      return { propositions: data, baseInfaisable, raisonBase, estime };
    },
    // `settings` manquant (mineur, revue finale) : sans ce test, un panneau
    // ouvert avant la réponse de useOrgSettings() lançait le calcul avec
    // `settings: undefined` → `getOrgHeadquarters(undefined)` retourne null →
    // "siège non configuré" affiché à tort, ET rien ne relance le calcul
    // ensuite puisque la query s'exécute déjà (React Query ne la rejoue pas
    // au seul changement de `settings`, qui n'est pas dans `queryKey`).
    enabled: !!coreOrgId && !!journee && !!candidats?.length && !!settings && enabled,
    staleTime: 5 * 60 * 1000,
  });
}
