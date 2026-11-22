/**
 * useEnvoiCampagne — seule voie d'envoi d'une campagne depuis l'écran (essai et envoi en nombre)
 * ============================================================================
 * Corps de l'ancien `sendCampaign` de `SendTab.jsx` déplacé tel quel : même requête à l'edge
 * `mailing-send` (`{ mode: 'bulk', segment_id, subject, html_body, campaign_name, test_email? }`),
 * mêmes vagues (l'edge plafonne chaque appel et répond `{ remaining, complete, processed }`), même
 * garde-fou de 40 vagues, même reprise sans doublon (l'exclusion `mailing_logs WHERE campaign_name = X`
 * côté base : relancer reprend où c'était arrêté), mêmes messages.
 *
 * Ce qui change pour vivre dans un hook :
 *  - un seul envoi à la fois, tenu par une référence (un double clic ne part jamais deux fois) ;
 *  - page quittée pendant l'envoi : la vague déjà demandée va à son terme côté serveur (rien n'est annulé),
 *    puis la boucle s'arrête et le dit — relancer reprend sans doublon ;
 *  - à la fin d'un envoi en nombre, compteurs de destinataires et journal de la campagne sont relus.
 *
 * L'appelant passe ce qui est ENREGISTRÉ (objet, texte, nom) : ce qui part est ce qui est enregistré.
 * Résout avec `true` si l'envoi a abouti, `false` sinon (le message est déjà affiché).
 * ============================================================================
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { resoudreExpediteur, EXPEDITEUR_REFUS } from '@/lib/expediteur';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { mailCampaignKeys, mailSegmentKeys, mailCampaignStatsKeys } from './cacheKeys';

const MAX_WAVES = 40; // garde-fou (40 × 300 = 12 000 mails)

/**
 * @typedef {{ segmentId: string, objet: string, corps: string, nomCampagne: string, adresseTest?: string, nombre?: number }} ArgsEnvoi
 * @typedef {{ vague: number, envoyes: number, echecs: number, reste: number | null }} Progression
 */

/**
 * @param {{ orgId: string | undefined }} params
 * @returns {{ tester: (args: ArgsEnvoi) => Promise<boolean>, lancer: (args: ArgsEnvoi) => Promise<boolean>,
 *   enCours: boolean, progression: Progression | null }}
 */
