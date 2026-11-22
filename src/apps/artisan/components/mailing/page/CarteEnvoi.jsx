/**
 * CarteEnvoi.jsx — carte « Quand ? » de la page du mail
 * ============================================================================
 * Selon la nature du mail (`cartesDuMail`) :
 *  - campagne : « Une fois » (essai à une adresse, puis « Lancer » confirmé,
 *    progression par vagues) ou « Automatiquement » (tous les N jours à une
 *    heure, interrupteur enregistré comme les autres champs) ;
 *  - e-mail automatique de l'application : « M'envoyer un essai » seulement ;
 *  - séquence : lecture, avec le lien vers les Réglages.
 * Le refus de l'adresse d'envoi s'affiche dès l'ouverture. Chaque bouton fermé
 * dit pourquoi, sous lui. Présentation seulement : tout vient de
 * `useEnvoiDeLaPage` et de `src/lib/mailPage.js`.
 * ============================================================================
 */
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, FlaskConical, Loader2, Send } from 'lucide-react';
import { inputClass } from '@apps/artisan/components/FormFields';
import { EXPEDITEUR_REFUS } from '@/lib/expediteur';
import Carte from './Carte';

const REGLAGES = '/settings/communication';
const PRINCIPAL = 'inline-flex h-10 items-center gap-2 rounded-lg bg-primary-700 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDAIRE = 'inline-flex h-10 items-center gap-2 rounded-lg border border-secondary-300 bg-white px-4 text-sm font-medium text-secondary-800 transition-colors hover:bg-secondary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50';
const LIEN = 'inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

function Raisons({ liste }) {
  if (!liste.length) return null;
  return (
    <ul className="space-y-0.5 text-sm text-amber-800">
      {liste.map((r) => <li key={r}>{r}</li>)}
    </ul>
  );
}

function LienReglages({ children }) {
  return (
    <Link to={REGLAGES} className={LIEN}>
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

function Progression({ p }) {
  if (!p) return null;
  const texte = p.vague === 0
    ? 'Préparation de l’envoi…'
    : `Vague ${p.vague} — ${p.envoyes} envoyé${p.envoyes > 1 ? 's' : ''}`
      + (p.echecs > 0 ? `, ${p.echecs} échec${p.echecs > 1 ? 's' : ''}` : '')
      + (p.reste > 0 ? ` — reste environ ${p.reste}` : '');
  return (
    <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2.5 text-sm text-primary-800" aria-live="polite">
      <p className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" aria-hidden="true" />
        {texte}
      </p>
      <p className="mt-1 text-sm text-primary-700">
        Gardez cette page ouverte jusqu’à la fin. En cas d’interruption, « Lancer » reprend là où c’était arrêté, sans envoyer deux fois.
      </p>
    </div>
  );
}

/** Envoi de cette campagne lancé par une page quittée : en cours (tout fermé), puis terminé (reprise sûre). */
function EtatCampagne({ etat }) {
  if (etat === 'en_cours') {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2.5 text-sm text-primary-800" aria-live="polite">
        <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin" aria-hidden="true" />
        Un envoi de cette campagne est en cours : la vague demandée au serveur se termine. Rien ne peut repartir avant ; la page vous dira quand c’est fini.
      </p>
    );
  }
  if (etat === 'reprendre') {
    return (
      <p className="rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2.5 text-sm text-secondary-800" aria-live="polite">
        L’envoi précédent est terminé. S’il restait des destinataires, « Reprendre l’envoi » continue : ceux qui ont déjà reçu ce mail ne le recevront pas une seconde fois.
      </p>
    );
  }
  return null;
}

function UneFois({ e, bandeau }) {
  const sansBandeau = (liste) => liste.filter((r) => r !== bandeau);
  const raisonsTest = sansBandeau(e.raisons.tester);
  const raisonsLancer = sansBandeau(e.raisons.lancer).filter((r) => !raisonsTest.includes(r));
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="mail-essai" className="block text-sm font-medium text-secondary-700">D’abord un essai, à votre adresse</label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            id="mail-essai"
            type="email"
            value={e.adresseTest}
            onChange={(ev) => e.actions.adresse(ev.target.value)}
            placeholder="vous@exemple.fr"
            autoComplete="email"
            disabled={e.occupe}
            className={`${inputClass} max-w-xs`}
          />
          <button type="button" onClick={e.actions.tester} disabled={e.occupe || raisonsTest.length > 0} className={SECONDAIRE}>
            {e.enCours && !e.progression ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" aria-hidden="true" />}
            Tester
          </button>
        </div>
        <p className="text-sm text-secondary-500">L’essai reçoit le mail enregistré, au nom de « Test Destinataire ». Il ne compte pas comme un envoi.</p>
        <Raisons liste={raisonsTest} />
      </div>
      <div className="space-y-2 border-t border-secondary-100 pt-5">
        <button type="button" onClick={e.actions.lancer} disabled={e.occupe || e.raisons.lancer.length > 0} className={PRINCIPAL}>
          <Send className="h-4 w-4" aria-hidden="true" />
          {e.etatCampagne === 'reprendre' ? 'Reprendre l’envoi' : 'Lancer'}
        </button>
        <p className="text-sm text-secondary-500">Envoie le mail enregistré aux destinataires choisis, après confirmation.</p>
        <Raisons liste={raisonsLancer} />
        <Progression p={e.progression} />
      </div>
    </div>
  );
}

function Automatiquement({ e, bandeau }) {
  const a = e.automatique;
  const raisons = e.raisons.automatiser.filter((r) => r !== bandeau);
  const fermeAllumer = !a.actif && raisons.length > 0;
  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={a.actif}
          onChange={(ev) => e.actions.automatiser(ev.target.checked)}
          disabled={e.occupe || fermeAllumer}
          className="mt-0.5 h-5 w-5 rounded border-secondary-300 text-primary-700 focus:ring-primary-500"
        />
        <span>
          <span className="block text-sm font-medium text-secondary-900">Envoyer ce mail automatiquement</span>
          <span className="block text-sm text-secondary-500">
            Il part aux nouvelles personnes du groupe de destinataires, selon la cadence. Personne ne le reçoit deux fois. Pris en compte à l’enregistrement.
          </span>
        </span>
      </label>

      {a.minutes ? (
        <p className="text-sm text-secondary-700">Cadence : {a.cadence}. Cette cadence est conservée telle quelle.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="mail-jours" className="block text-sm font-medium text-secondary-700">Tous les … jours</label>
            <input
              id="mail-jours"
              type="number"
              min={1}
              max={365}
              step={1}
              value={a.jours ?? ''}
              onChange={(ev) => e.actions.jours(ev.target.value)}
              disabled={e.occupe}
              className={`${inputClass} w-28`}
            />
          </div>
          <div>
            <label htmlFor="mail-heure" className="block text-sm font-medium text-secondary-700">À (heure de Paris)</label>
            <input
              id="mail-heure"
              type="time"
              value={String(a.heure ?? '').slice(0, 5)}
              onChange={(ev) => e.actions.heure(ev.target.value)}
              disabled={e.occupe}
              className={`${inputClass} w-32`}
            />
          </div>
          {a.cadence && <p className="pb-2 text-sm text-secondary-600">Soit {a.cadence}.</p>}
        </div>
      )}

      <p className="text-sm font-medium text-secondary-800">{a.prochain}</p>
      {a.actif ? null : <Raisons liste={raisons} />}
    </div>
  );
}

