/**
 * useEnvoiCampagne — seule voie d'envoi d'une campagne depuis l'écran (essai et envoi en nombre)
 * ============================================================================
 * Corps de l'ancien `sendCampaign` de `SendTab.jsx` déplacé tel quel : même requête à l'edge
 * `mailing-send` (`{ mode: 'bulk', segment_id, subject, html_body, campaign_name, test_email? }`),
 * mêmes vagues (l'edge plafonne chaque appel et répond `{ remaining, complete, processed }`), même
 * garde-fou de 40 vagues, même reprise sans doublon (l'exclusion `mailing_logs WHERE campaign_name = X`
 * côté base : relancer reprend où c'était arrêté — une fois la vague précédente TERMINÉE).
 *
 * Ce qui change pour vivre dans un hook :
 *  - un envoi par campagne à la fois, tenu au niveau du MODULE (`src/lib/envoiEnCours.js`, clé organisation +
 *    nom) : la page quittée puis rouverte sait qu'une vague de cette campagne est encore chez le serveur
 *    (`mailing-send` n'a pas de verrou et ne journalise chacun qu'après l'envoi : relancer pendant la vague
 *    écrirait de nouveau à ceux qu'elle n'a pas encore journalisés). Limite : un seul onglet — deux onglets,
 *    ou deux personnes, peuvent encore lancer la même campagne au même moment (verrou serveur à faire) ;
 *  - page quittée pendant l'envoi : la vague déjà demandée va à son terme côté serveur (rien n'est annulé),
 *    puis la boucle s'arrête et le dit ; l'entrée du registre tombe à ce moment-là ;
 *  - un refus de `mailing-send` (adresse d'envoi) est dit en clair (`messageErreurEnvoi`) ;
 *  - AUCUNE réponse du serveur pendant un envoi (réseau coupé, délai dépassé, passerelle — `sansReponse`) : la
 *    vague demandée tourne peut-être encore ; la clé reste prise `DELAI_APRES_COUPURE_MS` (`retenir`) avant que
 *    « Reprendre l'envoi » soit possible, et la page le dit. Une réponse du serveur, refus compris, libère tout de suite ;
 *  - à la fin d'un envoi en nombre, compteurs de destinataires et journal de la campagne sont relus.
 *
 * L'appelant passe ce qui est ENREGISTRÉ (objet, texte, nom) : ce qui part est ce qui est enregistré.
 * Résout avec `true` si l'envoi a abouti, `false` sinon (le message est déjà affiché).
 * ============================================================================
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { resoudreExpediteur, EXPEDITEUR_REFUS } from '@/lib/expediteur';
import {
  demarrer, enCours as registreEnCours, abonner, retenir, retenueJusqua, sansReponse, DELAI_APRES_COUPURE_MS,
} from '@/lib/envoiEnCours';
import { cleEnvoi, messageErreurEnvoi, heureDeReprise } from '@/lib/mailPage';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { mailCampaignKeys, mailSegmentKeys, mailCampaignStatsKeys } from './cacheKeys';

const MAX_WAVES = 40; // garde-fou (40 × 300 = 12 000 mails)
const DEJA_EN_COURS = 'Un envoi de cette campagne est en cours : attendez que la page dise qu’il est terminé.';

/**
 * @typedef {{ segmentId: string, objet: string, corps: string, nomCampagne: string, adresseTest?: string, nombre?: number }} ArgsEnvoi
 * @typedef {{ vague: number, envoyes: number, echecs: number, reste: number | null }} Progression
 */

/**
 * Erreur d'un `functions.invoke` avec le code renvoyé par l'edge (`{ error }`) quand il est lisible, et
 * `sansReponse` : vrai quand le serveur n'a rien répondu (la vague tourne peut-être encore).
 */
async function erreurEnvoi(error) {
  let code = null;
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const body = await error.context.json();
      code = typeof body?.error === 'string' ? body.error : null;
    }
  } catch {
    /* corps illisible → message reçu */
  }
  return Object.assign(new Error(messageErreurEnvoi({ code, message: error?.message })), { code, sansReponse: sansReponse(error) });
}

/** Refus explicite du serveur (réponse reçue) : la vague est terminée. @param {string} message */
const refusDuServeur = (message) => Object.assign(new Error(message), { sansReponse: false });

/**
 * Un envoi de cette campagne est-il en cours dans cet onglet (quelle que soit la page qui l'a lancé) ?
 * @param {string} cle `cleEnvoi(orgId, nom)`
 * @returns {boolean}
 */
export function useEnvoiEnCours(cle) {
  return useSyncExternalStore(abonner, () => registreEnCours(cle), () => false);
}

/**
 * Après une coupure pendant un envoi de cette campagne : heure (ms) à partir de laquelle il peut reprendre, sinon null.
 * @param {string} cle `cleEnvoi(orgId, nom)`
 * @returns {number | null}
 */
