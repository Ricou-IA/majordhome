/**
 * BarreOutils — Mailing
 * ============================================================================
 * Barre de l'éditeur de mail : gras, italique, listes, lien, puis titre,
 * bouton, encadré (quand le mail les permet) et le menu « Insérer » des
 * informations que le mail remplit tout seul. Présentation seulement : chaque
 * geste est confié à `EditeurTexte` par `onAction`.
 *
 * Les boutons ne prennent pas le focus à la souris (`onMouseDown` empêché) :
 * la sélection du texte reste en place. Au clavier, l'éditeur a gardé sa
 * dernière sélection et la restaure.
 * ============================================================================
 */
import { useState } from 'react';
import {
  Bold, ChevronDown, Heading2, Italic, Link2, List, ListOrdered, MousePointerClick, Plus, SquareDashed,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover';

function Outil({ libelle, icone: Icone, actif, onClick, disabled, texteVisible = false }) {
  return (
    <button
      type="button"
      title={libelle}
      aria-label={texteVisible ? undefined : libelle}
      aria-pressed={actif === undefined ? undefined : !!actif}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-40 disabled:cursor-not-allowed
        ${actif ? 'bg-primary-100 text-primary-800' : 'text-secondary-700 hover:bg-secondary-100'}`}
    >
      <Icone className="h-4 w-4 shrink-0" aria-hidden="true" />
      {texteVisible && <span>{libelle}</span>}
    </button>
  );
}

const Separateur = () => <span className="mx-1 h-5 w-px bg-secondary-200" aria-hidden="true" />;

/**
 * @param {object} props
 * @param {{ gras: boolean, italique: boolean, puces: boolean, numeros: boolean, titre: boolean, encadre: boolean }} props.etat
 * @param {{ titre: boolean, bouton: boolean, encadre: boolean }} props.elements
 * @param {Array<{ nom: string, libelle: string, bloc: boolean }>} props.aInserer
 * @param {(action: string, arg?: unknown) => void} props.onAction
 * @param {boolean} props.disabled
 */
export default function BarreOutils({ etat, elements, aInserer, onAction, disabled }) {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const aucunElement = !elements.titre && !elements.bouton && !elements.encadre;

  return (
    <div
      role="toolbar"
      aria-label="Mise en forme du texte"
      className="flex flex-wrap items-center gap-0.5 rounded-t-lg border-b border-secondary-200 bg-secondary-50 px-2 py-1"
    >
      <Outil libelle="Gras (Ctrl+B)" icone={Bold} actif={etat.gras} onClick={() => onAction('gras')} disabled={disabled} />
      <Outil libelle="Italique (Ctrl+I)" icone={Italic} actif={etat.italique} onClick={() => onAction('italique')} disabled={disabled} />
      <Outil libelle="Liste à puces" icone={List} actif={etat.puces} onClick={() => onAction('puces')} disabled={disabled} />
      <Outil libelle="Liste numérotée" icone={ListOrdered} actif={etat.numeros} onClick={() => onAction('numeros')} disabled={disabled} />
      <Outil libelle="Lien" icone={Link2} onClick={() => onAction('lien')} disabled={disabled} />
      {!aucunElement && <Separateur />}
      {elements.titre && (
        <Outil libelle="Titre" icone={Heading2} actif={etat.titre} onClick={() => onAction('titre')} disabled={disabled} texteVisible />
      )}
      {elements.bouton && (
        <Outil libelle="Bouton" icone={MousePointerClick} onClick={() => onAction('bouton')} disabled={disabled} texteVisible />
      )}
      {elements.encadre && (
        <Outil libelle="Encadré" icone={SquareDashed} actif={etat.encadre} onClick={() => onAction('encadre')} disabled={disabled} texteVisible />
      )}
      {aInserer.length > 0 && (
        <>
          <Separateur />
          <Popover open={menuOuvert} onOpenChange={setMenuOuvert}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary-800 hover:bg-primary-50
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Insérer
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-72 border-secondary-200 bg-white p-1"
              // Le focus reste dans le texte : l'insertion s'y fait au curseur.
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <p className="px-2 pb-1 pt-1.5 text-xs text-secondary-600">Le mail remplit ces informations tout seul :</p>
              <ul className="max-h-72 overflow-y-auto">
                {aInserer.map((v) => (
                  <li key={v.nom}>
                    <button
                      type="button"
                      onClick={() => { setMenuOuvert(false); onAction('inserer', v); }}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-secondary-800
                        hover:bg-primary-50 focus:bg-primary-50 focus:outline-none"
                    >
                      <span>{v.libelle}</span>
                      {v.bloc && <span className="shrink-0 text-xs text-secondary-500">sur sa ligne</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}
