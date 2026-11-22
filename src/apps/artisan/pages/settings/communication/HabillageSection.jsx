/**
 * HabillageSection.jsx — « Habillage des e-mails » (Réglages → E-mails & SMS)
 * ============================================================================
 * La forme de tous les e-mails de l'entreprise, réglée une fois : en-tête (logo,
 * bandeau, sa phrase et son bouton), couleurs, pied de page (coordonnées, horaires,
 * réseaux, fond) et jusqu'à deux blocs fixes. Les choix à gauche (`habillage/`), le
 * vrai résultat à droite (`ApercuMail`, même habillage que l'envoi, sur les réglages
 * tels qu'ils seront une fois enregistrés), en campagne ou en e-mail automatique.
 * Specs 2026-11-21-createur-mail-une-page-habillage-design.md § 5.1 et
 * 2026-11-22-reglages-emails-chapitres-habillage-enrichi-design.md § 3. Administrateur seul.
 *
 * Toutes les règles sont dans `src/lib/mailHabillageEcran.js` (formulaire initial,
 * ce qui est enregistré, modification, validité, blocs, pied disponible) ; ici on
 * assemble. Enregistre `email_habillage` (entier), `accent_color`, `secondary_color`,
 * `email_tagline` — jamais l'ancien habillage, qu'on peut toujours retrouver.
 * ============================================================================
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { logger } from '@lib/logger';
import { DEFAUTS_MARQUE } from '@/lib/mailHabillage';
import {
  formulaireInitial, situationHabillage, erreursFormulaire, suggestionsFormulaire, estModifie, patchAEnregistrer,
  peutEnregistrer, raisonFermeture, libelleEnregistrer, empreinteHabillage, reglagesDeLApercu, piedDisponible,
  couleurPourSelecteur, TEXTE_EXEMPLE, OBJET_EXEMPLE, USAGES_APERCU,
} from '@/lib/mailHabillageEcran';
import ApercuMail from '@/apps/artisan/components/mailing/page/ApercuMail';
import EnteteGroupe from './habillage/EnteteGroupe';
import PiedGroupe from './habillage/PiedGroupe';
import BlocsGroupe from './habillage/BlocsGroupe';
import { LIEN_CLASS } from './habillage/elements';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';

/** Choix de l'aperçu : campagne ou e-mail automatique (un bloc « campagnes » ne paraît que dans le premier). */
function ChoixApercu({ valeur, onChange, avecBlocCampagnes }) {
  return (
    <div>
      <div className="inline-flex rounded-lg bg-secondary-100 p-1" role="radiogroup" aria-label="Aperçu">
        {USAGES_APERCU.map((u) => (
          <button
            key={u.cle}
            type="button"
            role="radio"
            aria-checked={valeur === u.cle}
            onClick={() => onChange(u.cle)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
              valeur === u.cle ? 'bg-white text-secondary-900 shadow-sm' : 'text-secondary-500 hover:text-secondary-800'
            }`}
          >
            {u.libelle}
          </button>
        ))}
      </div>
      {avecBlocCampagnes && (
        <p className="mt-1 text-xs text-secondary-500">Un bloc « Sur vos campagnes seulement » ne paraît pas dans un e-mail automatique.</p>
      )}
    </div>
  );
}

export default function HabillageSection() {
  const { settings, save, isSaving } = useOrgSettings();
  const location = useLocation();
  const [initial, setInitial] = useState(() => formulaireInitial(settings));
  const [form, setForm] = useState(initial);
  const [dialogue, setDialogue] = useState(null); // 'remplacer' | 'revenir' | null
  const [voirActuel, setVoirActuel] = useState(false);
  const [changeAilleurs, setChangeAilleurs] = useState(false); // habillage enregistré modifié ailleurs pendant une saisie
  const [usageApercu, setUsageApercu] = useState(USAGES_APERCU[0].cle);

  // Le formulaire ne repart des réglages en base que si l'HABILLAGE enregistré change (un autre réglage écrit
  // ailleurs ne touche à rien) ; une saisie en cours n'est jamais effacée : on prévient, « Recharger » la remplace.
  const empreinte = empreinteHabillage(settings);
  const courant = useRef({ settings, form, initial });
  courant.current = { settings, form, initial };
  const empreinteVue = useRef(empreinte);
  useEffect(() => {
    if (empreinteVue.current === empreinte) return;
    empreinteVue.current = empreinte;
    const { settings: s, form: f, initial: i } = courant.current;
    if (estModifie(f, i)) { setChangeAilleurs(true); return; }
    const neuf = formulaireInitial(s);
    setInitial(neuf);
    setForm(neuf);
  }, [empreinte]);

  /** Repart de ce qui est (ou sera, juste après un enregistrement) en base. @param {Record<string, any>} s */
  const repartirDe = (s) => {
    const neuf = formulaireInitial(s);
    setInitial(neuf);
    setForm(neuf);
    setChangeAilleurs(false);
  };

  // Lien « Modifier l'habillage » de la page d'un mail : on amène la section à l'écran.
  useEffect(() => {
    if (location.hash === '#habillage') document.getElementById('habillage')?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  const situation = situationHabillage(settings);
  const erreurs = erreursFormulaire(form);
  const suggestions = suggestionsFormulaire(form);
  const modifie = estModifie(form, initial);
  const ouvert = peutEnregistrer(form, initial, settings);
  const raison = raisonFermeture(form, initial, settings);
  const pied = piedDisponible(settings);
  const reglagesApercu = useMemo(() => reglagesDeLApercu(settings, form, voirActuel), [settings, form, voirActuel]);

  const champ = (cle, valeur) => setForm((f) => ({ ...f, [cle]: valeur }));
  const setPied = (modif) => setForm((f) => ({ ...f, pied: { ...f.pied, ...modif } }));

  const enregistrer = async () => {
    setDialogue(null);
    if (!ouvert || isSaving) return;
    try {
      const patch = patchAEnregistrer(form, settings);
      await save(patch);
      repartirDe({ ...settings, ...patch });
      setVoirActuel(false);
      toast.success('Habillage des e-mails enregistré : vos prochains e-mails partiront ainsi.');
    } catch (err) {
      logger.error('[HabillageSection] enregistrement', err);
      toast.error('L’habillage n’a pas pu être enregistré. Réessayez dans un instant.');
    }
  };

  const revenir = async () => {
    setDialogue(null);
    try {
      await save({ email_habillage: null });
      repartirDe({ ...settings, email_habillage: null });
      toast.success('Vos e-mails reprennent leur ancien habillage.');
    } catch (err) {
      logger.error('[HabillageSection] retour à l’ancien habillage', err);
      toast.error('L’ancien habillage n’a pas pu être remis. Réessayez dans un instant.');
    }
  };

  const demanderEnregistrement = () => {
    if (!ouvert || isSaving) return;
    if (situation.remplacementAConfirmer) setDialogue('remplacer');
    else enregistrer();
  };

  return (
    <section id="habillage" className="card scroll-mt-24">
      <h3 className={SECTION_TITLE}>Habillage des e-mails</h3>
      <p className="text-sm text-secondary-600">
        L’allure de tous les e-mails de votre entreprise : en-tête, couleurs, pied de page et blocs fixes. Réglée une fois,
        elle s’applique à chaque e-mail envoyé.
      </p>

      {situation.remplacementAConfirmer && (
        <div className="mt-4 rounded-lg border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-700">
          <p>
            Vos e-mails partent aujourd’hui avec votre habillage précédent. « Adopter cet habillage » le remplace par
            celui de l’aperçu, que vous pouvez d’abord ajuster. L’habillage précédent est conservé : vous pourrez y revenir.
          </p>
          <button type="button" onClick={() => setVoirActuel((v) => !v)} className={`mt-2 text-sm ${LIEN_CLASS}`}>
            {voirActuel ? 'Voir le nouvel habillage' : 'Voir l’habillage actuel'}
          </button>
        </div>
      )}

      {changeAilleurs && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-700">
          <p>L’habillage enregistré a été modifié ailleurs pendant votre saisie.</p>
          <button type="button" onClick={() => repartirDe(settings)} className={`text-sm ${LIEN_CLASS}`}>
            Recharger
          </button>
        </div>
      )}

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <EnteteGroupe form={form} settings={settings} erreurs={erreurs} suggestions={suggestions} champ={champ} />
          <PiedGroupe
            form={form}
            disponible={pied}
            erreurs={erreurs}
            suggestions={suggestions}
            couleurBandeau={couleurPourSelecteur(form.couleurBandeau, DEFAUTS_MARQUE.bandeau)}
            setPied={setPied}
          />
          <BlocsGroupe form={form} erreurs={erreurs} suggestions={suggestions} setForm={setForm} />
        </div>

        <div className="min-w-0 space-y-3 lg:sticky lg:top-28">
          <ChoixApercu
            valeur={usageApercu}
            onChange={setUsageApercu}
            avecBlocCampagnes={form.blocs.some((b) => b.ou === 'campagnes')}
          />
          <ApercuMail
            campagne={null}
            objet={OBJET_EXEMPLE}
            corps={TEXTE_EXEMPLE}
            reglages={reglagesApercu}
            nature="auto_registre"
            usage={usageApercu}
          />
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-secondary-200 pt-4">
        <div>
          {situation.retourPossible && (
            <button type="button" onClick={() => setDialogue('revenir')} disabled={isSaving} className="text-sm text-secondary-600 hover:text-secondary-900 hover:underline disabled:opacity-50">
              Revenir à l’ancien habillage
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {raison && <span className="text-xs text-secondary-500">{raison}</span>}
          <button
            type="button"
            onClick={() => setForm(initial)}
            disabled={!modifie || isSaving}
            className="px-4 py-2 text-sm text-secondary-600 hover:bg-secondary-50 rounded-md disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={demanderEnregistrement}
            disabled={!ouvert || isSaving}
            className="px-4 py-2 text-sm bg-primary-700 text-white rounded-md hover:bg-primary-800 disabled:opacity-50"
          >
            {isSaving ? 'Enregistrement…' : libelleEnregistrer(settings)}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={dialogue === 'remplacer'}
        onOpenChange={(o) => { if (!o) setDialogue(null); }}
        title="Remplacer l’habillage de vos e-mails ?"
        description="Chaque e-mail envoyé à partir de maintenant aura l’habillage de l’aperçu. L’habillage précédent est conservé : « Revenir à l’ancien habillage » le remet en place."
        confirmLabel="Remplacer l’habillage"
        cancelLabel="Garder l’habillage actuel"
        variant="default"
        loading={isSaving}
        onConfirm={enregistrer}
      />
      <ConfirmDialog
        open={dialogue === 'revenir'}
        onOpenChange={(o) => { if (!o) setDialogue(null); }}
        title="Revenir à l’ancien habillage ?"
        description="Vos e-mails reprennent l’habillage d’avant. Les couleurs et la phrase du bandeau réglées ici restent enregistrées : l’ancien habillage peut s’en servir. Vos choix d’en-tête, de pied de page et vos blocs fixes ne sont pas gardés."
        confirmLabel="Revenir à l’ancien habillage"
        cancelLabel="Garder le nouvel habillage"
        variant="default"
        loading={isSaving}
        onConfirm={revenir}
      />
    </section>
  );
}
