/**
 * PageMail.jsx — la page d'un mail (Mailing → Campagnes)
 * ============================================================================
 * Une page, à la place de la liste des campagnes : à gauche les cartes
 * numérotées, à droite l'aperçu fidèle (spec 2026-11-21-createur-mail-une-page-
 * habillage-design.md § 5.4). Ouverte par `?mail=<id>` ou `?mail=nouveau`.
 *
 * Cette page assemble, elle ne calcule pas : cartes, enregistrement, nom figé,
 * motifs de fermeture, rédaction assistée et ancien format suivent
 * `src/lib/mailPage.js` ; l'état vit dans `etatPageMail.js` (réducteur).
 *
 * Rien ne s'enregistre tout seul : « Enregistrer » seulement (une valeur
 * intermédiaire de l'éditeur pendant une saisie composée peut être fausse).
 * Quitter avec des modifications demande confirmation (bouton de retour, et
 * fermeture ou rechargement de l'onglet ; le menu latéral n'est pas retenu).
 *
 * Trois cartes, trois questions lues de haut en bas : À qui ? (Destinataires),
 * Quoi ? (Message), Quand ? (Envoi) — selon la nature du mail (`cartesDuMail`).
 * Ce qui part est ce qui est enregistré ; l'envoi passe par `useEnvoiCampagne`
 * (via `useEnvoiDeLaPage`), seule voie. Quitter pendant un envoi demande
 * confirmation : la vague en cours va à son terme, la suivante n'est pas demandée ;
 * rouverte avant la fin, la page garde l'envoi fermé (registre `envoiEnCours.js`).
 * Un autre rôle que l'administrateur n'ouvre qu'une campagne manuelle (`peutOuvrirMail`).
 * ============================================================================
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useMailCampaigns, useNombreEnvois, useRedactionMail } from '@hooks/useMailCampaigns';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { estEditable } from '@/lib/mailCorps';
import { natureDuMail, variablesProposees, elementsPermis, texteParDefaut } from '@/lib/mailVariables';
import { messageErreurRedaction } from '@/lib/mailRedaction';
import {
  cartesDuMail, etatDuNom, champsAEnregistrer, estModifie, raisonsEnregistrement, raisonsRedaction, demandeRedaction,
  appliquerRedaction, refaireAvecNouvelEditeur, revenirALAncien, rappelObjet, avertissementsTexte,
  etatEnregistrement, corpsVide, objetsSuggeres, sansElementsDe, miseEnFormeSimplifiee, peutOuvrirMail, avertissementsObjet,
} from '@/lib/mailPage';
import { lienChapitre } from '@/lib/chapitresCommunication';
import { etatInitial, reducteurPageMail } from './etatPageMail';
import EnTetePage from './EnTetePage';
import CarteMessage from './CarteMessage';
import ApercuMail from './ApercuMail';
import CarteDestinataires from './CarteDestinataires';
import CarteEnvoi from './CarteEnvoi';
import DialoguesEnvoi from './DialoguesEnvoi';
import { useEnvoiDeLaPage } from './useEnvoiDeLaPage';

const CONSIGNES_ECRAN = ['rediger', 'court', 'chaleureux', 'reformuler', 'objets'];

/** Erreur de rédaction au format du service (`{ code }`). @param {string} code */
const erreurRedaction = (code) => Object.assign(new Error(code), { code });

/**
 * @param {object} props
 * @param {string} props.mailId id du mail, ou 'nouveau'
 * @param {() => void} props.onRetour retour à la liste
 * @param {(id: string) => void} props.onCree un mail neuf vient d'être enregistré
 */
