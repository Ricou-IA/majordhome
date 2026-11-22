/**
 * BlocAssistant.jsx — « Ce que vous voulez dire » et rédaction assistée
 * ============================================================================
 * Deux lignes d'intention (`blocks.brief`), « Rédiger », puis « Plus court »,
 * « Plus chaleureux », « Reformuler » quand un texte existe. Pendant une demande,
 * le bouton concerné montre son avancement et les autres se ferment ; un texte
 * remplacé par l'assistant porte une barre « Annuler » (un seul retour en arrière).
 * Réservé à l'administrateur de l'entreprise (le serveur l'exige aussi) : pour les
 * autres, la page n'affiche pas ce bloc.
 * Présentation seulement : les motifs de fermeture viennent de `raisonsRedaction`.
 * ============================================================================
 */
import { Loader2, Sparkles, Undo2, X } from 'lucide-react';
import { inputClass } from '@apps/artisan/components/FormFields';

const RETOUCHES = [
  { consigne: 'court', libelle: 'Plus court' },
  { consigne: 'chaleureux', libelle: 'Plus chaleureux' },
  { consigne: 'reformuler', libelle: 'Reformuler' },
];

function Attente({ actif, children }) {
  return actif ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Rédaction…</> : children;
}

/**
 * @param {object} props
 * @param {string} props.intention
 * @param {(v: string) => void} props.onIntention
 * @param {string | null} props.enCours consigne en cours
 * @param {boolean} props.aUnTexte
 * @param {Record<string, string[]>} props.raisons motifs de fermeture par consigne (hors demande en cours)
 * @param {(consigne: string) => void} props.onDemander
 * @param {boolean} props.annulable
 * @param {() => void} props.onAnnuler
 * @param {() => void} props.onGarder
 */
export default function BlocAssistant({ intention, onIntention, enCours, aUnTexte, raisons, onDemander, annulable, onAnnuler, onGarder }) {
  // Motifs affichés : ceux de « Rédiger », puis ceux des retouches qui ne les répètent pas.
  const motifs = [...new Set([...raisons.rediger, ...(aUnTexte ? RETOUCHES.flatMap((r) => raisons[r.consigne]) : [])])];

  return (
    <div className="rounded-lg bg-primary-50/60 p-4">
      <label htmlFor="intention-mail" className="flex items-center gap-2 text-sm font-medium text-secondary-800">
        <Sparkles className="h-4 w-4 text-primary-700" aria-hidden="true" />
        Ce que vous voulez dire
      </label>
      <textarea
        id="intention-mail"
        value={intention}
        onChange={(e) => onIntention(e.target.value)}
        rows={2}
        disabled={!!enCours}
        placeholder="Par exemple : rappeler l’entretien annuel du poêle avant l’hiver, avec le lien de prise de rendez-vous."
        className={`${inputClass} mt-2 resize-y bg-white`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onDemander('rediger')}
          disabled={!!enCours || raisons.rediger.length > 0}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Attente actif={enCours === 'rediger'}>{aUnTexte ? 'Rédiger à nouveau' : 'Rédiger'}</Attente>
        </button>
        {aUnTexte && RETOUCHES.map((r) => (
          <button
            key={r.consigne}
            type="button"
            onClick={() => onDemander(r.consigne)}
            disabled={!!enCours || raisons[r.consigne].length > 0}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-secondary-300 bg-white px-3 text-sm font-medium text-secondary-700 transition-colors hover:bg-secondary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Attente actif={enCours === r.consigne}>{r.libelle}</Attente>
          </button>
        ))}
      </div>
      {motifs.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm text-secondary-500">
          {motifs.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      {annulable && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary-200 bg-white px-3 py-2 text-sm text-secondary-700" role="status">
          <span>Texte proposé par l’assistant. Relisez-le avant d’enregistrer.</span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={onAnnuler}
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 font-medium text-primary-700 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              Annuler
            </button>
            <button
              type="button"
              onClick={onGarder}
              title="Garder ce texte"
              aria-label="Garder ce texte"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-secondary-500 hover:bg-secondary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