export function useRepriseApres(cle) {
  return useSyncExternalStore(abonner, () => retenueJusqua(cle), () => null);
}

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

  /**
   * Inscrit l'envoi au registre puis l'exécute. Refusé si cette page envoie déjà, ou si une vague de cette
   * campagne est encore en cours (lancée par une page quittée). L'entrée tombe quand `executer` se termine.
   */
  const lancerSousRegistre = useCallback(async (args, executer) => {
    if (enVolRef.current) return false;
    const cle = cleEnvoi(orgId, args?.nomCampagne);
    if (!cle || registreEnCours(cle)) {
      toast.error(DEJA_EN_COURS);
      return false;
    }
    enVolRef.current = true;
    setEnCours(true);
    const promesse = executer();
    demarrer(cle, promesse);
    try {
      return await promesse;
    } finally {
      enVolRef.current = false;
      setEnCours(false);
    }
  }, [orgId]);

  const tester = useCallback(async (args) => {
    if (enVolRef.current) return false;
    const body = preparer(args, true);
    if (!body) return false;
    return lancerSousRegistre(args, async () => {
      try {
        // Mode test : 1 destinataire, un seul appel. L'edge n'écrit pas l'essai au journal : personne n'est écarté.
        const { data, error } = await supabase.functions.invoke('mailing-send', { body });
        if (error) throw await erreurEnvoi(error);
        if (data?.success === false) throw refusDuServeur(messageErreurEnvoi({ code: data?.error, message: 'Échec envoi test' }));
        toast.success(`Essai envoyé à ${body.test_email}`);
        return true;
      } catch (err) {
        toast.error(`Erreur : ${err.message}`);
        return false;
      }
    });
  }, [preparer, lancerSousRegistre]);

  const lancer = useCallback(async (args) => {
    if (enVolRef.current) return false;
    const body = preparer(args, false);
    if (!body) return false;
    return lancerSousRegistre(args, async () => {
      try {
        // Envoi bulk par vagues (mailing-send v12) : l'edge plafonne chaque
        // invocation à ~300 envois (wall-clock 150 s + rate limit Resend 5/s)
        // et répond { remaining, complete }. On enchaîne les vagues jusqu'à
        // épuisement — l'exclusion `NOT IN mailing_logs WHERE campaign_name = X`
        // côté DB garantit la reprise sans doublon (une fois la vague précédente
        // terminée : recliquer reprend où c'était arrêté).
        setProgression({ vague: 0, envoyes: 0, echecs: 0, reste: args.nombre ?? null });
        let totalSent = 0;
        let totalFailed = 0;
        let wave = 0;
        for (;;) {
          wave += 1;
          const { data, error } = await supabase.functions.invoke('mailing-send', { body });
          if (error) throw await erreurEnvoi(error);
          if (data?.success === false) throw refusDuServeur(messageErreurEnvoi({ code: data?.error, message: 'Échec envoi' }));
          totalSent += data?.sent ?? 0;
          totalFailed += data?.failed ?? 0;
          const remaining = data?.remaining ?? 0;
          setProgression({ vague: wave, envoyes: totalSent, echecs: totalFailed, reste: remaining });
          // Rétrocompat : une edge sans batching ne renvoie pas `complete` → one-shot.
          if (data?.complete ?? true) break;
          // Garde anti-boucle : si une vague ne traite plus rien, on sort.
          if ((data?.processed ?? 0) === 0) break;
          if (!monteRef.current) {
            // Page quittée : la vague demandée a été traitée jusqu'au bout, on n'en demande pas d'autre.
            toast.warning(
              `Envoi arrêté après la vague ${wave} (page quittée) : ${totalSent} mail${totalSent > 1 ? 's' : ''} parti${totalSent > 1 ? 's' : ''}. `
              + 'Rouvrez le mail et cliquez sur « Lancer » pour reprendre : ceux qui l’ont déjà reçu ne le recevront pas une seconde fois.',
            );
            return false;
          }
          if (wave >= MAX_WAVES) {
            toast.warning(
              `Envoi interrompu après ${MAX_WAVES} vagues : cliquez de nouveau sur « Lancer » pour reprendre ; ceux qui l’ont déjà reçu ne le recevront pas une seconde fois.`,
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
        // Pas de réponse du serveur (ou erreur inattendue) : la vague demandée part peut-être encore. On garde
        // l'envoi fermé le temps qu'elle se termine, sinon une reprise écrirait deux fois aux mêmes personnes.
        if (err?.sansReponse !== false) {
          const echeance = retenir(cleEnvoi(orgId, args.nomCampagne));
          const minutes = Math.round(DELAI_APRES_COUPURE_MS / 60000);
          toast.error(
            `La connexion a été coupée pendant l'envoi : une partie de cet envoi peut encore partir. Attendez ${minutes} minutes`
            + (echeance ? ` (vers ${heureDeReprise(echeance)})` : '')
            + ', puis reprenez l’envoi depuis la page du mail : ceux qui l’ont déjà reçu ne le recevront pas une seconde fois.',
          );
          return false;
        }
        toast.error(
          `L'envoi s'est arrêté : ${err.message} — cliquez de nouveau sur « Lancer » pour reprendre là où c'était arrêté : ceux qui l'ont déjà reçu ne le recevront pas une seconde fois.`,
        );
        return false;
      } finally {
        setProgression(null);
        // Nombre restant, journal (le nom se fige au premier envoi) et statistiques relus.
        if (orgId) {
          queryClient.invalidateQueries({ queryKey: mailSegmentKeys.all(orgId) });
          queryClient.invalidateQueries({ queryKey: mailCampaignKeys.all(orgId) });
          queryClient.invalidateQueries({ queryKey: mailCampaignStatsKeys.all(orgId) });
        }
      }
    });
  }, [preparer, lancerSousRegistre, orgId, queryClient]);

  return { tester, lancer, enCours, progression };
}
