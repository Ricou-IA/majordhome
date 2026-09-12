// src/apps/artisan/components/tournees/useConsolidationJournee.js
// ============================================================================
// « Figer la journée » (spec 2026-09-12 « fenêtres d'abord, heures ensuite »,
// temps 3 — consolidation) : ordonnancer la journée dans les fenêtres de
// tolérance des RDV adaptables, poser les heures définitives, figer, prévenir.
//
// Calcul = sequencerTournee (module pur) sur construireArretsPourConsolidation.
// Les RDV figés (heure communiquée au client) sont des points fixes : ils ne
// bougent pas d'une minute. Écriture = relecture de l'état (rien n'a bougé
// depuis l'aperçu), un UPDATE par RDV (heures + figé) — arrêt au premier
// refus —, puis, seulement si TOUT est écrit, un SMS d'heure de passage par
// client adaptable. Jamais en silence : chaque échec est compté et rendu, y
// compris les clients sans mobile (à prévenir par téléphone).
// ============================================================================
import { useMemo, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { appointmentsService } from '@services/appointments.service';
import { savService } from '@services/sav.service';
import { appointmentKeys, entretienSavKeys, tourneeKeys } from '@hooks/cacheKeys';
import { logger } from '@lib/logger';
import { formatSmsDate, formatSmsHour, capitaliserPrenom } from '@/lib/smsCampaigns';
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
      souplesse: true, // cette consolidation ÉCRIT les heures : elle a droit aux tolérances
      flexDefaut, amplitude: journee.amplitude, demiJournee: reglages?.demi_journee,
    });
    const trajet = construireMatrice(paires instanceof Map ? paires : new Map(), { repli: trajetLocal });
    const seq = sequencerTournee({
      depotKey: cleCoord(depot),
      arrets,
      trajet,
      amplitude: journee.amplitude,
      budgetMinutes: journee.budgetMinutes + (reglages.depassement_journee_minutes ?? 0),
      pause: { minutes: reglages.pause_minutes, fenetre: [reglages.pause_fenetre[0] * 60, reglages.pause_fenetre[1] * 60] },
      // Un figé est un fait : arriver « en retard » selon nos estimations ne
      // bloque pas la journée (leçon du 31/08).
      figesSontDesFaits: true,
    });
    const parId = new Map(rdvs.map((r) => [r.id, r]));
    const nom = (id) => parId.get(id)?.client_name || parId.get(id)?.subject || 'RDV';
    if (!seq.faisable) {
      const d = seq.diagnostic;
      return {
        faisable: false, raison: seq.raison, lignes: [],
        diagnostic: d ? {
          ...d,
          budgetMinutes: journee.budgetMinutes,
          depassementMinutes: reglages.depassement_journee_minutes ?? 0,
          conflits: d.conflits.map((c) => ({ ...c, label: nom(c.id), depuisLabel: nom(c.depuisId) })),
        } : null,
        estime: !(paires instanceof Map) || paires.size === 0,
      };
    }
    const lignes = seq.planning.map((p) => {
      const r = parId.get(p.id);
      const avant = r?.scheduled_start?.slice(0, 5) || '—';
      const apres = minutesVersHeure(p.arriveeMinutes);
      const fige = souplesseEffective(r, flexDefaut) === 0;
      return {
        id: p.id, label: nom(p.id), ville: r?.city || null,
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
    const bilan = { figes: 0, echecs: [], sms: 0, smsEchecs: [], smsSansMobile: [], smsGabaritAbsent: false, perime: false };
    try {
      const aChanger = apercu.lignes.filter((l) => !l.fige);
      // 1. L'aperçu est-il encore vrai ? Un RDV déplacé, figé ou clos entre
      //    l'ouverture et le clic invalide l'ordonnancement entier : on n'écrit rien.
      const { data: etats, error: lireErr } = await supabase
        .from('majordhome_appointments')
        .select('id, scheduled_start, hour_confirmed_at, time_flex_minutes, status')
        .in('id', aChanger.map((l) => l.id));
      if (lireErr) throw lireErr;
      const parIdEtat = new Map((etats || []).map((e) => [e.id, e]));
      const perimes = aChanger.filter((l) => {
        const e = parIdEtat.get(l.id);
        return !e || e.status === 'cancelled' || !!e.hour_confirmed_at || e.time_flex_minutes === 0
          || (e.scheduled_start || '').slice(0, 5) !== l.avant;
      });
      if (perimes.length > 0) {
        bilan.perime = true;
        bilan.echecs.push(...perimes.map((l) => ({ label: l.label, message: 'modifié depuis l’aperçu — rouvrez « Figer la journée »' })));
        return;
      }
      // 2. Les heures, une par une ; au premier refus on s'arrête : la suite
      //    reposait sur un ordre qui n'est plus entièrement écrit.
      const maintenant = new Date().toISOString();
      const figes = [];
      for (const l of aChanger) {
        const { error } = await appointmentsService.updateAppointment(l.id, {
          scheduled_start: l.apres,
          // R1 : le bloc suit le barème au figeage (durée = celle vue par le moteur).
          scheduled_end: minutesVersHeure(l.arriveeMinutes + l.dureeMinutes),
          duration_minutes: l.dureeMinutes,
          time_flex_minutes: 0,
          hour_confirmed_at: maintenant,
          announced_start: l.apres,
        });
        if (error) { bilan.echecs.push({ label: l.label, message: error.message || 'refusé' }); break; }
        bilan.figes += 1;
        figes.push(l);
      }
      // 3. Les SMS, seulement si TOUT est écrit : une heure annoncée doit être
      //    définitive, et une journée à moitié figée peut encore bouger.
      if (bilan.echecs.length > 0) return;
      for (const l of figes) {
        const { error: smsErr } = await savService.sendHeureDePassage({
          orgId: coreOrgId, clientId: l.clientId, clientPhone: l.phone, clientFirstName: capitaliserPrenom(l.prenom),
          clientName: l.label, date: formatSmsDate(journee.date), heure: formatSmsHour(l.apres),
          technicien: String(journee.technicienNom || '').split(' ')[0],
        });
        if (!smsErr) bilan.sms += 1;
        else if (smsErr.message === 'campaign_template_missing') bilan.smsGabaritAbsent = true;
        else if (smsErr.message === 'no_mobile') bilan.smsSansMobile.push({ label: l.label, phone: l.phone || null });
        else bilan.smsEchecs.push({ label: l.label, message: smsErr.message });
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
