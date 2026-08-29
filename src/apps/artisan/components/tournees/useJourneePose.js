// useJourneePose.js - Majord'home Artisan
// ============================================================================
// Logique métier de RemplirJourneePanel : sélection des candidats, aperçu
// local en direct, calcul des trajets RÉELS au moment de la pose, chaînage
// canonique de création (ensureEntretienCard -> reload -> scheduleEntretien).
// Extrait du composant pour rester sous la limite de 500 LOC (convention
// projet) et parce que "pas de logique business dans le JSX".
//
// Aperçu EN DIRECT pendant la sélection (cases à cocher) : purement local,
// via `trajetLocal` (vol d'oiseau, src/lib/tournee/matrice.js) — la matrice
// Mapbox du classement initial (`usePropositions`) ne compare JAMAIS deux
// candidats entre eux (cf. tournees.service.js), donc dès que ≥2 candidats
// sont cochés il n'existe AUCUNE distance réelle pour cette paire. Annoncé à
// l'écran comme un aperçu, distinct du bandeau `estime` du classement.
//
// Au moment de la POSE en revanche, les horaires écrits en base ne sortent
// JAMAIS de cet aperçu local : `calculerHorairesReels` rappelle
// `trajetsService.chargerMatrice` en plaçant le dépôt + les arrêts existants +
// TOUS les candidats retenus dans le `noyau` (candidats:[]), ce qui obtient
// pour une fois les distances réelles entre eux. Un seul appel réseau, au
// clic sur « Poser », pas à chaque case cochée. Si cet appel échoue ou revient
// estimé, la pose n'est pas bloquée mais passe par une confirmation explicite
// avant d'écrire des horaires approximatifs.
//
// Chaînage de pose CANONIQUE du projet (unique writer du cycle carte<->RDV) :
// `ensureEntretienCard` (anti-doublon, survit à la fermeture du panneau) ->
// recharge de la carte enrichie -> `savService.scheduleEntretien` (pose le
// RDV avec `intervention_id` + fait avancer `workflow_status`). PAS d'appel
// direct à `appointmentsService.createAppointmentBatch` : un RDV posé sans
// `intervention_id` n'apparaîtrait dans aucune carte du Kanban Entretiens.
// Boucle SÉQUENTIELLE par candidat qui continue même après un échec isolé
// (best-effort réel — cf. règle "jamais un succès global sur une pose
// partielle").
// ============================================================================

import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { tourneeKeys, appointmentKeys, interventionKeys } from '@hooks/cacheKeys';
import { ensureEntretienCard } from '@services/entretiens.service';
import { savService } from '@services/sav.service';
import { trajetsService } from '@services/trajets.service';
import { supabase } from '@lib/supabaseClient';
import { logger } from '@lib/logger';
import {
  placerPlusieurs, placerCandidat, finDeJournee, chargeExistante,
} from '@/lib/tournee/creneaux.js';
import { cleCoord } from '@/lib/tournee/geo.js';
import { construireMatrice, trajetLocal } from '@/lib/tournee/matrice.js';
import { RAISON_LABELS, minutesEnHHMM, messageErreur } from './tourneesPanelUtils';
import { ecrireAjustements } from './useAjustementsJournee';

/**
 * @param {object} params
 * @param {object|null} params.journee
 * @param {object|null} params.depot        getOrgHeadquarters(settings)
 * @param {object} params.reglages          construireReglages(settings)
 * @param {Array} params.arretsExistants    [{id,key,dureeMinutes}] dérivés de journee.rdvs
 * @param {Array|undefined} params.propositions  data.propositions de usePropositions
 * @param {string} params.coreOrgId
 * @param {object} params.user              useAuth().user
 * @param {Function} params.onClose
 * @param {Map<string, number>|null} [params.paires]  matrice de trajets du
 *   classement (`usePropositions`). L'aperçu calcule DESSUS, complétée au vol
 *   d'oiseau pour les seules paires qu'elle n'a pas — sans quoi la barre et la
 *   liste affichent deux heures différentes pour le même client.
 * @param {string|null} [params.survoleId]  candidat survolé dans la liste — son
 *   heure est calculée COMME S'IL ÉTAIT COCHÉ en plus des autres, pour que
 *   survoler puis cliquer ne change pas le chiffre affiché.
 * @param {Map<string, number>} [params.decalages]  décalages manuels en attente
 *   (useAjustementsJournee) — `journee` est DÉJÀ ajustée, ceci ne sert qu'à
 *   savoir quels RDV existants doivent être RÉÉCRITS en base au moment de poser.
 * @param {Map<string, number>} [params.durees]  durées manuelles en attente
 * @param {Function} [params.retirerAjustements]  (ids[]) => void
 */
