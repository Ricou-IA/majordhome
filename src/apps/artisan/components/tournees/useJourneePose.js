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
import { sequencerTournee } from '@/lib/tournee/sequence.js';
import { cleCoord } from '@/lib/tournee/geo.js';
import { construireMatrice, trajetLocal } from '@/lib/tournee/matrice.js';
import { RAISON_LABELS, minutesEnHHMM, messageErreur } from './tourneesPanelUtils';

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
 */
export function useJourneePose({
  journee, depot, reglages, arretsExistants, propositions, coreOrgId, user, onClose,
}) {
  const queryClient = useQueryClient();

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [calculatingReel, setCalculatingReel] = useState(false);
  const [posing, setPosing] = useState(false);
  const [resultatPose, setResultatPose] = useState(null); // { posesCount, echecs }
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

  // Aperçu LOCAL, pur, sans réseau — peut rester estimé pendant la sélection,
  // annoncé comme tel dans le footer par le composant appelant.
  const recalcul = useMemo(() => {
    if (!depot || !journee) return null;
    const arrets = [...arretsExistants, ...selectionnees.map((p) => p.candidat)];
    return sequencerTournee({
      depotKey: cleCoord(depot),
      arrets,
      trajet: trajetLocal,
      amplitude: journee.amplitude,
      budgetMinutes: journee.budgetMinutes,
      pause: {
        minutes: reglages.pause_minutes,
        fenetre: [reglages.pause_fenetre[0] * 60, reglages.pause_fenetre[1] * 60],
      },
    });
  }, [depot, journee, arretsExistants, selectionnees, reglages]);

  const calculerHorairesReels = useCallback(async () => {
    const arrets = [...arretsExistants, ...selectionnees.map((p) => p.candidat)];
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
      const { data: paires, estime: matriceEstimee, error: matriceErr } = await trajetsService.chargerMatrice({
        coreOrgId, noyau, candidats: [],
      });
      if (matriceErr) {
        logger.error('[useJourneePose] chargerMatrice (pose)', matriceErr);
        return { ...recalcul, estime: true };
      }
      const trajetReel = construireMatrice(paires);
      const resultat = sequencerTournee({
        depotKey: cleCoord(depot),
        arrets,
        trajet: trajetReel,
        amplitude: journee.amplitude,
        budgetMinutes: journee.budgetMinutes,
        pause: {
          minutes: reglages.pause_minutes,
          fenetre: [reglages.pause_fenetre[0] * 60, reglages.pause_fenetre[1] * 60],
        },
      });
      return { ...resultat, estime: matriceEstimee };
    } catch (err) {
      // Repli explicite sur l'aperçu déjà affiché (vol d'oiseau), marqué estimé —
      // jamais un blocage total de la pose sur un souci réseau ponctuel.
      logger.error('[useJourneePose] calculerHorairesReels', err);
      return { ...recalcul, estime: true };
    }
  }, [coreOrgId, depot, journee, arretsExistants, selectionnees, reglages, recalcul]);

  const construireOrdonnees = useCallback((resultat) => {
    if (!resultat?.faisable) return [];
    return resultat.planning
      .filter((p) => selectedIds.has(p.id))
      .map((p) => ({ ...p, meta: selectionnees.find((s) => s.candidat.id === p.id)?.candidat.meta }))
      .filter((p) => p.meta);
  }, [selectedIds, selectionnees]);

  const executerPose = useCallback(async (resultat) => {
    setPosing(true);
    setResultatPose(null);
    try {
      const ordonnees = construireOrdonnees(resultat);
      if (ordonnees.length === 0) return;

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
      setResultatPose({ posesCount: idsPoses.length, echecs });

      if (idsPoses.length > 0) {
        // Ne retire de la sélection que ce qui a réussi : les échecs restent
        // cochés pour permettre un nouvel essai sans dupliquer les RDV déjà posés.
        setSelectedIds((prev) => {
          const next = new Set(prev);
          idsPoses.forEach((id) => next.delete(id));
          return next;
        });
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

      if (echecs.length === 0) {
        toast.success(`${idsPoses.length} rendez-vous posé${idsPoses.length > 1 ? 's' : ''}`);
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
  }, [construireOrdonnees, journee, user, coreOrgId, queryClient, onClose]);

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
    if (!reel?.faisable) {
      toast.error(`Cette sélection ne tient plus — ${RAISON_LABELS[reel?.raison] || reel?.raison || 'raison inconnue'}.`);
      return;
    }
    if (reel.estime) {
      setPendingReel(reel);
      setConfirmOpen(true);
      return;
    }
    await executerPose(reel);
  }, [coreOrgId, depot, selectionnees, calculerHorairesReels, executerPose]);

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
    confirmOpen,
    handlePoserClick,
    handleConfirmApprox,
    handleCancelApprox,
  };
}