export function useEnvoiCampagne({ orgId }) {
  const { settings: orgSettings } = useOrgSettings();
  const queryClient = useQueryClient();
  const [enCours, setEnCours] = useState(false);
  const [progression, setProgression] = useState(null);
  const enVolRef = useRef(false);
  const monteRef = useRef(true);

  useEffect(() => {
    monteRef.current = true;
    return () => { monteRef.current = false; };
  }, []);

  /** Contrôles de l'ancien `sendCampaign`, puis la requête. `null` = refusé (message affiché). */
  const preparer = useCallback((args, isTest) => {
    const testEmail = String(args?.adresseTest ?? '').trim();
    if (isTest && !testEmail) {
      toast.error('Indiquez l’adresse qui recevra l’essai.');
      return null;
    }
    if (!String(args?.objet ?? '').trim()) {
      toast.error('L’objet du mail est vide : donnez-lui un objet et enregistrez.');
      return null;
    }
    if (!args?.segmentId) {
      toast.error('Choisissez les destinataires.');
      return null;
    }
    // Un envoi à un segment part du domaine vérifié de l'entreprise, jamais de l'adresse commune.
    const refusExpediteur = resoudreExpediteur(orgSettings, { usage: isTest ? 'individuel' : 'nombre' }).refus;
    if (refusExpediteur) {
      toast.error(EXPEDITEUR_REFUS[refusExpediteur]);
      return null;
    }
    return {
      mode: 'bulk',
      segment_id: args.segmentId,
      subject: args.objet,
      html_body: args.corps,
      campaign_name: args.nomCampagne,
      ...(isTest ? { test_email: testEmail } : {}),
    };
  }, [orgSettings]);

  const tester = useCallback(async (args) => {
    if (enVolRef.current) return false;
    const body = preparer(args, true);
    if (!body) return false;
    enVolRef.current = true;
    setEnCours(true);
    try {
      // Mode test : 1 destinataire, un seul appel. L'edge n'écrit pas l'essai au journal : personne n'est écarté.
      const { data, error } = await supabase.functions.invoke('mailing-send', { body });
      if (error) throw error;
      if (data?.success === false) throw new Error(data?.error || 'Échec envoi test');
      toast.success(`Essai envoyé à ${body.test_email}`);
      return true;
    } catch (err) {
      toast.error(`Erreur : ${err.message}`);
      return false;
    } finally {
      enVolRef.current = false;
      setEnCours(false);
    }
  }, [preparer]);

  const lancer = useCallback(async (args) => {
    if (enVolRef.current) return false;
    const body = preparer(args, false);
    if (!body) return false;
    enVolRef.current = true;
    setEnCours(true);
    try {
      // Envoi bulk par vagues (mailing-send v12) : l'edge plafonne chaque
      // invocation à ~300 envois (wall-clock 150 s + rate limit Resend 5/s)
      // et répond { remaining, complete }. On enchaîne les vagues jusqu'à
      // épuisement — l'exclusion `NOT IN mailing_logs WHERE campaign_name = X`
      // côté DB garantit la reprise sans doublon (y compris après une
      // interruption : relancer reprend où c'était arrêté).
      setProgression({ vague: 0, envoyes: 0, echecs: 0, reste: args.nombre ?? null });
      let totalSent = 0;
      let totalFailed = 0;
      let wave = 0;
      for (;;) {
        wave += 1;
        const { data, error } = await supabase.functions.invoke('mailing-send', { body });
        if (error) throw error;
        if (data?.success === false) throw new Error(data?.error || 'Échec envoi');
        totalSent += data?.sent ?? 0;
        totalFailed += data?.failed ?? 0;
        const remaining = data?.remaining ?? 0;
        setProgression({ vague: wave, envoyes: totalSent, echecs: totalFailed, reste: remaining });
        // Rétrocompat : une edge sans batching ne renvoie pas `complete` → one-shot.
        if (data?.complete ?? true) break;
        // Garde anti-boucle : si une vague ne traite plus rien, on sort.
        if ((data?.processed ?? 0) === 0) break;
        if (!monteRef.current) {
          // Page quittée : la vague demandée a été traitée, on n'en demande pas d'autre.
          toast.warning(
            `Envoi arrêté après la vague ${wave} (page quittée) : ${totalSent} mail${totalSent > 1 ? 's' : ''} parti${totalSent > 1 ? 's' : ''}. `
            + 'Rouvrez le mail et cliquez sur « Lancer » pour continuer (reprise sans doublon).',
          );
          return false;
        }
        if (wave >= MAX_WAVES) {
          toast.warning(
            `Envoi interrompu après ${MAX_WAVES} vagues — cliquez de nouveau sur « Lancer » pour continuer (reprise sans doublon).`,
          );
          return false;
        }
      }
      toast.success(
        `Campagne envoyée : ${totalSent} mail${totalSent > 1 ? 's' : ''} en ${wave} vague${wave > 1 ? 's' : ''}`
        + (totalFailed ? ` — ${totalFailed} échec${totalFailed > 1 ? 's' : ''} (voir Stats)` : ''),
      );
      return true;
    } catch (err) {
      toast.error(
        `Erreur pendant l'envoi : ${err.message} — cliquez de nouveau sur « Lancer » pour reprendre là où c'était arrêté (aucun doublon).`,
      );
      return false;
    } finally {
      enVolRef.current = false;
      setEnCours(false);
      setProgression(null);
      // Nombre restant, journal (le nom se fige au premier envoi) et statistiques relus.
      if (orgId) {
        queryClient.invalidateQueries({ queryKey: mailSegmentKeys.all(orgId) });
        queryClient.invalidateQueries({ queryKey: mailCampaignKeys.all(orgId) });
        queryClient.invalidateQueries({ queryKey: mailCampaignStatsKeys.all(orgId) });
      }
    }
  }, [preparer, orgId, queryClient]);

  return { tester, lancer, enCours, progression };
}