export default function PageMail({ mailId, onRetour, onCree }) {
  const { organization, isOrgAdmin } = useAuth();
  const orgId = organization?.id;
  const { settings } = useOrgSettings();
  // Archivés compris : un nom ou une clé pris par un mail archivé reste pris (contrainte et journal).
  const { campaigns, isFetched, error: erreurListe, createCampaign, updateCampaign, isMutating } = useMailCampaigns(orgId, { includeArchived: true });
  const { rediger } = useRedactionMail(orgId);
  const [etat, dispatch] = useReducer(reducteurPageMail, undefined, etatInitial);
  const navigate = useNavigate();
  const [quitter, setQuitter] = useState(null); // { vers } : départ en attente de confirmation (vers null = la liste)
  const [activation, setActivation] = useState(false); // réglage automatique à confirmer avant d'enregistrer
  const sauverRef = useRef(null); // enregistrement avant un envoi (posé plus bas, lu par useEnvoiDeLaPage)

  const neuf = mailId === 'nouveau';
  const campagneEnBase = neuf ? null : campaigns.find((c) => c.id === mailId) ?? null;

  // Un mail neuf qui vient d'être enregistré reste ouvert pendant que l'adresse passe à son id.
  const ouvert = etat.chargeDe === mailId || (neuf && !!etat.base && etat.chargeDe === etat.base.id);

  // Ouverture : une seule fois par mail (la liste rechargée après un enregistrement ne réécrit rien).
  useEffect(() => {
    if (ouvert) return;
    if (neuf) dispatch({ type: 'charger', chargeDe: 'nouveau', campagne: null });
    else if (campagneEnBase) dispatch({ type: 'charger', chargeDe: mailId, campagne: campagneEnBase });
  }, [ouvert, mailId, neuf, campagneEnBase]);

  const { form, base, initial } = etat;
  const nouveau = !initial;
  const nature = natureDuMail(base);
  const cartes = cartesDuMail(nature, { isOrgAdmin });
  const lecture = cartes.message === 'lecture';
  const assistant = isOrgAdmin && !lecture;

  // Identités stables : l'éditeur lit ses étiquettes quand `version` change.
  const variables = useMemo(() => variablesProposees(base), [base]);
  const elements = useMemo(() => elementsPermis(base), [base]);
  const sansElements = sansElementsDe(elements);
  const defaut = useMemo(() => texteParDefaut(base), [base]);

  const { nombre, echec: journalEnEchec } = useNombreEnvois(orgId, initial?.label, { enabled: !nouveau && (nature === 'manuelle' || nature === 'automatique') });
  const nom = etatDuNom({ nature, nouveau, nbEnvois: nombre, lectureSeule: lecture, journalEnEchec });

  const modifie = useMemo(() => estModifie(form, initial), [form, initial]);
  const raisons = raisonsEnregistrement({ form, initial, nature, nouveau, campagnes: campaigns, id: base?.id ?? null });
  const editable = useMemo(() => estEditable(form.html_body), [form.html_body]);
  // Mise en forme du texte ENREGISTRÉ que le premier enregistrement simplifiera (couleurs, alignements).
  const simplifiee = useMemo(() => miseEnFormeSimplifiee(initial?.html_body), [initial]);
  const avertissements = useMemo(() => avertissementsTexte(base, form.html_body), [base, form.html_body]);
  // Ce que l'envoi ne remplace pas dans l'objet (la formule de politesse dans l'objet d'une campagne).
  const avertissementsDeLObjet = useMemo(() => avertissementsObjet(base, form.subject), [base, form.subject]);
  const raisonsParConsigne = useMemo(() => Object.fromEntries(CONSIGNES_ECRAN.map((consigne) => [
    consigne, raisonsRedaction({ consigne, intention: form.blocks?.brief ?? '', objet: form.subject, corps: form.html_body }),
  ])), [form.blocks, form.subject, form.html_body]);

  const envoi = useEnvoiDeLaPage({
    orgId, isOrgAdmin, cartes, etat, dispatch, settings, modifie, raisonsEnregistrement: raisons, isMutating, sauverRef,
  });
  const { raisonsSauvegarde } = envoi;

  // Fermer ou recharger l'onglet avec des modifications ou pendant un envoi : le navigateur demande confirmation.
  const retenirDepart = modifie || envoi.enCours;
  useEffect(() => {
    if (!retenirDepart) return undefined;
    const retenir = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', retenir);
    return () => window.removeEventListener('beforeunload', retenir);
  }, [retenirDepart]);

  /** Enregistre le mail ; rend la ligne enregistrée, ou `null` (rien d'enregistré, message déjà affiché). */
  const enregistrer = useCallback(async () => {
    if (isMutating || !modifie || raisonsSauvegarde.length) return null;
    const patch = champsAEnregistrer(form, initial);
    try {
      const ligne = nouveau ? await createCampaign(patch) : await updateCampaign({ id: base.id, patch });
      dispatch({ type: 'enregistre', campagne: ligne, envoye: form });
      if (nouveau) onCree(ligne.id);
      return ligne;
    } catch {
      // Message déjà affiché par le hook ; le formulaire reste tel quel.
      return null;
    }
  }, [isMutating, modifie, raisonsSauvegarde.length, form, initial, nouveau, createCampaign, updateCampaign, base, onCree]);
  sauverRef.current = enregistrer;

  // « Enregistrer » qui mettrait l'envoi automatique en route : confirmé d'abord (c'est lui qui fera partir le mail).
  // « Enregistrer » qui met en route, change ou arrête l'envoi automatique : confirmé d'abord (il décide qui reçoit, et quand).
  const enregistrerDepuisEnTete = () => (envoi.avantEnregistrement ? setActivation(true) : enregistrer());

  const demander = useCallback(async (consigne) => {
    if (etat.redaction || raisonsParConsigne[consigne]?.length) return;
    dispatch({ type: 'redactionDebut', consigne });
    try {
      const reponse = await rediger(demandeRedaction({ consigne, form, campagne: base }));
      if (consigne === 'objets') {
        const objets = objetsSuggeres(reponse, base);
        if (!objets.length) throw erreurRedaction('reponse_illisible');
        dispatch({ type: 'objetsProposes', objets });
        return;
      }
      const texte = appliquerRedaction(reponse, { sansElements, campagne: base });
      if (!texte) throw erreurRedaction('reponse_illisible');
      dispatch({ type: 'redactionFin', ...texte });
    } catch (err) {
      dispatch({ type: 'redactionEchec' });
      toast.error(messageErreurRedaction(err?.code));
    }
  }, [etat.redaction, raisonsParConsigne, rediger, form, base, sansElements]);

  const actions = useMemo(() => ({
    intention: (valeur) => dispatch({ type: 'intention', valeur }),
    objet: (valeur) => dispatch({ type: 'champ', champ: 'subject', valeur }),
    corps: (html) => dispatch({ type: 'corps', html }),
    choisirObjet: (objet) => dispatch({ type: 'choisirObjet', objet }),
    annuler: () => dispatch({ type: 'annulerRedaction' }),
    garder: () => dispatch({ type: 'garderRedaction' }),
    demander,
    refaire: () => dispatch({ type: 'remplacerTexte', ...refaireAvecNouvelEditeur(form, defaut) }),
    revenir: () => {
      const ancien = revenirALAncien(form);
      if (ancien) dispatch({ type: 'remplacerTexte', ...ancien });
    },
  }), [demander, form, defaut]);

  const partir = (vers) => (vers ? navigate(vers) : onRetour());
  const aller = (vers = null) => (modifie || envoi.enCours ? setQuitter({ vers, envoi: envoi.enCours, reprise: envoi.reprise }) : partir(vers));

  if (!ouvert) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-secondary-500">
        {/* Tant que l'organisation n'est pas connue ou la liste jamais lue, on charge : jamais « introuvable » à tort. */}
        {!orgId || (!isFetched && !erreurListe)
          ? <><Loader2 className="h-5 w-5 animate-spin" /> Chargement du mail…</>
          : (
            <>
              <p>{erreurListe ? 'Les mails de votre entreprise n’ont pas pu être lus. Réessayez dans un instant.' : 'Ce mail est introuvable : il a peut-être été supprimé.'}</p>
              <button type="button" onClick={onRetour} className="font-medium text-primary-700 hover:underline">Revenir aux campagnes</button>
            </>
          )}
      </div>
    );
  }

  if (!peutOuvrirMail({ campagne: base, nouveau, isOrgAdmin })) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-secondary-500">
        <p>Ce mail se règle par l’administrateur de votre entreprise.</p>
        <button type="button" onClick={onRetour} className="font-medium text-primary-700 hover:underline">Revenir aux campagnes</button>
      </div>
    );
  }

  // Numéros des cartes affichées, dans l'ordre À qui ? · Quoi ? · Quand ?
  const avecDestinataires = cartes.destinataires !== 'non';
  const avecEnvoi = cartes.envoi !== 'non';
  const numeroMessage = avecDestinataires ? 2 : 1;

  return (
    <div className="space-y-6">
      <EnTetePage
        nom={form.label}
        onNom={(valeur) => dispatch({ type: 'champ', champ: 'label', valeur })}
        nomModifiable={nom.modifiable && !envoi.enCours}
        raisonNom={nom.raison}
        etat={etatEnregistrement({ nouveau, modifie, enCours: isMutating })}
        coche={!nouveau && !modifie && !isMutating}
        modifie={modifie}
        raisons={raisonsSauvegarde}
        enCours={isMutating}
        onEnregistrer={enregistrerDepuisEnTete}
        onRetour={() => aller()}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {avecDestinataires && <CarteDestinataires numero={1} d={envoi.destinataires} />}
          <CarteMessage
            numero={numeroMessage}
            form={form}
            version={etat.version}
            lecture={lecture}
            assistant={assistant}
            editable={editable}
            variables={variables}
            elements={elements}
            avertissements={avertissements}
            avertissementsObjet={lecture ? [] : avertissementsDeLObjet}
            rappelObjet={rappelObjet(form.subject)}
            redaction={etat.redaction}
            raisonsRedaction={raisonsParConsigne}
            aUnTexte={!corpsVide(form.html_body)}
            objetsProposes={etat.objetsProposes}
            annulable={!!etat.annulation}
            aUnTexteParDefaut={!!defaut}
            ancienGarde={!!form.blocks?.ancien_html}
            simplifiee={simplifiee}
            actions={actions}
          />
          {avecEnvoi && <CarteEnvoi numero={numeroMessage + 1} e={envoi.envoi} nature={nature} />}
        </div>

        <ApercuMail campagne={base} objet={form.subject} corps={form.html_body} reglages={settings} nature={nature}>
          {isOrgAdmin && (
            <button type="button" onClick={() => aller(lienChapitre('habillage'))} className="mt-2 text-sm text-secondary-600 hover:text-secondary-900 hover:underline">
              Modifier l’apparence des e-mails
            </button>
          )}
        </ApercuMail>
      </div>

      <DialoguesEnvoi
        confirmation={envoi.confirmation}
        activation={{
          ouverte: activation && !!envoi.avantEnregistrement,
          ...envoi.avantEnregistrement,
          fermer: () => setActivation(false),
          confirmer: () => { setActivation(false); enregistrer(); },
        }}
      />
      <ConfirmDialog
        open={!!quitter}
        onOpenChange={(o) => { if (!o) setQuitter(null); }}
        title={quitter?.envoi ? 'Quitter pendant l’envoi ?' : 'Quitter sans enregistrer ?'}
        description={quitter?.reprise
          ? `La connexion a été coupée pendant l’envoi : une partie de cet envoi peut encore partir. Si vous fermez ou rechargez la page, elle ne s’en souviendra plus : ne cliquez pas sur « Reprendre l’envoi » avant ${quitter.reprise}.`
          : (quitter?.envoi
            ? 'L’envoi déjà demandé au serveur ira à son terme, la suite ne partira pas. Ne reprenez pas l’envoi avant que la page du mail dise qu’il est terminé : reprendre plus tôt écrirait une seconde fois à une partie des destinataires.'
            : 'Les modifications de ce mail seront perdues.')}
        confirmLabel={quitter?.envoi ? 'Quitter quand même' : 'Quitter sans enregistrer'}
        cancelLabel="Rester sur le mail"
        onConfirm={() => { const vers = quitter?.vers ?? null; setQuitter(null); partir(vers); }}
      />
    </div>
  );
}
