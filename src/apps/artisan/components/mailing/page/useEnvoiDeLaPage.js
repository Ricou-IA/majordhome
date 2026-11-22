/**
 * useEnvoiDeLaPage.js — cartes Destinataires et Envoi de la page du mail
 * ============================================================================
 * Assemble, ne décide pas : les règles (segment enregistré ou non, motifs de
 * fermeture, cadence, confirmations) sont dans `src/lib/mailPage.js` ; l'envoi
 * est `useEnvoiCampagne`, seule voie.
 *
 * Ce qui part est ce qui est ENREGISTRÉ : « Tester », « Lancer » et l'essai d'un
 * e-mail automatique enregistrent d'abord un mail modifié (`sauverRef`, posé
 * par `PageMail`), puis envoient l'objet, le texte et le nom de la ligne rendue
 * par la base. Un autre rôle que l'administrateur n'enregistre jamais rien : il
 * envoie la ligne telle qu'elle est en base, au segment qu'il a choisi.
 * ============================================================================
 */
import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useMailSegments, useSegmentCount, useSegmentPreview } from '@hooks/useMailSegments';
import { useEnvoiCampagne, useEnvoiEnCours, useRepriseApres } from '@hooks/useEnvoiCampagne';
import { useDebounce } from '@hooks/useDebounce';
import { mailCampaignsService } from '@services/mailCampaigns.service';
import { resoudreExpediteur } from '@/lib/expediteur';
import { variablesInconnues, variablesInconnuesDeLObjet } from '@/lib/mailVariables';
import { messageErreurEssai } from '@/lib/emailsAutomatiques';
import {
  segmentsRanges, etatSegment, segmentSurLaCampagne, modesEnvoi, raisonsEnvoiPage, raisonsReglageAutomatique,
  cadenceEnMots, prochainEnvoiEnMots, raisonsSauvegardePage, texteConfirmationLancement, texteConfirmationActivation, metEnRoute, dejaServis,
  cleEnvoi, etatEnvoiCampagne, reglageAutomatiqueModifie, texteConfirmationReglage, phraseNombreInconnu, heureDeReprise,
} from '@/lib/mailPage';

/** Nombre lisible d'une requête : inconnu (chargement, erreur) ⇒ `undefined`, jamais 0. */
const nombreDe = (q) => (q.isError || typeof q.data !== 'number' ? undefined : q.data);

/**
 * @param {object} p
 * @param {string | undefined} p.orgId
 * @param {boolean} p.isOrgAdmin
 * @param {import('@/lib/mailPage').CartesMail} p.cartes
 * @param {Record<string, any>} p.etat état de `reducteurPageMail`
 * @param {(action: object) => void} p.dispatch
 * @param {Record<string, any>} p.settings réglages de l'organisation
 * @param {boolean} p.modifie
 * @param {string[]} p.raisonsEnregistrement
 * @param {boolean} p.isMutating
 * @param {{ current: (() => Promise<Record<string, any> | null>) | null }} p.sauverRef
 */
