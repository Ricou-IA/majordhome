/**
 * elements.jsx — pièces de formulaire de l'écran « Habillage des e-mails »
 * ============================================================================
 * Présentation seule (aucune règle) : groupe titré, champ de texte avec sa
 * raison et sa suggestion d'adresse, bouton (texte + adresse), choix visuels,
 * interrupteur, champ de couleur. Les règles sont dans `src/lib/mailHabillageEcran.js`.
 * ============================================================================
 */
import { couleurPourSelecteur } from '@/lib/mailHabillageEcran';

export const LABEL_CLASS = 'block text-sm font-medium text-secondary-800';
export const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
export const ERROR_CLASS = 'mt-1 text-xs text-red-600';
export const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
export const LIEN_CLASS = 'font-medium text-primary-700 hover:underline';

/** Un groupe de réglages avec son titre (En-tête, Pied de page, Blocs fixes). */
export function Groupe({ titre, aide, children }) {
  return (
    <fieldset className="space-y-5 rounded-xl border border-secondary-200 p-4">
      <legend className="px-1 text-base font-semibold text-secondary-900">{titre}</legend>
      {aide && <p className="-mt-2 text-xs text-secondary-500">{aide}</p>}
      {children}
    </fieldset>
  );
}

/** Raison du refus d'un champ et, s'il y en a une, l'adresse complète à reprendre d'un clic. */
export function Erreur({ erreur, suggestion, onSuggestion }) {
  if (!erreur) return null;
  return (
    <div className={ERROR_CLASS}>
      <p>{erreur}</p>
      {suggestion && (
        <button type="button" onClick={() => onSuggestion(suggestion)} className="mt-0.5 font-medium text-primary-700 hover:underline">
          Utiliser « {suggestion} »
        </button>
      )}
    </div>
  );
}

/** Champ de texte d'une ligne (ou zone de texte avec `lignes`). */
export function ChampTexte({ id, libelle, aide, valeur, onChange, placeholder, max, lignes, erreur, suggestion, type = 'text' }) {
  const commun = {
    id, value: valeur, placeholder, maxLength: max, spellCheck: type === 'text',
    onChange: (e) => onChange(e.target.value),
    className: `${INPUT_CLASS} mt-2`,
    'aria-invalid': erreur ? true : undefined,
  };
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>{libelle}</label>
      {aide && <p className={HINT_CLASS}>{aide}</p>}
      {lignes ? <textarea rows={lignes} {...commun} /> : <input type={type} {...commun} />}
      <Erreur erreur={erreur} suggestion={suggestion} onSuggestion={onChange} />
    </div>
  );
}

/** Un bouton à régler : son texte et l'adresse qu'il ouvre. */
export function ChampBouton({ id, libelle, aide, bouton, max, onChange, erreur, suggestion }) {
  return (
    <div>
      <p className={LABEL_CLASS}>{libelle}</p>
      {aide && <p className={HINT_CLASS}>{aide}</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <input
          aria-label={`${libelle} : texte du bouton`}
          id={`${id}-texte`}
          value={bouton.libelle}
          maxLength={max}
          placeholder="Texte du bouton"
          onChange={(e) => onChange({ ...bouton, libelle: e.target.value })}
          className={INPUT_CLASS}
        />
        <input
          aria-label={`${libelle} : adresse ouverte par le bouton`}
          id={`${id}-adresse`}
          type="url"
          value={bouton.adresse}
          placeholder="https://…"
          spellCheck={false}
          onChange={(e) => onChange({ ...bouton, adresse: e.target.value })}
          className={INPUT_CLASS}
          aria-invalid={erreur ? true : undefined}
        />
      </div>
      <Erreur erreur={erreur} suggestion={suggestion} onSuggestion={(adresse) => onChange({ ...bouton, adresse })} />
    </div>
  );
}

/** Choix parmi quelques options, en cartes cliquables (une miniature facultative au-dessus). */
export function ChoixVisuel({ libelle, aide, options, valeur, onChange, colonnes = 2 }) {
  const grille = colonnes === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div>
      <p className={LABEL_CLASS}>{libelle}</p>
      {aide && <p className={HINT_CLASS}>{aide}</p>}
      <div className={`mt-2 grid ${grille} gap-3`} role="radiogroup" aria-label={libelle}>
        {options.map((o) => {
          const choisi = valeur === o.cle;
          return (
            <button
              key={o.cle}
              type="button"
              role="radio"
              aria-checked={choisi}
              onClick={() => onChange(o.cle)}
              className={`rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                choisi ? 'border-primary-700 bg-primary-50 ring-1 ring-primary-700' : 'border-secondary-200 hover:border-secondary-300'
              }`}
            >
              {o.miniature}
              <span className="block text-sm font-medium text-secondary-900">{o.titre}</span>
              {o.aide && <span className="block text-xs text-secondary-500">{o.aide}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Interrupteur({ actif, onClick, disabled, libelle }) {
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
export function ChampCouleur({ id, libelle, aide, valeur, defaut, pastilles, erreur, onChange, children }) {
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
