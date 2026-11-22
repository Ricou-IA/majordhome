/**
 * FenetreLien — Mailing
 * ============================================================================
 * Petite fenêtre de l'éditeur de mail pour poser ou modifier un lien ou un
 * bouton : un texte et une adresse, saisie (https://…, mailto:, tel:) ou
 * choisie parmi les adresses que le mail remplit tout seul (« Lien du PV »…).
 * Elle remplace `window.prompt`.
 *
 * La règle d'adresse est `adresseDeLienValide` (src/lib/mailLien.js) : la
 * fenêtre ne se ferme pas sur une adresse refusée, elle dit pourquoi et, pour
 * « monsite.fr », propose l'adresse complète.
 * ============================================================================
 */
import { useId, useState } from 'react';
import { Link2, X } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { inputClass } from '@apps/artisan/components/FormFields';
import { adresseDeLienValide } from '@lib/mailLien';

const JETON_SEUL = /^\{\{[A-Za-z0-9_]+\}\}$/;

/** Libellé d'une adresse proposée ; le nom sans accolades si elle n'est pas dans la liste. */
function libelleDe(jeton, proposees) {
  return proposees.find((v) => v.nom === jeton)?.libelle || jeton.slice(2, -2);
}

/** Fenêtre ouverte : montée à chaque ouverture (clé), son état part toujours de la demande. */
function FenetreOuverte({ demande, proposees, onValider, onRetirer, onFermer }) {
  const id = useId();
  const bouton = demande.mode === 'bouton';
  const existant = !!demande.existant;
  const adresseInitiale = demande.adresse ?? '';
  const initialeProposee = JETON_SEUL.test(adresseInitiale);
  const [texte, setTexte] = useState(demande.texte ?? '');
  const [saisie, setSaisie] = useState(initialeProposee ? '' : adresseInitiale);
  const [choisie, setChoisie] = useState(initialeProposee ? adresseInitiale : null);
  const [erreur, setErreur] = useState(null);

  const valider = () => {
    if (!texte.trim()) {
      setErreur({ message: bouton ? 'Indiquez le texte du bouton.' : 'Indiquez le texte du lien.' });
      return;
    }
    const verdict = adresseDeLienValide(choisie ?? saisie, proposees);
    if (!verdict.valide) { setErreur(verdict); return; }
    onValider({ texte: texte.trim(), adresse: verdict.adresse });
  };

  const titre = bouton ? (existant ? 'Modifier le bouton' : 'Ajouter un bouton') : (existant ? 'Modifier le lien' : 'Ajouter un lien');

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onFermer(); }}
      title={titre}
      description={bouton
        ? 'Un bouton bien visible, au centre du mail, qui ouvre l’adresse.'
        : 'Le texte devient cliquable et ouvre l’adresse.'}
      confirmLabel={existant ? 'Enregistrer' : 'Ajouter'}
      variant="default"
      onConfirm={valider}
    >
      <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); valider(); }}>
        <div className="space-y-1">
          <label htmlFor={`${id}-texte`} className="block text-sm font-medium text-secondary-700">
            {bouton ? 'Texte du bouton' : 'Texte du lien'}
          </label>
          <input
            id={`${id}-texte`}
            className={inputClass}
            value={texte}
            onChange={(e) => { setTexte(e.target.value); setErreur(null); }}
            placeholder={bouton ? 'Signer en ligne' : 'notre site'}
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <label htmlFor={`${id}-adresse`} className="block text-sm font-medium text-secondary-700">Adresse</label>
          {choisie ? (
            <div className="flex flex-wrap items-center gap-2">
              <span
                id={`${id}-adresse`}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-800 ring-1 ring-primary-200"
              >
                <Link2 className="h-4 w-4" aria-hidden="true" />
                {libelleDe(choisie, proposees)}
              </span>
              <button
                type="button"
                onClick={() => { setChoisie(null); setErreur(null); }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-secondary-600 hover:bg-secondary-100"
              >
                <X className="h-4 w-4" aria-hidden="true" /> Saisir une autre adresse
              </button>
            </div>
          ) : (
            <input
              id={`${id}-adresse`}
              className={inputClass}
              value={saisie}
              onChange={(e) => { setSaisie(e.target.value); setErreur(null); }}
              placeholder="https://…, mailto:… ou tel:…"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
            />
          )}
          {proposees.length > 0 && !choisie && (
            <div className="pt-1">
              <p className="text-xs text-secondary-600">Ou choisissez une adresse que le mail remplit tout seul :</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {proposees.map((v) => (
                  <button
                    key={v.nom}
                    type="button"
                    onClick={() => { setChoisie(v.nom); setSaisie(''); setErreur(null); }}
                    className="rounded-full border border-primary-200 bg-white px-3 py-1 text-xs font-medium text-primary-800 hover:bg-primary-50"
                  >
                    {v.libelle}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {erreur && (
          <div role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
            <p>{erreur.message}</p>
            {erreur.suggestion && (
              <button
                type="button"
                onClick={() => { setSaisie(erreur.suggestion); setErreur(null); }}
                className="mt-1 font-medium text-primary-800 underline underline-offset-2"
              >
                Utiliser {erreur.suggestion}
              </button>
            )}
          </div>
        )}

        {existant && (
          <button type="button" onClick={onRetirer} className="text-sm font-medium text-red-700 hover:underline">
            {bouton ? 'Retirer le bouton' : 'Retirer le lien'}
          </button>
        )}
        {/* Entrée dans un champ = valider (le bouton visible est celui de la fenêtre). */}
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </ConfirmDialog>
  );
}

/**
 * @param {object} props
 * @param {null | { mode: 'lien' | 'bouton', texte?: string, adresse?: string, existant?: boolean, n?: number }} props.demande
 *   fenêtre ouverte sur cette demande (`n` : numéro d'ouverture) ; `null` = fermée
 * @param {Array<{ nom: string, libelle: string }>} props.adressesProposees adresses que le mail remplit seul
 * @param {(r: { texte: string, adresse: string }) => void} props.onValider
 * @param {() => void} props.onRetirer
 * @param {() => void} props.onFermer
 */
export default function FenetreLien({ demande, adressesProposees = [], onValider, onRetirer, onFermer }) {
  if (!demande) return null;
  return (
    <FenetreOuverte
      key={demande.n ?? 0}
      demande={demande}
      proposees={adressesProposees}
      onValider={onValider}
      onRetirer={onRetirer}
      onFermer={onFermer}
    />
  );
}