export function useJourneePose({
  journee, depot, reglages, arretsExistants, propositions, coreOrgId, user, onClose,
  decalages, durees, retirerAjustements, paires, survoleId,
}) {
  const queryClient = useQueryClient();

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [calculatingReel, setCalculatingReel] = useState(false);
  const [posing, setPosing] = useState(false);
  const [resultatPose, setResultatPose] = useState(null); // { posesCount, echecs, decalesCount }
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingReel, setPendingReel] = useState(null);

  const toggleSelection = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setResultatPose(null);
  }, []);

  const selectionnees = useMemo(
    () => (propositions || []).filter((p) => selectedIds.has(p.candidat.id)),
    [propositions, selectedIds],
  );

  /** Contexte commun aux deux calculs (aperçu local et trajets réels). */
  const contexte = useCallback((trajet) => ({
    trajet,
    depotKey: cleCoord(depot),
    amplitude: journee.amplitude,
    budgetMinutes: journee.budgetMinutes,
    pause: {
      minutes: reglages.pause_minutes,
      fenetre: [reglages.pause_fenetre[0] * 60, reglages.pause_fenetre[1] * 60],
    },
  }), [depot, journee, reglages]);

  // Trajets de l'aperçu : la matrice DU CLASSEMENT en priorité, complétée au vol
  // d'oiseau pour les paires qu'elle ne contient pas (candidat↔candidat, que
  // `proposerPourJournee` ne demande jamais à Mapbox — il n'évalue qu'un
  // candidat à la fois).
  //
  // Le tout-vol-d'oiseau d'avant faisait diverger la barre de la liste : le
  // 09/09, un client annoncé « passage prévu 11:56 » dans sa ligne était dessiné
  // à 13:34 sur la barre juste au-dessus. Sur un écran où l'on décide d'une
  // heure à annoncer au client, deux chiffres contradictoires ne se départagent
  // pas à l'œil.
  const trajetApercu = useMemo(
    () => (paires ? construireMatrice(paires, { repli: trajetLocal }) : trajetLocal),
    [paires],
  );

  // Aperçu sans réseau : aucun appel supplémentaire, on réutilise ce qui a déjà
  // été chargé pour le classement.
  //
  // Même modèle que le classement (creneaux.js) : les RDV posés sont fixes, on
  // insère dans les trous. Utiliser un modèle différent ici ferait dire à
  // l'aperçu le contraire de ce que la liste vient de proposer.
  const simulerAvec = useCallback((candidats) => {
    const ctx = contexte(trajetApercu);
    const { places, refuses, arretsFinaux } = placerPlusieurs(arretsExistants, candidats, ctx);
    return {
      places,
      refuses,
      planning: places.map((p) => ({
        id: p.candidat.id,
        arriveeMinutes: p.placement.arriveeMinutes,
        departMinutes: p.placement.departMinutes,
        attenteMinutes: p.placement.attenteMinutes,
      })),
      finMinutes: finDeJournee(arretsFinaux, ctx),
      chargeMinutes: chargeExistante(arretsFinaux, ctx),
    };
  }, [arretsExistants, contexte, trajetApercu]);

  const recalcul = useMemo(() => {
    if (!depot || !journee) return null;
    return simulerAvec(selectionnees.map((p) => p.candidat));
  }, [depot, journee, selectionnees, simulerAvec]);

  // Même simulation, avec le candidat survolé ajouté à la sélection : survoler
  // répond à « et si je cochais celui-ci ? ». Passer par un autre calcul pour
  // le survol produisait un écart avec le clic — 13 h 35 au survol, 13 h 32 une
  // fois coché (vu le 2026-08-29). Un chiffre qui bouge entre le moment où on
  // le lit et celui où on l'accepte ne peut pas servir à décider.
  const recalculSurvol = useMemo(() => {
    if (!depot || !journee || !survoleId || selectedIds.has(survoleId)) return null;
    const survole = (propositions || []).find((p) => p.candidat.id === survoleId);
    if (!survole) return null;
    return simulerAvec([...selectionnees.map((p) => p.candidat), survole.candidat]);
  }, [depot, journee, survoleId, selectedIds, propositions, selectionnees, simulerAvec]);

  // Heure de passage de CHAQUE candidat pris seul, pour les lignes ni cochées
  // ni survolées. Calculée ici et nulle part ailleurs : le `placement` que
  // remonte le classement sert à ORDONNER (coût), pas à afficher une heure —
  // il vient d'un autre contexte de calcul, et deux contextes finissent
  // toujours par diverger de quelques minutes.
  const placementsSolo = useMemo(() => {
    if (!depot || !journee) return new Map();
    const ctx = contexte(trajetApercu);
    const m = new Map();
    for (const p of propositions || []) {
      const place = placerCandidat({ arrets: arretsExistants, candidat: p.candidat, ...ctx });
      if (place.faisable) m.set(p.candidat.id, place);
    }
    return m;
  }, [depot, journee, propositions, arretsExistants, contexte, trajetApercu]);

  /**
   * Heure à afficher pour un candidat — SOURCE UNIQUE de tous les horaires du
   * panneau (lignes et barre). Priorité : la simulation qui le contient déjà.
   */
  const heureDe = useCallback((candidatId) => {
    if (recalculSurvol) {
      const p = recalculSurvol.planning.find((x) => x.id === candidatId);
      if (p) return p;
    }
    const dansSelection = recalcul?.planning.find((x) => x.id === candidatId);
    if (dansSelection) return dansSelection;
    // Une ligne cochée que la sélection ne place plus n'affiche AUCUNE heure :
    // son placement solo serait faux, et le pied de panneau la nomme déjà.
    if (selectedIds.has(candidatId)) return null;
    return placementsSolo.get(candidatId) || null;
  }, [recalculSurvol, recalcul, selectedIds, placementsSolo]);

  const calculerHorairesReels = useCallback(async () => {
    const noyau = [
      depot,
      // Un arrêt sans coordonnées (key null) bloque son créneau côté séquencement
      // mais n'a rien à envoyer à Mapbox : écarté ici seulement.
      ...arretsExistants.filter((a) => a.key).map((a) => {
        const [lat, lng] = a.key.split(',').map(Number);
        return { lat, lng };
      }),
      ...selectionnees.map((p) => ({ lat: p.candidat.meta.lat, lng: p.candidat.meta.lng })),
    ];
    try {
      const { data: pairesReelles, estime: matriceEstimee, error: matriceErr } = await trajetsService.chargerMatrice({
        coreOrgId, noyau, candidats: [],
      });
      if (matriceErr) {
        logger.error('[useJourneePose] chargerMatrice (pose)', matriceErr);
        return { ...recalcul, estime: true };
      }
      const ctx = contexte(construireMatrice(pairesReelles, { repli: trajetLocal }));
      const { places, refuses, arretsFinaux } = placerPlusieurs(
        arretsExistants, selectionnees.map((p) => p.candidat), ctx,
      );
      return {
        places,
        refuses,
        planning: places.map((p) => ({
          id: p.candidat.id,
          arriveeMinutes: p.placement.arriveeMinutes,
          departMinutes: p.placement.departMinutes,
          attenteMinutes: p.placement.attenteMinutes,
        })),
        finMinutes: finDeJournee(arretsFinaux, ctx),
        chargeMinutes: chargeExistante(arretsFinaux, ctx),
        estime: matriceEstimee,
      };
    } catch (err) {
      // Repli explicite sur l'aperçu déjà affiché (vol d'oiseau), marqué estimé —
      // jamais un blocage total de la pose sur un souci réseau ponctuel.
      logger.error('[useJourneePose] calculerHorairesReels', err);
      return { ...recalcul, estime: true };
    }
  }, [coreOrgId, depot, arretsExistants, selectionnees, contexte, recalcul]);

  // Seuls les candidats RÉELLEMENT placés sont posés. Un candidat refusé au
  // moment du calcul réel (le trou s'est refermé depuis la proposition) ne doit
  // pas être écrit avec des horaires inventés — il ressort dans `refuses`.
  const construireOrdonnees = useCallback((resultat) => {
    return (resultat?.planning || [])
      .filter((p) => selectedIds.has(p.id))
      .map((p) => ({ ...p, meta: selectionnees.find((s) => s.candidat.id === p.id)?.candidat.meta }))
      .filter((p) => p.meta);
  }, [selectedIds, selectionnees]);

  // Écriture des ajustements : implémentation PARTAGÉE avec la carte de la liste
  // (useAjustementsJournee.js). Bloquante par construction dans ce contexte — les
  // horaires calculés pour les nouveaux RDV supposent que les anciens ont bougé.
  const appliquerAjustementsEnBase = useCallback(
    () => ecrireAjustements(journee?.rdvs, decalages, durees),
    [decalages, durees, journee],
  );

  const executerPose = useCallback(async (resultat) => {
    setPosing(true);
    setResultatPose(null);
    try {
      const ordonnees = construireOrdonnees(resultat);
      if (ordonnees.length === 0) return;

      // Les RDV existants d'abord : les créneaux des nouveaux en dépendent.
      const { ids: idsAjustes, echec: echecAjustement } = await appliquerAjustementsEnBase();
      if (idsAjustes.length > 0) retirerAjustements?.(idsAjustes);
      if (echecAjustement) {
        setResultatPose({ posesCount: 0, decalesCount: idsAjustes.length, echecs: [echecAjustement] });
        await queryClient.invalidateQueries({ queryKey: tourneeKeys.all(coreOrgId) });
        toast.error(
          `Déplacement impossible (${echecAjustement.nom}) — aucun rendez-vous posé`
          + (idsAjustes.length > 0 ? `, ${idsAjustes.length} RDV déjà déplacé${idsAjustes.length > 1 ? 's' : ''}.` : '.'),
        );
        return;
      }

      const idsPoses = [];
      const echecs = [];

      for (const p of ordonnees) {
        // try/catch PAR ITÉRATION (fix round 2, Finding B) : ni ensureEntretienCard
        // ni la recharge de carte n'ont de garde interne — sans ce filet ICI, une
        // EXCEPTION (pas juste une erreur `{error}` renvoyée) sur un candidat
        // arrêtait net toute la boucle. Conséquence vécue : 2 RDV déjà écrits en
        // base pour les 2 premiers candidats, le 3ᵉ lève, la boucle s'interrompt
        // AVANT setResultatPose et AVANT l'invalidation des caches — l'écran ne
        // montre ni bilan ni les 2 RDV pourtant posés, et un nouvel essai
        // dupliquerait leurs RDV (l'anti-doublon d'ensureEntretienCard protège la
        // CARTE, pas le RDV). Une exception ici doit compter comme un échec pour
        // CE candidat et laisser les suivants s'exécuter, exactement comme une
        // erreur `{error}` renvoyée.
        try {
          const { interventionId, error: ensureErr } = await ensureEntretienCard({
            clientId: p.meta.clientId,
            contractId: p.meta.contractId,
            visitDate: journee.date,
            userId: user?.id,
          });
          if (ensureErr || !interventionId) {
            echecs.push({ nom: p.meta.clientName, message: messageErreur(ensureErr, 'carte introuvable') });
            continue;
          }

          // Filtre org_id explicite même si RLS couvre déjà (charte du projet,
          // défense en profondeur multi-tenant — mineur, revue finale).
          const { data: card, error: cardErr } = await supabase
            .from('majordhome_entretien_sav')
            .select('*')
            .eq('id', interventionId)
            .eq('org_id', coreOrgId)
            .maybeSingle();
          if (cardErr || !card) {
            echecs.push({ nom: p.meta.clientName, message: messageErreur(cardErr, 'carte introuvable après création') });
            continue;
          }

          const { error: schedErr } = await savService.scheduleEntretien({
            card,
            coreOrgId,
            slots: [{
              date: journee.date,
              startTime: minutesEnHHMM(p.arriveeMinutes),
              endTime: minutesEnHHMM(p.departMinutes),
              duration: p.departMinutes - p.arriveeMinutes,
              technicianIds: [journee.technicienId],
              subject: `Entretien — ${p.meta.clientName}`,
            }],
          });
          if (schedErr) {
            echecs.push({ nom: p.meta.clientName, message: messageErreur(schedErr, 'erreur inconnue') });
          } else {
            idsPoses.push(p.id);
          }
        } catch (err) {
          logger.error('[useJourneePose] executerPose — exception sur un candidat', p.meta?.clientName, err);
          echecs.push({ nom: p.meta?.clientName || 'client', message: err?.message || 'exception inattendue' });
        }
      }

      // Le bilan et l'invalidation s'exécutent TOUJOURS après la boucle, quoi
      // qu'il soit arrivé pendant celle-ci — plus aucun `continue`/exception
      // interne ne peut sauter jusqu'ici sans y passer, la boucle ne peut plus
      // se terminer prématurément (cf. try/catch par itération ci-dessus).
      setResultatPose({ posesCount: idsPoses.length, decalesCount: idsAjustes.length, echecs });

      if (idsPoses.length > 0 || idsAjustes.length > 0) {
        // Ne retire de la sélection que ce qui a réussi : les échecs restent
        // cochés pour permettre un nouvel essai sans dupliquer les RDV déjà posés.
        if (idsPoses.length > 0) {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            idsPoses.forEach((id) => next.delete(id));
            return next;
          });
        }
        try {
          // Attend la fin du refetch avant de rendre la main : un nouvel essai
          // doit voir la journée à jour (charge/RDV), pas l'ancienne capturée
          // avant la pose (TourneesTab dérive `selectedJournee` en direct des
          // données de useJourneesHorizon, cf. TourneesTab.jsx).
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: tourneeKeys.all(coreOrgId) }),
            queryClient.invalidateQueries({ queryKey: appointmentKeys.all(coreOrgId) }),
            queryClient.invalidateQueries({ queryKey: interventionKeys.all(coreOrgId) }),
          ]);
        } catch (err) {
          // Ne bloque JAMAIS le bilan déjà affiché : les RDV sont déjà écrits en
          // base, seule l'invalidation du cache React Query a échoué (l'écran se
          // rafraîchira au prochain remount/staleTime).
          logger.error('[useJourneePose] executerPose — invalidation cache', err);
        }
      }

      const mentionDecales = idsAjustes.length > 0
        ? ` · ${idsAjustes.length} RDV déplacé${idsAjustes.length > 1 ? 's' : ''}` : '';
      if (echecs.length === 0) {
        toast.success(`${idsPoses.length} rendez-vous posé${idsPoses.length > 1 ? 's' : ''}${mentionDecales}`);
        onClose();
      } else if (idsPoses.length > 0) {
        toast.error(
          `${idsPoses.length}/${ordonnees.length} rendez-vous posés — échec sur ${echecs.map((e) => e.nom).join(', ')}`,
        );
      } else {
        toast.error(`Aucun rendez-vous posé — échec sur ${echecs.map((e) => e.nom).join(', ')}`);
      }
    } catch (err) {
      // Filet de dernier recours : ne devrait plus se déclencher pour un échec
      // de candidat (capté par le try/catch par itération ci-dessus) — reste
      // pour un bug structurel (ex. construireOrdonnees) survenant AVANT toute
      // écriture, auquel cas il n'y a rien à dupliquer et un message générique
      // suffit.
      logger.error('[useJourneePose] executerPose', err);
      toast.error(`Erreur : ${err.message || 'pose échouée'}`);
    } finally {
      setPosing(false);
    }
  }, [
    construireOrdonnees, journee, user, coreOrgId, queryClient, onClose,
    appliquerAjustementsEnBase, retirerAjustements,
  ]);

  const handlePoserClick = useCallback(async () => {
    if (!coreOrgId || !depot || selectionnees.length === 0) return;
    setCalculatingReel(true);
    setResultatPose(null);
    let reel;
    try {
      reel = await calculerHorairesReels();
    } finally {
      // Relâché AVANT de brancher vers la confirmation ou la pose elle-même :
      // sinon le bouton resterait affiché "Vérification des trajets…" pendant
      // toute la pose (calculatingReel et posing seraient vrais en même temps).
      setCalculatingReel(false);
    }
    // Plus de verdict global « faisable » : le modèle place chaque candidat
    // dans un trou, indépendamment des autres. Ce qui bloque, c'est qu'AUCUN
    // des candidats cochés n'ait trouvé sa place une fois les trajets réels
    // connus.
    if (!reel?.places?.length) {
      const raison = reel?.refuses?.[0]?.raison;
      toast.error(`Cette sélection ne tient plus — ${RAISON_LABELS[raison] || 'plus de créneau disponible'}.`);
      return;
    }
    // Deux motifs de confirmation, cumulables : des horaires approximatifs
    // (Mapbox indisponible) et/ou le déplacement de RDV déjà annoncés à des
    // clients. Le second n'est pas un détail technique — on va réécrire une
    // heure que quelqu'un attend chez lui.
    if (reel.estime || (decalages?.size ?? 0) > 0 || (durees?.size ?? 0) > 0) {
      setPendingReel(reel);
      setConfirmOpen(true);
      return;
    }
    await executerPose(reel);
  }, [coreOrgId, depot, selectionnees, calculerHorairesReels, executerPose, decalages, durees]);

  const handleConfirmApprox = useCallback(async () => {
    const reel = pendingReel;
    setConfirmOpen(false);
    setPendingReel(null);
    if (reel) await executerPose(reel);
  }, [pendingReel, executerPose]);

  const handleCancelApprox = useCallback(() => {
    setConfirmOpen(false);
    setPendingReel(null);
  }, []);

  return {
    selectedIds,
    toggleSelection,
    recalcul,
    calculatingReel,
    posing,
    resultatPose,
    recalculSurvol,
    heureDe,
    confirmOpen,
    // Ce qui a déclenché la confirmation, pour que le dialogue dise exactement
    // ce qu'on s'apprête à faire plutôt qu'un avertissement générique.
    confirmEstime: pendingReel?.estime === true,
    handlePoserClick,
    handleConfirmApprox,
    handleCancelApprox,
  };
}
