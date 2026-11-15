/**
 * usePlanningCharge.js - Majord'home Artisan
 * ============================================================================
 * Charge du Planning, en un seul endroit : état des journées (moteur de
 * tournées), lignes par technicien et par jour, CA HT programmé et son cumul.
 * Les règles sont dans les modules purs (src/lib/planningCharge.js,
 * src/lib/planningCa.js) ; ce hook ne fait que réunir les données.
 *
 * La charge lit les RDV de la plage, restreints aux personnes du filtre équipe.
 * Sous un filtre de type ou de statut, ces RDV sont partiels : les lignes ne
 * disent alors plus qu'une journée est vide (`rdvsPartiels`).
 * ============================================================================
 */

import { useMemo } from 'react';
import { useEtatsJournees } from '@hooks/useTournees';
import { usePlanningCa } from '@hooks/usePlanningCa';
import { lignesDeCharge } from '@/lib/planningCharge';
import { cumulPeriode } from '@/lib/planningCa';

const AUCUNE_LIGNE = new Map();

/**
 * @param {object} p
 * @param {string} p.orgId  org CORE
 * @param {string|null} p.startDate  plage affichée (ISO), mêmes bornes que useAppointments
 * @param {string|null} p.endDate
 * @param {{ debut: string, finExclue: string }|null} p.periode  période annoncée par le titre (cumul)
 * @param {Array<object>} p.appointments  RDV de la plage, avec `technician_ids`
 * @param {Array<object>} p.members  ressources planning (useTeamMembers)
 * @param {Array<{ profileKey: string, recordIds: string[] }>} p.teamList
 * @param {string[]} [p.memberProfileKeys]  filtre équipe du calendrier
 * @param {boolean} [p.rdvsPartiels]  vrai si `appointments` est restreint par un filtre de type ou de statut
 * @param {boolean} p.voitCharge  faux ⇒ ni lignes ni chiffre (pilotage réservé à l'admin et au team leader)
 */
export function usePlanningCharge({
  orgId, startDate, endDate, periode, appointments, members, teamList, memberProfileKeys, rdvsPartiels = false, voitCharge,
}) {
  // Ids (team_members / commercials) des personnes filtrées ; null = toute l'équipe.
  const recordIdsFiltres = useMemo(() => {
    const keys = memberProfileKeys || [];
    if (keys.length === 0) return null;
    const set = new Set(keys);
    return new Set((teamList || []).filter((h) => set.has(h.profileKey)).flatMap((h) => h.recordIds));
  }, [memberProfileKeys, teamList]);

  // État de chaque journée que le moteur planifie (vide / ouverte / pleine / figée /
  // à arbitrer). Chargé pour tous : le panneau de journée s'ouvre aussi par lien direct.
  const {
    etats: etatsJournees, journees: journeesHorizon, isLoading: etatsLoading, error: etatsError,
  } = useEtatsJournees({ coreOrgId: orgId, startDate, endDate });

  const lignes = useMemo(() => {
    if (!voitCharge) return AUCUNE_LIGNE;
    return lignesDeCharge({
      etatsMoteur: etatsJournees,
      moteurEnChargement: etatsLoading,
      membres: members,
      rdvs: appointments,
      rdvsPartiels,
      debut: startDate,
      finExclue: endDate,
      filtreIds: recordIdsFiltres,
    });
  }, [voitCharge, etatsJournees, etatsLoading, members, appointments, rdvsPartiels, startDate, endDate, recordIdsFiltres]);

  // CA HT programmé : total du jour et part par technicien. `null` tant que le
  // chiffre est inconnu — on n'affiche alors rien, jamais 0.
  const { ca, error: caError } = usePlanningCa({
    orgId,
    startDate,
    endDate,
    appointments,
    technicienIds: recordIdsFiltres,
    // `periode` connue = le calendrier a annoncé sa plage.
    enabled: voitCharge && !!periode,
  });

  // Cumul de la période affichée (semaine, jour ou mois — pas la grille, qui
  // déborde sur les mois voisins).
  const caCumul = useMemo(() => {
    if (!voitCharge || caError || !ca || !periode) return null;
    return cumulPeriode(ca.parJour, periode.debut, periode.finExclue);
  }, [voitCharge, caError, ca, periode]);

  return {
    recordIdsFiltres, etatsJournees, journeesHorizon, etatsLoading, etatsError, lignes, ca, caError, caCumul,
  };
}
