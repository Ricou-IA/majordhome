// src/shared/services/tournees.service.js
// ============================================================================
// Assemblage des données pour le moteur de tournées. Le service ne décide rien :
// il charge, normalise, appelle le moteur pur (src/lib/tournee/*) et rend le
// résultat. Spec : docs/superpowers/specs/2026-08-29-optimisation-tournees-entretiens-design.md
//
// ⚠️ ASYMÉTRIE D'ORG (cf. supabase/migrations/20260829_1_tournees_socle.sql et
// src/shared/services/trajets.service.js) :
//   - CORE (`core.organizations.id`, ex. 3c68193e-…) porte `contracts`, `clients`,
//     `pricing_equipment_types` et `travel_cache`.
//   - MAJORDHOME (`majordhome.organizations.id`, ex. 7825fe43-…) porte
//     `team_members` et `appointments`.
// Les paramètres sont donc nommés `coreOrgId` partout où l'espace CORE est
// requis (`getContratsDus`, `proposerPourJournee`, tout appel à
// `trajetsService.chargerMatrice`) — jamais `orgId`, pour ne pas reproduire
// l'ambiguïté déjà vécue ailleurs dans ce projet. `getJourneesHorizon` reçoit
// `coreOrgId` et dérive l'org majordhome en interne via `getMajordhomeOrgId()`
// pour lire `team_members`/`appointments`.
// ============================================================================

import { supabase } from '@lib/supabaseClient';
import { logger } from '@lib/logger';
import { getMajordhomeOrgId } from '@lib/serviceHelpers';
import { getOrgHeadquarters } from '@lib/territoire-config';
import { trajetsService } from '@services/trajets.service';
import { getPlannedContractIds } from '@services/entretiens.service';
import { dureeContrat, construireFallbacks } from '@/lib/tournee/duree.js';
import { scoreEligibilite } from '@/lib/tournee/eligibilite.js';
import {
  cleCoord, barycentre, filtreProximite, haversineKm,
} from '@/lib/tournee/geo.js';
import { construireMatrice } from '@/lib/tournee/matrice.js';
import { classerParCreneaux } from '@/lib/tournee/creneaux.js';
import { construireArretsExistants } from '@/lib/tournee/arrets.js';
import { chargerJournees } from '@/lib/tournee/loaders.js';
import { construireReglages } from '@/lib/tournee/reglages.js';

/**
 * @typedef {object} Candidat
 * @property {string} contractId
 * @property {string} clientId
 * @property {string} clientName
 * @property {string} ville
 * @property {number|null} lat
 * @property {number|null} lng
 * @property {number} dureeMinutes
 * @property {number|null} moisAnniversaire  1-12, null si `start_date` absente
 * @property {number[]} moisDefavorables
 * @property {boolean} estSaisonnier
 * @property {number} typesNonRenseignes  équipements du contrat sans `equipment_type_id`
 */

/**
 * @typedef {object} Journee
 * @property {string} date  YYYY-MM-DD
 * @property {string} technicienId
 * @property {string} technicienNom
 * @property {string|null} couleur
 * @property {{ debut: number, fin: number }} amplitude  minutes depuis minuit
 * @property {number} budgetMinutes
 * @property {Array<object>} rdvs  RDV du jour pour ce technicien (colonnes
 *   majordhome_appointments + `lat`/`lng` résolus via majordhome_clients —
 *   `null` si le RDV n'a pas de `client_id` ou que le client n'est pas géocodé)
 * @property {number} chargeMinutes  somme des `duration_minutes`, TOUS les RDV
 *   (avec ou sans coordonnées : un RDV sans position occupe quand même le technicien)
 * @property {boolean} estAmorcee  au moins un RDV de type 'maintenance' ce jour-là
 */

// Défauts et fusion des réglages : src/lib/tournee/reglages.js (source unique,
// partagée avec l'edge slots-propose). Ré-exportés ici pour les appelants existants.
export { REGLAGES_DEFAUT, construireReglages } from '@/lib/tournee/reglages.js';