export function useEnvoiDeLaPage({ orgId, isOrgAdmin, cartes, etat, dispatch, settings, modifie, raisonsEnregistrement, isMutating, sauverRef }) {
  const { form, base, initial, envoi } = etat;
  const envoyeur = useEnvoiCampagne({ orgId });
  const { segments, isLoading: segmentsEnLecture, error: segmentsEnErreur } = useMailSegments(orgId, { includeArchived: true });

  const visible = cartes.destinataires !== 'non';
  const surCampagne = segmentSurLaCampagne({ isOrgAdmin, cartes });
  // Un administrateur qui règle le message enregistre : il enverra le nom tel qu'il sera enregistré.
  const enregistre = isOrgAdmin && cartes.message === 'oui';
  const segmentId = surCampagne ? form.auto_segment_id : (envoi.segmentLocal ?? base?.auto_segment_id ?? null);
  const etatSeg = etatSegment(segmentId, segments, { chargee: !!orgId && !segmentsEnLecture && !segmentsEnErreur });
  const filtres = etatSeg.etat === 'ok' ? etatSeg.segment.filters : null;

  // Nom de la campagne pour le compte : celui qui partira (journal des envois tenu par le nom).
  // Nom inchangé : celui de la base, au caractère près (c'est lui qui partira, et le journal le compare tel quel).
  const nomSaisi = useDebounce(String(form.label ?? '').trim(), 400);
  const nomChange = !base || String(form.label ?? '').trim() !== String(base.label ?? '').trim();
  const nomCompte = enregistre && nomChange ? nomSaisi : (base?.label ?? '');

  const compte = useSegmentCount({ filters: filtres, campaignName: nomCompte, orgId, enabled: visible && !!filtres && !!nomCompte });
  const taille = useSegmentCount({ filters: filtres, orgId, enabled: visible && !!filtres });
  const exemples = useSegmentPreview({ filters: filtres, campaignName: nomCompte || null, orgId, enabled: visible && envoi.exemples && !!filtres });
  const nombre = nombreDe(compte);

  // Contenu jugé : le formulaire pour qui enregistre (il sera enregistré avant l'envoi), la base sinon.
  const objet = enregistre ? form.subject : (base?.subject ?? '');
  const corps = enregistre ? form.html_body : (base?.html_body ?? '');
  const inconnues = useMemo(() => [...new Set(variablesInconnues(base, corps))], [base, corps]);
  const inconnuesObjet = useMemo(() => variablesInconnuesDeLObjet(base, objet), [base, objet]);
  const refusNombre = resoudreExpediteur(settings ?? {}, { usage: 'nombre' }).refus;
  const refusIndividuel = resoudreExpediteur(settings ?? {}, { usage: 'individuel' }).refus;
  // Un envoi de CETTE campagne lancé par une page quittée (registre du module) : tout reste fermé jusqu'à sa fin,
  // puis la page propose de reprendre (chacun de cette vague est alors journalisé).
  const cle = cleEnvoi(orgId, base?.label);
  const occupeRegistre = useEnvoiEnCours(cle);
  // Connexion coupée pendant un envoi : la clé reste prise quelques minutes (registre), la page dit jusqu'à quand.
  const repriseVers = useRepriseApres(cle);
  const etatCampagne = etatEnvoiCampagne({
    occupe: occupeRegistre, vuOccupe: !!envoi.vuOccupe, ici: envoyeur.enCours, repriseVers, coupureVue: !!envoi.coupureVue,
  });
  useEffect(() => {
    if (etatCampagne === 'en_cours' && !envoi.vuOccupe) dispatch({ type: 'envoi', patch: { vuOccupe: true } });
    if (etatCampagne === 'coupure' && !envoi.coupureVue) dispatch({ type: 'envoi', patch: { vuOccupe: true, coupureVue: true } });
  }, [etatCampagne, envoi.vuOccupe, envoi.coupureVue, dispatch]);
  const envoiAilleurs = etatCampagne === 'en_cours';
  const coupure = etatCampagne === 'coupure' ? heureDeReprise(repriseVers) : null;
  const occupeEnvoi = envoyeur.enCours || isMutating || envoiAilleurs;
  // Après une coupure, tout reste fermé ; la raison dite est celle de la coupure (pas « un envoi est en cours »).
  const occupe = occupeEnvoi || !!coupure;
  const automatiqueEnBase = !!base?.is_automated;
  const reglageAutoModifie = enregistre && reglageAutomatiqueModifie(form, initial);

  const commun = { objet, corps, variablesInconnues: inconnues, variablesInconnuesObjet: inconnuesObjet, segmentId, nombre, envoiEnCours: occupeEnvoi };
  const etatAuto = {
    ...commun, refusExpediteur: refusNombre,
    cadenceJours: form.auto_cadence_days, cadenceMinutes: form.auto_cadence_minutes, heure: form.auto_time_of_day,
  };
  const raisonsReglage = enregistre ? raisonsReglageAutomatique({ form, initial, etat: etatAuto }) : [];
  const raisonsSauvegarde = raisonsSauvegardePage({ envoiEnCours: envoyeur.enCours, raisonsEnregistrement, raisonsReglage });
  const miseEnRoute = enregistre && metEnRoute(form, initial);
  const cadre = {
    archive: !!base?.is_archived, segment: etatSeg, raisonsEnregistrement: raisonsSauvegarde,
    modifie: enregistre && modifie, miseEnRoute, envoiAilleurs, automatiqueEnBase, reglageAutoModifie, coupure,
  };
  const raisons = {
    tester: raisonsEnvoiPage({ ...cadre, geste: 'tester', etat: { ...commun, refusExpediteur: refusIndividuel, adresseTest: envoi.adresseTest } }),
    lancer: raisonsEnvoiPage({ ...cadre, geste: 'lancer', etat: { ...commun, refusExpediteur: refusNombre } }),
    automatiser: raisonsEnvoiPage({ ...cadre, geste: 'automatiser', etat: etatAuto }),
  };

  /** Ligne à envoyer : enregistrée d'abord si elle a changé. `null` = rien ne part (raison déjà dite). */
  const ligneAEnvoyer = async () => {
    if (!enregistre || !modifie) return base;
    return (await sauverRef.current?.()) ?? null;
  };
  // Un geste à la fois, enregistrement compris : un double clic n'enregistre ni n'envoie deux fois.
  const gesteRef = useRef(false);
  const unSeul = (fn) => async () => {
    if (gesteRef.current) return;
    gesteRef.current = true;
    try { await fn(); } finally { gesteRef.current = false; }
  };
  const segmentDeLigne = (ligne) => (surCampagne ? ligne.auto_segment_id : segmentId);

  const tester = unSeul(async () => {
    if (raisons.tester.length || occupe) return;
    const ligne = await ligneAEnvoyer();
    if (!ligne) return;
    await envoyeur.tester({
      segmentId: segmentDeLigne(ligne), objet: ligne.subject, corps: ligne.html_body, nomCampagne: ligne.label, adresseTest: envoi.adresseTest,
    });
  });

  const demanderLancement = unSeul(async () => {
    if (raisons.lancer.length || occupe) return;
    const ligne = await ligneAEnvoyer();
    if (!ligne) return;
    if (ligne.is_automated) return; // jamais : la ligne enregistrée part déjà toute seule
    dispatch({
      type: 'envoi',
      patch: {
        confirmation: {
          segmentId: segmentDeLigne(ligne), segmentNom: etatSeg.segment?.name ?? '', objet: ligne.subject, corps: ligne.html_body, nomCampagne: ligne.label,
        },
      },
    });
  });

  const photo = envoi.confirmation;
  // La confirmation ne vaut que pour le nombre compté avec CE nom et CE segment.
  const photoAJour = !!photo && photo.nomCampagne === nomCompte && photo.segmentId === segmentId;
  const texteLancement = photoAJour ? texteConfirmationLancement({ segmentNom: photo.segmentNom, nombre, nomCampagne: photo.nomCampagne }) : null;

  const confirmerLancement = unSeul(async () => {
    if (!photoAJour || !texteLancement) return;
    dispatch({ type: 'envoi', patch: { confirmation: null, vuOccupe: false, coupureVue: false } });
    await envoyeur.lancer({ ...photo, nombre });
  });

  const essayerRegistre = unSeul(async () => {
    if (occupe || envoi.essaiEnCours || (enregistre && modifie && raisonsSauvegarde.length)) return;
    const ligne = await ligneAEnvoyer();
    if (!ligne) return;
    dispatch({ type: 'envoi', patch: { essaiEnCours: true } });
    const { data, error } = await mailCampaignsService.envoyerEssai(orgId, ligne.key);
    dispatch({ type: 'envoi', patch: { essaiEnCours: false } });
    if (error) {
      toast.error(messageErreurEssai(error.code, error.detail));
      return;
    }
    toast.success(`Essai envoyé à ${data?.envoye_a} avec le texte enregistré et des valeurs d’exemple, sans pièce jointe.`);
  });

  const choisirSegment = (id) => {
    if (surCampagne) dispatch({ type: 'champ', champ: 'auto_segment_id', valeur: id || null });
    else dispatch({ type: 'envoi', patch: { segmentLocal: id || null } });
  };

  const automatiser = (actif) => {
    if (actif && raisons.automatiser.length) return;
    dispatch({ type: 'automatiser', actif, maintenant: new Date() });
  };

  const nomSegment = etatSeg.segment?.name ?? '';
  // Enregistrer qui met l'envoi automatique en route, ou qui change qui le reçoit (ou quand) : confirmé d'abord.
  let avantEnregistrement = null;
  if (miseEnRoute) {
    avantEnregistrement = {
      titre: 'Mettre ce mail en route automatiquement ?',
      texte: texteConfirmationActivation({ segmentNom: nomSegment, nombre, cadence: cadenceEnMots(form) }),
      bouton: 'Enregistrer et mettre en route',
    };
  } else if (reglageAutoModifie) {
    avantEnregistrement = {
      titre: form.is_automated ? 'Changer l’envoi automatique ?' : 'Arrêter l’envoi automatique ?',
      texte: texteConfirmationReglage({ actif: !!form.is_automated, segmentNom: nomSegment, cadence: cadenceEnMots(form) }),
      bouton: form.is_automated ? 'Enregistrer le changement' : 'Enregistrer et arrêter',
    };
  }

  return {
    enCours: envoyeur.enCours || envoiAilleurs || !!coupure,
    // Heure à partir de laquelle l'envoi peut reprendre après une coupure (« 14 h 32 »), sinon null.
    reprise: coupure,
    raisonsSauvegarde,
    avantEnregistrement,
    destinataires: {
      mode: cartes.destinataires,
      ranges: segmentsRanges(segments),
      segmentId,
      etatSegment: etatSeg,
      enLecture: segmentsEnLecture,
      enErreur: !!segmentsEnErreur,
      nombre,
      nombreEnLecture: compte.isFetching && nombre === undefined && !!filtres,
      phraseInconnu: phraseNombreInconnu({ nomCampagne: nomCompte }),
      dejaServis: dejaServis(nombreDe(taille), nombre),
      peutCreer: isOrgAdmin,
      exemples: { ouverts: envoi.exemples, lignes: exemples.data ?? [], enLecture: exemples.isLoading, enErreur: exemples.isError },
      dessinSegment: envoi.dessinSegment,
      enregistreSurCampagne: surCampagne,
      occupe,
      actions: {
        choisir: choisirSegment,
        basculerExemples: () => dispatch({ type: 'envoi', patch: { exemples: !envoi.exemples } }),
        ouvrirDessin: () => dispatch({ type: 'envoi', patch: { dessinSegment: true } }),
        fermerDessin: () => dispatch({ type: 'envoi', patch: { dessinSegment: false } }),
        segmentCree: (ligne) => { if (ligne?.id) choisirSegment(ligne.id); },
      },
    },
    envoi: {
      mode: cartes.envoi,
      modes: modesEnvoi({ cartes, isOrgAdmin }),
      choix: envoi.mode,
      adresseTest: envoi.adresseTest,
      raisons,
      refusNombre,
      progression: envoyeur.progression,
      enCours: envoyeur.enCours,
      // 'en_cours' : lancé par une page quittée ; 'reprendre' : cet envoi-là vient de finir.
      etatCampagne,
      reprise: coupure,
      occupe,
      essaiEnCours: !!envoi.essaiEnCours,
      // L'essai d'un e-mail du registre part avec le texte enregistré : un mail modifié qui ne peut pas l'être le ferme.
      raisonsEssai: enregistre && modifie ? raisonsSauvegarde : [],
      automatique: {
        actif: !!form.is_automated,
        jours: form.auto_cadence_days,
        heure: form.auto_time_of_day,
        minutes: form.auto_cadence_minutes,
        cadence: cadenceEnMots(form),
        prochain: prochainEnvoiEnMots(base ?? {}, { nonEnregistre: enregistre && modifie && (form.is_automated !== !!initial?.is_automated) }),
        enBase: !!base?.is_automated,
      },
      actions: {
        choisirMode: (mode) => dispatch({ type: 'envoi', patch: { mode } }),
        adresse: (valeur) => dispatch({ type: 'envoi', patch: { adresseTest: valeur } }),
        tester,
        lancer: demanderLancement,
        essayerRegistre,
        automatiser,
        jours: (v) => dispatch({ type: 'champ', champ: 'auto_cadence_days', valeur: v === '' ? null : Number(v) }),
        heure: (v) => dispatch({ type: 'champ', champ: 'auto_time_of_day', valeur: v || null }),
      },
    },
    confirmation: {
      ouverte: !!photo,
      texte: texteLancement,
      // Pourquoi « Oui, envoyer » est fermé, quand il l'est.
      attente: texteLancement ? null : (!photoAJour
        ? 'Le mail ou ses destinataires ont changé depuis : annulez, puis cliquez de nouveau sur « Lancer ».'
        : (typeof nombre === 'number'
          ? 'Plus personne à qui envoyer ce mail parmi ces destinataires.'
          : 'Calcul du nombre de destinataires… Le bouton s’ouvre dès qu’il est connu.')),
      fermer: () => dispatch({ type: 'envoi', patch: { confirmation: null } }),
      confirmer: confirmerLancement,
    },
  };
}
