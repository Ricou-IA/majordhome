/**
 * HabillageSection.jsx — « Habillage des e-mails » (Réglages → E-mails & SMS → E-mails)
 * ============================================================================
 * La forme de tous les e-mails de l'entreprise, réglée une fois : en-tête (logo,
 * bandeau et sa phrase), couleurs, pied de page. Les choix à gauche, le vrai
 * résultat à droite (`ApercuMail`, même habillage que l'envoi, sur les réglages
 * tels qu'ils seront une fois enregistrés). Spec 2026-11-21-createur-mail-une-
 * page-habillage-design.md § 5.1. Administrateur seul (garde posée par `EmailsTab`).
 *
 * Toutes les règles sont dans `src/lib/mailHabillageEcran.js` (formulaire initial,
 * ce qui est enregistré, modification, validité, pied disponible, lisibilité) ;
 * ici on assemble. Enregistre `email_habillage`, `accent_color`, `secondary_color`,
 * `email_tagline` — jamais l'ancien habillage, qu'on peut toujours retrouver.
 * ============================================================================
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Image as ImageIcon } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { logger } from '@lib/logger';
import { DEFAUTS_MARQUE } from '@/lib/mailHabillage';
import {
  formulaireInitial, situationHabillage, erreursFormulaire, estModifie, patchAEnregistrer, peutEnregistrer,
  raisonFermeture, libelleEnregistrer, empreinteHabillage, reglagesDeLApercu, piedDisponible, lisibiliteBoutons,
  logoAffiche, ligneLogo, bandeauVisible, couleurPourSelecteur, TEXTE_EXEMPLE, OBJET_EXEMPLE,
  PASTILLES_BOUTONS, PASTILLES_BANDEAU,
} from '@/lib/mailHabillageEcran';
import ApercuMail from '@/apps/artisan/components/mailing/page/ApercuMail';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const LABEL_CLASS = 'block text-sm font-medium text-secondary-800';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LIEN_CLASS = 'font-medium text-primary-700 hover:underline';

const ENTETES = [
  { cle: 'logo', titre: 'Logo seul', aide: 'Votre logo en haut, sur fond blanc.' },
  { cle: 'logo_bandeau', titre: 'Logo et bandeau', aide: 'Votre logo, puis une bande de couleur avec une phrase.' },
];

const PIED = [
  { cle: 'coordonnees', titre: 'Coordonnées', aide: 'Nom, adresse, téléphone et adresse e-mail de l’entreprise.' },
  { cle: 'certifications', titre: 'Certifications', aide: 'Vos labels et qualifications (RGE…).' },
  { cle: 'site', titre: 'Site internet', aide: 'Un lien vers votre site.' },
];

/** Miniature d'un en-tête, pour choisir à l'œil. */
function MiniatureEntete({ cle, bandeau }) {
  return (
    <div className="mb-2 overflow-hidden rounded border border-secondary-200 bg-white" aria-hidden="true">
      <div className="px-2 pt-2"><div className="h-2.5 w-10 rounded-sm bg-secondary-300" /></div>
      {cle === 'logo_bandeau' ? <div className="mt-2 h-3" style={{ background: bandeau }} /> : <div className="mt-2 h-3" />}
      <div className="space-y-1 px-2 py-2"><div className="h-1.5 w-full rounded-sm bg-secondary-100" /><div className="h-1.5 w-2/3 rounded-sm bg-secondary-100" /></div>
    </div>
  );
}

