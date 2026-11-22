/**
 * CarteMessage.jsx — carte « Message » de la page du mail
 * ============================================================================
 * Dans l'ordre : ce que l'on veut dire et l'assistant (administrateur seul),
 * l'objet avec « Proposer » et son rappel au-delà de 50 caractères, le texte
 * (éditeur, ou bandeau « ancien format »), puis les avertissements : informations
 * que le texte n'affiche plus, informations que rien ne remplacera.
 * Message en lecture : éditeur fermé, assistant absent, une ligne dit pourquoi.
 * Présentation seulement : tout vient de `PageMail` et de `src/lib/mailPage.js`.
 * ============================================================================
 */
import { AlertTriangle, Info, Loader2, Sparkles } from 'lucide-react';
import { inputClass } from '@apps/artisan/components/FormFields';
import EditeurTexte from '../editeur/EditeurTexte';
import Carte from './Carte';
import BlocAssistant from './BlocAssistant';
import { BandeauAncienFormat, RevenirAncien } from './AncienFormat';

function ChoixObjets({ objets, actuel, onChoisir, disabled }) {
  if (!objets.length) return null;
  return (
    <div className="mt-2">
      <p className="text-sm text-secondary-500">Autres objets proposés, à choisir d’un clic :</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {objets.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChoisir(o)}
            disabled={disabled}
            aria-pressed={o === actuel}
            className={`rounded-full border px-3 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50 ${
              o === actuel ? 'border-primary-300 bg-primary-50 text-primary-800' : 'border-secondary-300 bg-white text-secondary-700 hover:bg-secondary-50'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Avertissement({ children }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * @param {object} props
 * @param {number} props.numero
 * @param {Record<string, any>} props.form
 * @param {number} props.version
 * @param {boolean} props.lecture message en lecture seule pour cette personne
 * @param {boolean} props.assistant rédaction assistée proposée
 * @param {boolean} props.editable le texte s'ouvre dans l'éditeur (sinon : ancien format)
 * @param {Array} props.variables `variablesProposees`, d'identité stable
 * @param {{ titre: boolean, bouton: boolean, encadre: boolean }} props.elements
 * @param {{ manquantes: string | null, inconnues: string[] }} props.avertissements
 * @param {string[]} [props.avertissementsObjet] ce que l'envoi ne remplacera pas dans l'objet
 * @param {string | null} props.rappelObjet
 * @param {string | null} props.redaction consigne en cours
 * @param {Record<string, string[]>} props.raisonsRedaction
 * @param {boolean} props.aUnTexte
 * @param {string[]} props.objetsProposes
 * @param {boolean} props.annulable
 * @param {boolean} props.aUnTexteParDefaut
 * @param {boolean} props.ancienGarde un ancien texte est mis de côté
 * @param {boolean} props.simplifiee la mise en forme du texte enregistré sera simplifiée à l'enregistrement
 * @param {object} props.actions { intention, objet, corps, demander, choisirObjet, annuler, garder, refaire, revenir }
 */
export default function CarteMessage({
  numero, form, version, lecture, assistant, editable, variables, elements, avertissements, avertissementsObjet = [], rappelObjet,
  redaction, raisonsRedaction, aUnTexte, objetsProposes, annulable, aUnTexteParDefaut, ancienGarde, simplifiee, actions,
}) {
  const occupe = !!redaction;
  const fermeObjets = occupe || raisonsRedaction.objets.length > 0;
  return (
    <Carte numero={numero} titre="Message" sousTitre="Ce que vos clients liront.">
      {lecture && (
        <p className="flex items-start gap-2 rounded-lg bg-secondary-50 px-3 py-2 text-sm text-secondary-600">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-secondary-400" aria-hidden="true" />
          Le texte de ce mail est modifié par l’administrateur de votre entreprise, sur cette page.
        </p>
      )}

      {assistant && editable && (
        <BlocAssistant
          intention={form.blocks?.brief ?? ''}
          onIntention={actions.intention}
          enCours={redaction}
          aUnTexte={aUnTexte}
          raisons={raisonsRedaction}
          onDemander={actions.demander}
          annulable={annulable}
          onAnnuler={actions.annuler}
          onGarder={actions.garder}
        />
      )}

      <div>
        <div className="flex items-end justify-between gap-3">
          <label htmlFor="objet-mail" className="text-sm font-medium text-secondary-800">Objet</label>
          {assistant && editable && (
            <button
              type="button"
              onClick={() => actions.demander('objets')}
              disabled={fermeObjets}
              title={raisonsRedaction.objets[0] || 'Trois objets proposés par l’assistant'}
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary-700 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {redaction === 'objets'
                ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Recherche…</>
                : <><Sparkles className="h-4 w-4" aria-hidden="true" />Proposer</>}
            </button>
          )}
        </div>
        <input
          id="objet-mail"
          type="text"
          value={form.subject}
          onChange={(e) => actions.objet(e.target.value)}
          disabled={lecture || occupe}
          placeholder="Ce que vos clients verront dans leur boîte de réception"
          className={`${inputClass} mt-1.5`}
        />
        {avertissementsObjet.length > 0 && (
          <div className="mt-1.5 space-y-2">
            {avertissementsObjet.map((a) => <Avertissement key={a}>{a}</Avertissement>)}
          </div>
        )}
        {rappelObjet && <p className="mt-1 text-sm text-secondary-500">{rappelObjet}</p>}
        {assistant && editable && !occupe && raisonsRedaction.objets.length > 0 && (
          <p className="mt-1 text-sm text-secondary-500">{raisonsRedaction.objets[0]}</p>
        )}
        <ChoixObjets objets={objetsProposes} actuel={form.subject} onChoisir={actions.choisirObjet} disabled={lecture || occupe} />
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-secondary-800">Texte</p>
        {editable ? (
          <div className="space-y-2">
            {simplifiee && !lecture && (
              <p className="flex items-start gap-2 text-sm text-secondary-500">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-secondary-400" aria-hidden="true" />
                La mise en forme de ce texte sera simplifiée à l’enregistrement : les couleurs et les alignements viennent
                désormais de l’habillage de votre entreprise.
              </p>
            )}
            <EditeurTexte
              valeur={form.html_body}
              version={version}
              onChange={actions.corps}
              variables={variables}
              elements={elements}
              disabled={lecture || occupe}
            />
            {ancienGarde && !lecture && <RevenirAncien disabled={occupe} onRevenir={actions.revenir} />}
          </div>
        ) : (
          <BandeauAncienFormat aUnTexteParDefaut={aUnTexteParDefaut} disabled={lecture} onRefaire={actions.refaire} />
        )}
      </div>

      {(avertissements.manquantes || avertissements.inconnues.length > 0) && (
        <div className="space-y-2">
          {avertissements.manquantes && <Avertissement>{avertissements.manquantes}</Avertissement>}
          {avertissements.inconnues.map((a) => <Avertissement key={a}>{a}</Avertissement>)}
        </div>
      )}
    </Carte>
  );
}
