/**
 * usePlanningImpression.js - Majord'home Artisan
 * ============================================================================
 * Bouton « Imprimer » du Planning, pour UNE personne (un seul prénom dans le
 * filtre équipe) : feuille de route (interventions + itinéraire) en vue Jour,
 * planning de la semaine en vue Semaine. Quoi imprimer, et pourquoi le bouton
 * est grisé : consignesImpression (src/lib/planningPrintModel.js, testé).
 * Les PDF eux-mêmes : feuilleDeRouteExport / planningPrintExport.
 * ============================================================================
 */

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useFeuilleDeRoute } from '@hooks/useFeuilleDeRoute';
import { useClientEquipmentLabels } from '@hooks/useClients';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { consignesImpression, personneImprimee } from '@/lib/planningPrintModel';
import { telechargerPlanningHebdo } from '@/apps/artisan/components/planning/planningPrintExport';
import { telechargerFeuilleDeRoute } from '@/apps/artisan/components/planning/feuilleDeRouteExport';

const AUCUN_ID = [];

/**
 * @param {object} p
 * @param {string} p.orgId  org CORE
 * @param {string} p.vue  type de vue FullCalendar affichée
 * @param {string|null} p.startDate  premier jour de la plage affichée (ISO)
 * @param {string[]} [p.memberProfileKeys]  filtre équipe du calendrier
 * @param {Array<object>} p.teamList
 * @param {Array<{ extendedProps: object }>} p.events  blocs du calendrier, déjà filtrés sur la personne
 * @returns {{ printHint: string|null, printLabel: string, isPrinting: boolean, handlePrint: () => Promise<void> }}
 */
export function usePlanningImpression({ orgId, vue, startDate, memberProfileKeys, teamList, events }) {
  const [isPrinting, setIsPrinting] = useState(false);
  const { labelsByClientId } = useClientEquipmentLabels();
  const { settings } = useOrgSettings();

  const personne = useMemo(() => personneImprimee(memberProfileKeys, teamList), [memberProfileKeys, teamList]);
  const { mode, raison, libelle } = consignesImpression({ vue, personne });

  // Même modèle que le panneau journée : l'impression ne recalcule rien.
  const feuilleImpression = useFeuilleDeRoute({
    orgId,
    date: mode === 'jour' ? startDate : null,
    memberIds: personne?.recordIds || AUCUN_ID,
    person: personne,
  });

  const handlePrint = useCallback(async () => {
    if (!mode || !personne || !startDate) return;
    if (mode === 'jour' && (!feuilleImpression.feuille || feuilleImpression.isLoading)) {
      toast.info('Feuille de route en cours de calcul, réessayez dans un instant.');
      return;
    }
    setIsPrinting(true);
    try {
      if (mode === 'jour') {
        await telechargerFeuilleDeRoute({
          feuille: feuilleImpression.feuille, carteUrl: feuilleImpression.carteUrl, settings,
        });
      } else {
        // events = blocs calendrier déjà filtrés sur la personne ; le modèle
        // déduplique par id (RDV multi-tech éclaté en plusieurs blocs).
        await telechargerPlanningHebdo({
          appointments: events.map((e) => e.extendedProps),
          person: personne,
          weekStart: startDate,
          equipmentLabelsByClient: labelsByClientId,
          settings,
        });
      }
    } catch (err) {
      toast.error(`Impression impossible : ${err?.message || 'erreur inconnue'}`);
    } finally {
      setIsPrinting(false);
    }
  }, [mode, personne, startDate, feuilleImpression, events, labelsByClientId, settings]);

  return { printHint: raison, printLabel: libelle, isPrinting, handlePrint };
}
