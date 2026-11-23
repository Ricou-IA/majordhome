/**
 * ClientsBarreOutils.jsx - Majord'home Artisan
 * ============================================================================
 * Barre d'outils de la liste des clients : recherche (raccourci « / »), filtre
 * Contrat, rafraîchissement, segments de catégorie et bascules « Contrats actifs » /
 * « Archivés ». Affichage seul : chaque geste remonte à la page, qui décide des
 * filtres (mêmes handlers que les anciennes cartes de statistiques).
 * ============================================================================
 */

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, FileText, RefreshCw } from 'lucide-react';
import { Button } from '@components/ui/button';
import { SegmentedControl } from '@components/ui/segmented-control';
import { cn } from '@lib/utils';
import { SearchBar } from '../shared/SearchBar';

/** Classes d'une bascule enfoncée : cuivre = sélection. */
const BASCULE_ACTIVE = 'bg-primary-50 border-primary-200 text-primary-800 hover:bg-primary-50';

/** Le « / » ne focalise la recherche que hors saisie et hors fenêtre ouverte. */
function raccourciAutorise(event) {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return false;
  const el = document.activeElement;
  if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return false;
  // Le tiroir de navigation mobile est toujours dans la page (aria-hidden quand il est fermé).
  if (document.querySelector('[role="dialog"]:not([aria-hidden="true"])')) return false;
  return true;
}

/**
 * Liste déroulante de filtre (une valeur parmi quelques options).
 */
function FilterDropdown({ label, icon: Icon, value, options, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((opt) => opt.value === value);
  const hasValue = value !== '' && value !== null;

  return (
    <div className="relative">
      <Button
        type="button"
        variant="secondary"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className={cn('h-11 md:h-[38px]', hasValue && BASCULE_ACTIVE)}
      >
        {Icon && <Icon aria-hidden="true" />}
        {selectedOption?.label || label}
        <ChevronDown aria-hidden="true" className={cn('transition-transform', isOpen && 'rotate-180')} />
      </Button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div role="listbox" className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-secondary-200 bg-white py-1 shadow-lg">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => { onChange(option.value); setIsOpen(false); }}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
                  option.value === value ? 'bg-primary-50 text-primary-800' : 'text-secondary-700 hover:bg-secondary-50',
                )}
              >
                {option.label}
                {option.value === value && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Bouton-bascule (filtre que l'on allume ou éteint). */
function Bascule({ actif, onClick, children }) {
  return (
    <Button
      type="button"
      variant="secondary"
      aria-pressed={actif}
      onClick={onClick}
      className={cn('h-11 md:h-[38px]', actif && BASCULE_ACTIVE)}
    >
      {children}
    </Button>
  );
}

/**
 * @param {Object} props
 * @param {string} props.recherche
 * @param {(texte: string) => void} props.onRecherche
 * @param {boolean} [props.raccourciActif=true]  faux quand une fenêtre de la page est ouverte
 * @param {''|'with'|'without'} props.filtreContrat
 * @param {(valeur: ''|'with'|'without') => void} props.onFiltreContrat
 * @param {() => void} props.onRafraichir
 * @param {boolean} props.chargement
 * @param {string} props.segment               segment de catégorie choisi
 * @param {Array<{ value: string, label: string, count?: string }>} props.segments
 * @param {(segment: string) => void} props.onSegment
 * @param {boolean} props.contratsActifs
 * @param {() => void} props.onContratsActifs
 * @param {boolean} props.archives            seuls les archivés
 * @param {() => void} props.onArchives
 * @param {boolean} props.inclureArchives     archivés mêlés aux autres
 * @param {() => void} props.onInclureArchives
 */
export function ClientsBarreOutils({
  recherche, onRecherche, raccourciActif = true,
  filtreContrat, onFiltreContrat, onRafraichir, chargement,
  segment, segments, onSegment,
  contratsActifs, onContratsActifs, archives, onArchives, inclureArchives, onInclureArchives,
}) {
  const champRef = useRef(null);

  useEffect(() => {
    if (!raccourciActif) return undefined;
    const surTouche = (event) => {
      if (!raccourciAutorise(event)) return;
      event.preventDefault();
      champRef.current?.focus();
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [raccourciActif]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBar
          inputRef={champRef}
          grande
          value={recherche}
          onChange={onRecherche}
          placeholder="Nom, téléphone, e-mail, ville ou n° de client…"
          ariaLabel="Rechercher un client (raccourci : /)"
          className="flex-1"
        />
        <div className="flex items-center gap-2">
          <FilterDropdown
            label="Contrat"
            icon={FileText}
            value={filtreContrat}
            options={[
              { value: '', label: 'Tous' },
              { value: 'with', label: 'Avec contrat' },
              { value: 'without', label: 'Sans contrat' },
            ]}
            onChange={onFiltreContrat}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRafraichir}
            disabled={chargement}
            aria-label="Rafraîchir la liste"
            title="Rafraîchir"
            className="h-11 w-11 md:h-[38px] md:w-[38px]"
          >
            <RefreshCw aria-hidden="true" className={chargement ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl value={segment} onChange={onSegment} options={segments} label="Catégorie de client" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Bascule actif={contratsActifs} onClick={onContratsActifs}>Contrats actifs</Bascule>
          <Bascule actif={archives} onClick={onArchives}>Archivés</Bascule>
          <Bascule actif={inclureArchives} onClick={onInclureArchives}>Inclure les archivés</Bascule>
        </div>
      </div>
    </div>
  );
}

export default ClientsBarreOutils;
