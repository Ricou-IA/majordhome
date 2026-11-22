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

/**
 * `raison` : geste impossible au curseur (bouton grisé, mais toujours atteignable et la raison dans l'infobulle —
 * un bouton `disabled` n'affiche pas d'infobulle partout).
 */
function Outil({ libelle, icone: Icone, actif, onClick, disabled, raison = null, texteVisible = false }) {
  return (
    <button
      type="button"
      title={raison || libelle}
      aria-label={texteVisible ? undefined : libelle}
      aria-description={raison || undefined}
      aria-pressed={actif === undefined ? undefined : !!actif}
      aria-disabled={raison ? true : undefined}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={raison ? undefined : onClick}
      className={`inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-40 disabled:cursor-not-allowed
        ${raison ? 'cursor-not-allowed opacity-40' : ''}
        ${actif && !raison ? 'bg-primary-100 text-primary-800' : 'text-secondary-700 hover:bg-secondary-100'}`}
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
 * @param {{ gras: string | null, italique: string | null }} props.interdits raison d'un geste impossible au curseur
 * @param {Array<{ nom: string, libelle: string, bloc: boolean }>} props.aInserer
 * @param {(action: string, arg?: unknown) => void} props.onAction
 * @param {boolean} props.disabled
 */
export default function BarreOutils({ etat, interdits = {}, elements, aInserer, onAction, disabled }) {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const aucunElement = !elements.titre && !elements.bouton && !elements.encadre;

  return (
    <div
      role="toolbar"
      aria-label="Mise en forme du texte"
      className="flex flex-wrap items-center gap-0.5 rounded-t-lg border-b border-secondary-200 bg-secondary-50 px-2 py-1"
    >
      <Outil libelle="Gras (Ctrl+B)" icone={Bold} actif={etat.gras} raison={interdits.gras} onClick={() => onAction('gras')} disabled={disabled} />
      <Outil libelle="Italique (Ctrl+I)" icone={Italic} actif={etat.italique} raison={interdits.italique} onClick={() => onAction('italique')} disabled={disabled} />
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
              <div className="max-h-80 overflow-y-auto">
                {[
                  { titre: 'Dans le texte, au curseur', liste: aInserer.filter((v) => !v.bloc) },
                  { titre: 'Sur sa propre ligne', liste: aInserer.filter((v) => v.bloc) },
                ].filter((g) => g.liste.length).map((g) => (
                  <div key={g.titre} role="group" aria-label={g.titre}>
                    <p className="px-2 pb-1 pt-2 text-xs font-medium text-secondary-600">{g.titre}</p>
                    <ul>
                      {g.liste.map((v) => (
                        <li key={v.nom}>
                          <button
                            type="button"
                            onClick={() => { setMenuOuvert(false); onAction('inserer', v); }}
                            className="w-full rounded-md px-2 py-1.5 text-left text-sm text-secondary-800 hover:bg-primary-50 focus:bg-primary-50 focus:outline-none"
                          >
                            {v.libelle}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className="px-2 pb-1.5 pt-2 text-xs text-secondary-500">Le mail remplit ces informations tout seul, pour chaque destinataire.</p>
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}