export const tourneesService = {
  /**
   * Contrats actifs sans visite enregistrée cette année, enrichis de leur durée
   * d'intervention et de leurs contraintes de saison.
   *
   * @param {{ coreOrgId: string }} params  org CORE — contracts/clients/
   *   pricing_equipment_types vivent tous côté core.organizations (cf. bloc
   *   d'asymétrie en tête de fichier).
   * @returns {Promise<{ data: Candidat[], error: Error|null }>}
   */
  async getContratsDus({ coreOrgId }) {
    try {
      const [{ data: contrats, error: cErr }, { data: types, error: tErr }] = await Promise.all([
        supabase.from('majordhome_contracts')
          .select('id, client_id, client_name, client_city, client_postal_code, start_date, current_year_visit_status')
          .eq('org_id', coreOrgId).eq('status', 'active'),
        // Pas de filtre is_active ici, volontairement : un équipement déjà installé chez
        // un client garde sa durée d'entretien réelle même si son type n'est plus
        // commercialisé — le filtrer basculerait ces contrats sur le fallback à tort.
        supabase.from('majordhome_pricing_equipment_types')
          .select('id, code, category, duration_base_minutes, duration_per_extra_unit_minutes, included_units, unfavorable_months')
          .eq('org_id', coreOrgId),
      ]);
      if (cErr) return { data: [], error: cErr };
      if (tErr) return { data: [], error: tErr };

      // Allowlist positive, jamais une interdiction négative (charte du projet) :
      // NULL = aucune visite enregistrée cette année => c'est ça, et seulement ça, qui
      // définit "dû". Toute AUTRE valeur — `completed` (fait), `cancelled` (le client a
      // explicitement refusé lors d'une campagne d'appels, cf. recordVisit({ status:
      // 'cancelled' })), `scheduled` (RDV déjà programmé), ou un statut futur non prévu
      // ici — signifie que le sujet est déjà traité d'une façon ou d'une autre. Un
      // statut inconnu ne doit JAMAIS être interprété comme "à faire" par défaut : avec
      // l'ancien filtre `!== 'completed'`, les 9 contrats `cancelled` mesurés en prod
      // repassaient en candidat — reproposer un créneau à un refus explicite — et un
      // futur `scheduled` y serait passé aussi, ouvrant un risque de RDV en doublon.
      const dusBruts = (contrats || []).filter((c) => c.current_year_visit_status === null);
      if (dusBruts.length === 0) return { data: [], error: null };

      // C3 — un contrat déjà attaché à une carte d'entretien NON TERMINALE ne
      // doit plus apparaître comme "dû" : `savService.scheduleEntretien` pose
      // le RDV et fait avancer `workflow_status` mais n'écrit AUCUNE
      // `maintenance_visit` — `current_year_visit_status` reste donc NULL, et
      // sans cette exclusion le même contrat resurgit pour la journée
      // suivante, un autre technicien, ou la même journée rouverte : un
      // second clic pose un second RDV sur la même carte (doublon silencieux).
      // Même garde-fou que l'onglet Programmation voisin (Entretiens.jsx,
      // "sinon l'outil de Programmation reproposerait de la planifier"),
      // réutilisé tel quel plutôt que réinventé.
      const { data: planifies, error: plErr } = await getPlannedContractIds({ orgId: coreOrgId });
      if (plErr) return { data: [], error: plErr };
      const dusNonPlanifies = dusBruts.filter((c) => !planifies.has(c.id));
      if (dusNonPlanifies.length === 0) return { data: [], error: null };

      // Cas voisin : un client avec 2 contrats dus produirait 2 candidats à
      // la même adresse, cochables ENSEMBLE dans RemplirJourneePanel — alors
      // que la voie canonique de pose (ensureEntretienCard) les rattache à LA
      // MÊME carte (1 visite couvre tous les équipements du client). Cocher
      // les deux poserait un second RDV sur cette carte unique. Un seul
      // candidat par client (le premier rencontré ; les deux contrats sont de
      // toute façon couverts par la même visite).
      const dus = [];
      const clientsVus = new Set();
      for (const c of dusNonPlanifies) {
        if (c.client_id && clientsVus.has(c.client_id)) continue;
        if (c.client_id) clientsVus.add(c.client_id);
        dus.push(c);
      }
      if (dus.length === 0) return { data: [], error: null };

      const clientIds = [...new Set(dus.map((c) => c.client_id).filter(Boolean))];
      const [{ data: clients, error: clErr }, { data: liens, error: lErr }] = await Promise.all([
        supabase.from('majordhome_clients')
          .select('id, latitude, longitude').eq('org_id', coreOrgId).in('id', clientIds),
        supabase.from('majordhome_contract_equipments')
          .select('contract_id, equipment_id').in('contract_id', dus.map((c) => c.id)),
      ]);
      if (clErr) return { data: [], error: clErr };
      if (lErr) return { data: [], error: lErr };

      const equipIds = [...new Set((liens || []).map((l) => l.equipment_id))];
      const { data: equipements, error: eqErr } = equipIds.length
        ? await supabase.from('majordhome_equipments')
            .select('id, category, unit_count, equipment_type_id').in('id', equipIds)
        : { data: [], error: null };
      if (eqErr) return { data: [], error: eqErr };

      const typesById = new Map((types || []).map((t) => [t.id, t]));
      const equipById = new Map((equipements || []).map((e) => [e.id, e]));
      const coordsById = new Map((clients || []).map((c) => [c.id, c]));

      const fallbacks = construireFallbacks(equipements || [], typesById, 90);

      const parContrat = new Map();
      for (const l of liens || []) {
        if (!parContrat.has(l.contract_id)) parContrat.set(l.contract_id, []);
        const eq = equipById.get(l.equipment_id);
        if (eq) parContrat.get(l.contract_id).push(eq);
      }

      const candidats = dus.map((c) => {
        const eqs = parContrat.get(c.id) || [];
        const co = coordsById.get(c.client_id);
        const moisDefavorables = [...new Set(eqs.flatMap((e) => {
          const t = e.equipment_type_id ? typesById.get(e.equipment_type_id) : null;
          return t?.unfavorable_months || [];
        }))];
        return {
          contractId: c.id,
          clientId: c.client_id,
          clientName: c.client_name,
          ville: c.client_city,
          lat: co?.latitude ?? null,
          lng: co?.longitude ?? null,
          dureeMinutes: dureeContrat(eqs, typesById, fallbacks),
          moisAnniversaire: c.start_date ? new Date(c.start_date).getMonth() + 1 : null,
          moisDefavorables,
          estSaisonnier: moisDefavorables.length > 0,
          typesNonRenseignes: eqs.filter((e) => !e.equipment_type_id).length,
        };
      });

      return { data: candidats, error: null };
    } catch (error) {
      logger.error('[tournees] getContratsDus', error);
      return { data: [], error };
    }
  },

  /**
   * Journées de l'horizon par technicien inclus dans l'optimisation
   * (`include_in_routing = true`). `estAmorcee` = la journée contient déjà au
   * moins un entretien : au-delà de l'horizon ferme (`reglages.horizon_ferme_jours`,
   * cf. `construireReglages`), seules ces journées sont proposables (spec §3.2).
   * ⚠️ Ce filtrage horizon/amorçage n'est PAS appliqué ici : ce service charge
   * et annote, il ne décide pas quelles journées afficher. À l'appelant de
   * croiser `estAmorcee` avec le décalage en jours et `horizon_ferme_jours`.
   *
   * @param {{ coreOrgId: string, joursApres?: number }} params  org CORE — dérive
   *   l'org majordhome en interne (team_members/appointments vivent côté
   *   majordhome, cf. bloc d'asymétrie en tête de fichier).
   * @returns {Promise<{ data: Journee[], error: Error|null }>}
   */
  /**
   * Créneaux optimisés pour UN contrat — calcul côté serveur (edge slots-propose,
   * même moteur que l'onglet). Outil « machine-usable » : même entrée/sortie
   * pour le CTA de ContractModal et, demain, le serveur MCP (Hermes/Vapi).
   *
   * @param {{ coreOrgId: string, contractId: string, constraints?: {
   *   technician_id?: string, date_from?: string, date_to?: string,
   *   periode?: 'matin'|'apres_midi', jours_semaine_exclus?: number[], dates_exclues?: string[]
   * }, maxResults?: number }} params
   * @returns {Promise<{ data: object|null, error: Error|null }>}  `error.message` porte le
   *   code de l'edge (`siege_non_configure`, `client_non_localise`, `aucun_technicien`, …)
   */
  async proposerPourContrat({ coreOrgId, contractId, constraints = {}, maxResults = 4 }) {
    const { data, error } = await supabase.functions.invoke('slots-propose', {
      body: { org_id: coreOrgId, contract_id: contractId, constraints, max_results: maxResults },
    });
    if (error) {
      // supabase-js enveloppe les réponses non-2xx : le code métier est dans le corps.
      let detail = error.message;
      try {
        const payload = await error.context?.json?.();
        if (payload?.error) detail = payload.error;
      } catch {
        // Corps non-JSON : on garde le message brut plutôt que de le masquer.
      }
      logger.error('[tournees] proposerPourContrat', detail);
      return { data: null, error: new Error(detail) };
    }
    return { data: data?.data ?? null, error: null };
  },

  async getJourneesHorizon({ coreOrgId, joursApres = 45 }) {
    // Logique déplacée dans src/lib/tournee/loaders.js (injectable, partagée
    // avec l'edge slots-propose). Ici : résolution de l'org majordhome + client de l'app.
    try {
      const mdhOrgId = await getMajordhomeOrgId(coreOrgId);
      const { data, error } = await chargerJournees({ client: supabase, coreOrgId, mdhOrgId, joursApres, logger });
      return { data, error };
    } catch (error) {
      logger.error('[tournees] getJourneesHorizon', error);
      return { data: [], error };
    }
  },

  /**
   * Classement des candidats pour une journée donnée. Deux étages : filtre
   * haversine puis matrice Mapbox sur les seuls survivants (spec §4.2).
   * Ne fait AUCUN filtrage d'horizon/amorçage (spec §3.2) : c'est à l'appelant
   * de ne solliciter cette méthode que pour une `journee` déjà jugée proposable.
   *
   * @param {{ journee: Journee, candidats: Candidat[], coreOrgId: string, settings: object, maxCandidats?: number }} params
   *   `coreOrgId` — seul utilisé pour `trajetsService.chargerMatrice` (le cache
   *   `travel_cache` est FK vers core.organizations, cf. bloc d'asymétrie en
   *   tête de fichier). `maxCandidats` — override explicite (tests) ; par
   *   défaut `reglages.max_candidats_tri` (I2, jamais figé en dur).
   * @returns {Promise<{
   *   data: Array<{ candidat: { id: string, key: string|null, dureeMinutes: number, meta: (Candidat & { eligibilite: object }) }, coutMinutes: number, detourMinutes: number, scoreFinal: number, placement: object }>,
   *   chargeMinutes: number,
   *   raisonsRejet: Record<('creneau'|'budget'|'pause'|'position'), number>,
   *   paires: Map<string, number>|null,
   *   estime: boolean,
   *   error: (Error|null),
   * }>}
   *   Deux états à distinguer, jamais confondus dans un simple tableau vide :
   *     1. `error` non-null (dépôt non configuré via `siege_non_configure`, ou
   *        échec technique) → ne JAMAIS afficher comme « personne à visiter ».
   *     2. `data: []` → aucun candidat ne s'insère ; `raisonsRejet` dit
   *        POURQUOI (plus de trou assez grand, budget atteint, pause menacée,
   *        client non géolocalisé) plutôt que de laisser l'écran deviner.
   *
   *   ⚠️ Plus de `baseInfaisable` : une journée déjà posée n'est pas
   *   « infaisable », elle EST. Le moteur ne la juge plus, il cherche seulement
   *   où un candidat se glisse (cf. bloc de tête de creneaux.js).
   */
  async proposerPourJournee({ journee, candidats, coreOrgId, settings, maxCandidats }) {
    try {
      const reglages = construireReglages(settings);
      const limiteCandidats = maxCandidats ?? reglages.max_candidats_tri;
      const depot = getOrgHeadquarters(settings);
      if (!depot) {
        return {
          data: [], chargeMinutes: 0, raisonsRejet: {}, estime: false, paires: null,
          error: new Error('siege_non_configure'),
        };
      }

      // C2 — un rendez-vous déjà pris est un ENGAGEMENT, pas une préférence :
      // helper partagé avec RemplirJourneePanel.jsx (même dérivation, une
      // seule fois) qui verrouille sa fenêtre sur son heure réelle.
      const arretsExistants = construireArretsExistants(journee.rdvs, depot);

      const centre = barycentre([
        ...(journee.rdvs || []).filter((r) => r.lat != null),
        depot,
      ]) || depot;

      const moisCible = Number(journee.date.slice(5, 7));
      const proches = filtreProximite(candidats, centre, reglages.rayon_filtre_km);

      const scores = {};
      const enrichis = proches.map((c) => {
        const s = c.moisAnniversaire
          ? scoreEligibilite({
              moisAnniversaire: c.moisAnniversaire,
              moisCible,
              moisDefavorables: c.moisDefavorables,
              toleranceMois: reglages.tolerance_anniversaire_mois,
              moisCreux: reglages.mois_creux,
              estSaisonnier: c.estSaisonnier,
            })
          : { score: 0.5, dansTolerance: false, saisonDefavorable: false, bonusCreux: false };
        scores[c.contractId] = s.score;
        return { ...c, eligibilite: s, distanceKm: haversineKm(centre, c) };
      });

      // I2 — le pré-tri jetait précisément les voisins : avec ~300 candidats
      // dans le rayon (25 km), trier sur le seul score calendaire puis couper
      // à `limiteCandidats` (avant tout calcul de coût) écartait
      // systématiquement un client à 3 min de la tournée au profit d'un
      // client éligible mais lointain — l'inverse de la raison d'être du
      // module. Le coût d'insertion exact (Mapbox) est trop cher sur 300
      // candidats, mais la distance à vol d'oiseau au barycentre est
      // gratuite et déjà calculée ci-dessus : rang combiné (Borda) sur le
      // score ET la distance, chacun classé séparément puis les deux rangs
      // additionnés — ni l'un ni l'autre axe ne peut à lui seul écarter un
      // candidat qui excelle sur l'autre, sans arbitrer un poids relatif
      // arbitraire entre deux grandeurs d'échelles différentes (score
      // sans unité, distance en km).
      const parScoreDesc = [...enrichis].sort((a, b) => b.eligibilite.score - a.eligibilite.score);
      const parDistanceAsc = [...enrichis].sort((a, b) => a.distanceKm - b.distanceKm);
      const rangScore = new Map(parScoreDesc.map((c, i) => [c.contractId, i]));
      const rangDistance = new Map(parDistanceAsc.map((c, i) => [c.contractId, i]));

      const notes = [...enrichis]
        .sort((a, b) => (rangScore.get(a.contractId) + rangDistance.get(a.contractId))
          - (rangScore.get(b.contractId) + rangDistance.get(b.contractId)))
        .slice(0, limiteCandidats);

      // trajetsService.chargerMatrice attend désormais { noyau, candidats } séparés
      // (plus jamais un seul tableau `points`) : le noyau = dépôt + arrêts déjà
      // posés (comparés entre eux ET à chaque candidat), les candidats ne sont
      // jamais comparés les uns aux autres (placerCandidat n'en teste qu'un à la
      // fois). Les deux paramètres doivent toujours être des tableaux (jamais
      // undefined) — dépot garantit noyau non vide, notes peut être [].
      // Les arrêts sans coordonnées (key null) bloquent bien leur créneau dans le
      // séquencement, mais n'ont rien à envoyer à Mapbox : on les écarte ici.
      const noyau = [depot, ...arretsExistants
        .filter((a) => a.key)
        .map((a) => {
          const [lat, lng] = a.key.split(',').map(Number);
          return { lat, lng };
        })];
      const { data: paires, estime, error: matriceErr } = await trajetsService.chargerMatrice({
        coreOrgId, noyau, candidats: notes,
      });
      // Aucun chemin connu de chargerMatrice ne renseigne cette erreur aujourd'hui (Mapbox/cache
      // KO y sont absorbés en estime:true avec un logger.error interne) — mais si elle apparaît
      // un jour, poursuivre sur une matrice partielle en annonçant un succès serait exactement
      // l'échec silencieux que ce projet proscrit : on la propage plutôt que de l'ignorer.
      if (matriceErr) {
        return {
          data: [], chargeMinutes: 0, raisonsRejet: {}, estime: false, paires: null, error: matriceErr,
        };
      }
      const trajet = construireMatrice(paires);

      const ctx = {
        depotKey: cleCoord(depot),
        trajet,
        amplitude: journee.amplitude,
        budgetMinutes: journee.budgetMinutes,
        pause: {
          minutes: reglages.pause_minutes,
          fenetre: [reglages.pause_fenetre[0] * 60, reglages.pause_fenetre[1] * 60],
        },
      };

      const { classement, chargeMinutes, raisonsRejet } = classerParCreneaux(
        arretsExistants,
        notes.map((c) => ({
          id: c.contractId, key: cleCoord(c), dureeMinutes: c.dureeMinutes, meta: c,
        })),
        ctx,
        { scoreParId: scores },
      );

      // `paires` remonte avec le classement : l'aperçu du panneau doit calculer
      // sur EXACTEMENT la même matrice, sinon la barre place un client à une
      // heure et la ligne juste en dessous en annonce une autre.
      return {
        data: classement, chargeMinutes, raisonsRejet, estime, paires, error: null,
      };
    } catch (error) {
      logger.error('[tournees] proposerPourJournee', error);
      return { data: [], chargeMinutes: 0, raisonsRejet: {}, estime: false, paires: null, error };
    }
  },
};
