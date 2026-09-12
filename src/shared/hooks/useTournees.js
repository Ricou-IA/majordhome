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
import { useOrgSettings } from '@hooks/useOrgSettings';
import { construireReglages } from '@/lib/tournee/reglages.js';

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
  // Les durées des candidats dépendent des réglages d'org (gain multi-équipements) :
  // la clé les porte pour qu'un changement de réglage recalcule la liste.
  const { settings } = useOrgSettings();
  const gainMultiPct = construireReglages(settings).gain_multi_equipements_pct ?? 0;
  return useQuery({
    queryKey: [...tourneeKeys.contratsDus(coreOrgId), { gainMultiPct }],
    queryFn: async () => {
      const { data, error } = await tourneesService.getContratsDus({ coreOrgId, settings });
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
 *   - `propositions: []` → aucun candidat ne trouve sa place ; `raisonsRejet`
 *     compte les motifs (`creneau`/`budget`/`pause`/`position`) et DOIT être
 *     affiché : « aucun entretien » tout court laisse croire qu'il n'y a
 *     personne à visiter dans le secteur, alors que la cause est souvent
 *     ailleurs (journée pleine, clients non géolocalisés).
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
 *   chargeMinutes: number,
 *   raisonsRejet: Record<('creneau'|'budget'|'pause'|'position'), number>,
 *   paires: Map<string, number>|null,  matrice de trajets du classement — à
 *     réutiliser pour tout aperçu, sous peine d'afficher deux heures
 *     différentes pour le même client,
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
        data, chargeMinutes, raisonsRejet, estime, paires, error,
      } = await tourneesService.proposerPourJournee({
        journee, candidats, coreOrgId, settings,
      });
      if (error) throw error;
      // ⚠️ Tout ce que le service calcule doit ressortir ICI. Une clé oubliée
      // dans ce retour n'est pas une erreur visible : elle vaut `undefined` à
      // l'écran, qui affiche alors sa branche « rien à dire ». Vécu le
      // 2026-08-29 en basculant sur le modèle « créneaux » — `raisonsRejet`
      // était calculé, puis jeté ici, et l'écran annonçait « aucun entretien à
      // proposer » sans jamais pouvoir dire pourquoi.
      return {
        propositions: data, chargeMinutes, raisonsRejet, estime, paires,
      };
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

/**
 * Créneaux optimisés pour un contrat (edge slots-propose). `staleTime: 0` : un
 * RDV posé entre-temps change la réponse. Pas de retry : les erreurs sont
 * métier (siège non configuré, client non localisé…) et l'écran les affiche.
 */
export function useCreneauxProposes({ orgId, contractId, constraints = {}, enabled = true }) {
  return useQuery({
    queryKey: tourneeKeys.creneauxContrat(orgId, contractId, constraints),
    queryFn: async () => {
      const { data, error } = await tourneesService.proposerPourContrat({ coreOrgId: orgId, contractId, constraints });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!contractId && enabled,
    staleTime: 0,
    retry: false,
  });
}