/**
 * @param {object} props
 * @param {number} props.numero
 * @param {ReturnType<typeof import('./useEnvoiDeLaPage').useEnvoiDeLaPage>['envoi']} props.e
 * @param {string} props.nature
 */
export default function CarteEnvoi({ numero, e, nature }) {
  if (e.mode === 'lecture') {
    return (
      <Carte numero={numero} titre="Quand ?">
        <p className="text-sm text-secondary-700">
          {nature === 'sequence'
            ? 'Ce mail part tout seul vers vos prospects : sa mise en route et son délai se règlent dans Réglages → E-mails & SMS.'
            : 'Ce mail part tout seul, selon la cadence réglée par l’administrateur.'}
        </p>
        {nature === 'sequence' && <LienReglages>Ouvrir les réglages des e-mails</LienReglages>}
      </Carte>
    );
  }

  if (e.mode === 'essai') {
    return (
      <Carte numero={numero} titre="Quand ?" sousTitre="Ce mail part tout seul, au bon moment, depuis l’application.">
        <div className="space-y-2">
          <button type="button" onClick={e.actions.essayerRegistre} disabled={e.occupe || e.essaiEnCours || e.raisonsEssai.length > 0} className={SECONDAIRE}>
            {e.essaiEnCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" aria-hidden="true" />}
            M’envoyer un essai
          </button>
          <p className="text-sm text-secondary-500">
            L’essai part à l’adresse de réponse de votre entreprise, avec le texte enregistré et des valeurs d’exemple.
          </p>
          <Raisons liste={e.raisonsEssai} />
        </div>
      </Carte>
    );
  }

  const bandeau = e.refusNombre ? EXPEDITEUR_REFUS[e.refusNombre] : null;
  const choix = e.modes.includes(e.choix) ? e.choix : 'une_fois';
  return (
    <Carte numero={numero} titre="Quand ?">
      {bandeau && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden="true" />
          <div className="space-y-1">
            <p>{bandeau}</p>
            <p>Tant que ce n’est pas fait, ce mail ne peut pas partir à un groupe de destinataires{e.refusNombre === 'domaine_requis' ? ' ; un essai à votre adresse reste possible' : ''}.</p>
            <LienReglages>Ouvrir les réglages des e-mails</LienReglages>
          </div>
        </div>
      )}

      <EtatCampagne etat={e.etatCampagne} />

      {e.modes.length > 1 && (
        <div role="radiogroup" aria-label="Façon d’envoyer" className="inline-flex rounded-lg border border-secondary-200 bg-secondary-50 p-1">
          {[['une_fois', 'Une fois'], ['automatique', 'Automatiquement']].map(([valeur, libelle]) => (
            <button
              key={valeur}
              type="button"
              role="radio"
              aria-checked={choix === valeur}
              onClick={() => e.actions.choisirMode(valeur)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                choix === valeur ? 'bg-white text-secondary-900 shadow-sm' : 'text-secondary-600 hover:text-secondary-900'
              }`}
            >
              {libelle}
            </button>
          ))}
        </div>
      )}

      {choix === 'automatique'
        ? <Automatiquement e={e} bandeau={bandeau} />
        : <UneFois e={e} bandeau={bandeau} />}
    </Carte>
  );
}
