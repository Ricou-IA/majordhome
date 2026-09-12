// src/apps/artisan/components/tournees/useConsolidationJournee.js
// ============================================================================
// « Figer la journée » (spec 2026-09-12 « fenêtres d'abord, heures ensuite »,
// temps 3 — consolidation) : ordonnancer la journée dans les fenêtres de
// tolérance des RDV adaptables, poser les heures définitives, figer, prévenir.
//
// Calcul = sequencerTournee (module pur) sur construireArretsPourConsolidation.
// Les RDV figés (heure communiquée au client) sont des points fixes : ils ne
// bougent pas d'une minute. Écriture = un UPDATE par RDV (heures + figé), puis
// un SMS d'heure de passage par client adaptable — jamais en silence : chaque
// échec est compté et rendu.
// ============================================================================
import { useMemo, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { appointmentsService } from '@services/appointments.service';
import { savService } from '@services/sav.service';
import { appointmentKeys, entretienSavKeys, tourneeKeys } from '@hooks/cacheKeys';
import { logger } from '@lib/logger';
import { sequencerTournee } from '@/lib/tournee/sequence.js';
import { construireArretsPourConsolidation, minutesVersHeure } from '@/lib/tournee/arrets.js';
import { construireMatrice, trajetLocal } from '@/lib/tournee/matrice.js';
import { cleCoord } from '@/lib/tournee/geo.js';
import { souplesseEffective } from '@/lib/souplesse';

/**
 * @param {object} p
 * @param {object} p.journee    Journee (rdvs avec time_flex_minutes / hour_confirmed_at)
 * @param {{lat,lng}|null} p.depot
 * @param {object} p.reglages   construireReglages(settings)
 * @param {Map<string,number>|null|undefined} p.paires  matrice Mapbox du panneau (repli vol d'oiseau sinon)
 * @param {string} p.coreOrgId
 */
export function useConsolidationJournee({ journee, depot, reglages, paires, coreOrgId }) {
  const queryClient = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState(null);

  const flexDefaut = reglages?.souplesse_defaut_minutes ?? 30;
  const rdvs = useMemo(() => (journee?.rdvs || []).filter((r) => r.status !== 'cancelled'), [journee]);
  const adaptables = useMemo(() => rdvs.filter((r) => souplesseEffective(r, flexDefaut) > 0), [rdvs, flexDefaut]);

  /** Aperçu : ordre + heures définitives, ou la raison pour laquelle la journée ne tient pas. */
  const apercu = useMemo(() => {
    if (!ouvert || !depot || rdvs.length === 0) return null;
    const arrets = construireArretsPourConsolidation(rdvs, depot, {
      flexDefaut, amplitude: journee.amplitude, demiJournee: reglages?.demi_journee,
    });
    const trajet = construireMatrice(paires instanceof Map ? paires : new Map(), { repli: trajetLocal });
    const seq = sequencerTournee({
      depotKey: cleCoord(depot),
      arrets,
      trajet,
      amplitude: journee.amplitude,
      budgetMinutes: journee.budgetMinutes,
      pause: { minutes: reglages.pause_minutes, fenetre: [reglages.pause_fenetre[0] * 60, reglages.pause_fenetre[1] * 60] },
    });
    if (!seq.faisable) return { faisable: false, raison: seq.raison, lignes: [] };
    const parId = new Map(rdvs.map((r) => [r.id, r]));
    const lignes = seq.planning.map((p) => {
      const r = parId.get(p.id);
      const avant = r?.scheduled_start?.slice(0, 5) || '—';
      const apres = minutesVersHeure(p.arriveeMinutes);
      const fige = souplesseEffective(r, flexDefaut) === 0;
      return {
        id: p.id, label: r?.client_name || r?.subject || 'RDV', ville: r?.city || null,
        avant, apres, change: avant !== apres, fige,
        arriveeMinutes: p.arriveeMinutes, dureeMinutes: r?.duration_minutes || 60,
        clientId: r?.client_id || null, phone: r?.client_phone || null, prenom: r?.client_first_name || null,
      };
    });
    return { faisable: true, raison: null, lignes, estime: !(paires instanceof Map) || paires.size === 0 };
  }, [ouvert, depot, rdvs, flexDefaut, journee, reglages, paires]);

  /** Écrit les heures définitives, fige, envoie les SMS d'heure de passage. */
  const figer = useCallback(async () => {
    if (!apercu?.faisable) return;
    setEnCours(true);
    const bilan = { figes: 0, echecs: [], sms: 0, smsEchecs: [], smsGabaritAbsent: false };
    try {
      const maintenant = new Date().toISOString();
      for (const l of apercu.lignes) {
        if (l.fige) continue; // point fixe : rien à écrire
        const { error } = await appointmentsService.updateAppointment(l.id, {
          scheduled_start: l.apres,
          scheduled_end: minutesVersHeure(l.arriveeMinutes + l.dureeMinutes),
          time_flex_minutes: 0,
          hour_confirmed_at: maintenant,
        });
        if (error) { bilan.echecs.push({ label: l.label, message: error.message || 'refusé' }); continue; }
        bilan.figes += 1;
        // SMS d'heure de passage : seulement pour ceux qui viennent d'être figés.
        const { error: smsErr } = await savService.sendHeureDePassage({
          orgId: coreOrgId, clientId: l.clientId, clientPhone: l.phone, clientFirstName: l.prenom,
          clientName: l.label, date: journee.date, heure: l.apres, technicien: journee.technicienNom,
        });
        if (!smsErr) bilan.sms += 1;
        else if (smsErr.message === 'campaign_template_missing') bilan.smsGabaritAbsent = true;
        else if (smsErr.message !== 'no_mobile') bilan.smsEchecs.push({ label: l.label, message: smsErr.message });
      }
    } catch (err) {
      logger.error('[tournees] figer la journée', err);
      bilan.echecs.push({ label: 'journée', message: err?.message || 'exception inattendue' });
    } finally {
      setEnCours(false);
      setResultat(bilan);
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all(coreOrgId) });
      queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(coreOrgId) });
      queryClient.invalidateQueries({ queryKey: tourneeKeys.all(coreOrgId) });
    }
  }, [apercu, coreOrgId, journee, queryClient]);

  return {
    peutFiger: adaptables.length > 0 && !!depot,
    nbAdaptables: adaptables.length,
    ouvert, ouvrir: () => { setResultat(null); setOuvert(true); }, fermer: () => setOuvert(false),
    apercu, figer, enCours, resultat,
  };
}