function Interrupteur({ actif, onClick, disabled, libelle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={libelle}
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${actif ? 'bg-primary-700' : 'bg-secondary-300'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${actif ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

/** Pastilles proposées, palette du système et valeur écrite ; vide = la couleur par défaut. */
function ChampCouleur({ id, libelle, aide, valeur, defaut, pastilles, erreur, onChange, children }) {
  const choisie = valeur.trim().toLowerCase();
  return (
    <div>
      <label htmlFor={`${id}-texte`} className={LABEL_CLASS}>{libelle}</label>
      <p className={HINT_CLASS}>{aide}</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`${libelle} : couleurs proposées`}>
        {pastilles.map((p) => {
          const active = choisie === p.couleur;
          return (
            <button
              key={p.couleur}
              type="button"
              onClick={() => onChange(p.couleur)}
              aria-label={p.nom}
              aria-pressed={active}
              title={p.nom}
              className={`h-8 w-8 rounded-full border border-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
                active ? 'ring-2 ring-secondary-900 ring-offset-2' : ''
              }`}
              style={{ background: p.couleur }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="color"
          aria-label={`${libelle} : palette`}
          value={couleurPourSelecteur(valeur, defaut)}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-secondary-300 bg-white p-0.5"
        />
        <input
          id={`${id}-texte`}
          type="text"
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Par défaut"
          spellCheck={false}
          className={`${INPUT_CLASS} max-w-[9rem] font-mono`}
        />
        {valeur && (
          <button type="button" onClick={() => onChange('')} className="text-xs text-secondary-600 hover:text-secondary-900 hover:underline">
            Couleur par défaut
          </button>
        )}
      </div>
      {erreur && <p className={ERROR_CLASS}>{erreur}</p>}
      {children}
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
  const modifie = estModifie(form, initial);
  const ouvert = peutEnregistrer(form, initial, settings);
  const raison = raisonFermeture(form, initial, settings);
  const pied = piedDisponible(settings);
  const lisibilite = lisibiliteBoutons(form.couleurBoutons);
  const logo = logoAffiche(settings);
  const etatLogo = ligneLogo(settings);
  const reglagesApercu = useMemo(() => reglagesDeLApercu(settings, form, voirActuel), [settings, form, voirActuel]);

  const champ = (cle, valeur) => setForm((f) => ({ ...f, [cle]: valeur }));
  const basculerPied = (cle) => setForm((f) => ({ ...f, pied: { ...f.pied, [cle]: !f.pied[cle] } }));

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
        L’allure de tous les e-mails de votre entreprise : en-tête, couleurs et pied de page. Réglée une fois, elle
        s’applique à chaque e-mail envoyé.
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
        <div className="min-w-0 space-y-7">
          <div>
            <p className={LABEL_CLASS}>En-tête</p>
            <p className={HINT_CLASS}>Ce qui apparaît en haut de chaque e-mail.</p>
            <div className="mt-2 grid grid-cols-2 gap-3" role="radiogroup" aria-label="En-tête">
              {ENTETES.map((e) => {
                const choisi = form.entete === e.cle;
                return (
                  <button
                    key={e.cle}
                    type="button"
                    role="radio"
                    aria-checked={choisi}
                    onClick={() => champ('entete', e.cle)}
                    className={`rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                      choisi ? 'border-primary-700 bg-primary-50 ring-1 ring-primary-700' : 'border-secondary-200 hover:border-secondary-300'
                    }`}
                  >
                    <MiniatureEntete cle={e.cle} bandeau={couleurPourSelecteur(form.couleurBandeau, DEFAUTS_MARQUE.bandeau)} />
                    <span className="block text-sm font-medium text-secondary-900">{e.titre}</span>
                    <span className="block text-xs text-secondary-500">{e.aide}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {form.entete === 'logo_bandeau' && (
            <>
              <div>
                <label htmlFor="habillage-phrase" className={LABEL_CLASS}>Phrase du bandeau</label>
                <p className={HINT_CLASS}>Une phrase courte, écrite en blanc dans le bandeau. Le bandeau n’apparaît que si une phrase est écrite.</p>
                <input
                  id="habillage-phrase"
                  type="text"
                  value={form.phrase}
                  onChange={(e) => champ('phrase', e.target.value)}
                  placeholder="Chauffage, climatisation et entretien depuis 1990"
                  maxLength={140}
                  className={`${INPUT_CLASS} mt-2`}
                />
                {!bandeauVisible(form) && <p className="mt-1 text-xs text-amber-800">Sans phrase, le bandeau n’est pas affiché.</p>}
              </div>
              <ChampCouleur
                id="habillage-bandeau"
                libelle="Couleur du bandeau"
                aide="La bande de couleur sous le logo."
                valeur={form.couleurBandeau}
                defaut={DEFAUTS_MARQUE.bandeau}
                pastilles={PASTILLES_BANDEAU}
                erreur={erreurs.couleurBandeau}
                onChange={(v) => champ('couleurBandeau', v)}
              />
            </>
          )}

          <ChampCouleur
            id="habillage-boutons"
            libelle="Couleur des boutons et des liens"
            aide="C’est aussi la couleur des pages que vos clients ouvrent sans compte (prise de rendez-vous, procès-verbal de réception)."
            valeur={form.couleurBoutons}
            defaut={DEFAUTS_MARQUE.accent}
            pastilles={PASTILLES_BOUTONS}
            erreur={erreurs.couleurBoutons}
            onChange={(v) => champ('couleurBoutons', v)}
          >
            {!erreurs.couleurBoutons && !lisibilite.lisible && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p>Le texte blanc des boutons se lit mal sur cette couleur.</p>
                {lisibilite.suggestion && (
                  <button type="button" onClick={() => champ('couleurBoutons', lisibilite.suggestion)} className="mt-1 inline-flex items-center gap-2 font-medium hover:underline">
                    <span className="inline-block h-4 w-4 rounded-sm border border-amber-300" style={{ background: lisibilite.suggestion }} aria-hidden="true" />
                    Prendre une teinte plus foncée ({lisibilite.suggestion})
                  </button>
                )}
              </div>
            )}
          </ChampCouleur>

          <div>
            <p className={LABEL_CLASS}>Pied de page</p>
            <p className={HINT_CLASS}>Ce qui apparaît en bas de chaque e-mail. Le lien pour se désabonner y est toujours.</p>
            <ul className="mt-2 divide-y divide-secondary-100 rounded-lg border border-secondary-200">
              {PIED.map((p) => {
                const dispo = pied[p.cle];
                return (
                  <li key={p.cle} className="flex items-start justify-between gap-4 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className={`text-sm ${dispo.disponible ? 'text-secondary-900' : 'text-secondary-400'}`}>{p.titre}</p>
                      <p className="text-xs text-secondary-500">
                        {dispo.disponible ? p.aide : (
                          <>{dispo.raison} <Link to={dispo.lien.vers} className={LIEN_CLASS}>À renseigner dans {dispo.lien.libelle}</Link></>
                        )}
                      </p>
                    </div>
                    <Interrupteur
                      actif={dispo.disponible && form.pied[p.cle]}
                      disabled={!dispo.disponible}
                      onClick={() => basculerPied(p.cle)}
                      libelle={p.titre}
                    />
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <p className={LABEL_CLASS}>Logo</p>
            <div className="mt-2 flex items-center gap-4">
              <div className="flex h-16 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-secondary-200 bg-white p-2">
                {settings?.logo_url
                  ? <img src={settings.logo_url} alt="Logo de l’entreprise" className="max-h-full max-w-full object-contain" />
                  : <ImageIcon className="h-6 w-6 text-secondary-300" aria-hidden="true" />}
              </div>
              <div className="min-w-0 text-xs text-secondary-500">
                {etatLogo === 'absent' && <p>Pas de logo : le nom de l’entreprise est écrit à sa place{logo.nom ? ` (« ${logo.nom} »)` : ''}.</p>}
                {etatLogo === 'non_sur' && <p>Ce logo n’est pas hébergé de façon sûre : le nom de l’entreprise est écrit à sa place. Déposez-le à nouveau pour l’utiliser.</p>}
                <Link to="/settings/organization?tab=identity" className={LIEN_CLASS}>Changer le logo dans Organisation → Identité</Link>
              </div>
            </div>
          </div>
        </div>

        <ApercuMail campagne={null} objet={OBJET_EXEMPLE} corps={TEXTE_EXEMPLE} reglages={reglagesApercu} nature="auto_registre" />
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
        description="Vos e-mails reprennent l’habillage d’avant. Les couleurs et la phrase du bandeau réglées ici restent enregistrées : l’ancien habillage peut s’en servir. Vos choix d’en-tête et de pied de page ne sont pas gardés."
        confirmLabel="Revenir à l’ancien habillage"
        cancelLabel="Garder le nouvel habillage"
        variant="default"
        loading={isSaving}
        onConfirm={revenir}
      />
    </section>
  );
}
