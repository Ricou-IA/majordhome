/**
 * RechercheGlobale.jsx — fenêtre de recherche ouverte par Ctrl K (ou ⌘ K) et par le
 * bouton « Rechercher » du menu : un client, un lead ou une page, d'où que l'on soit.
 *
 * Elle ne cherche rien elle-même : clients par useClientSearch, leads par useLeadSearch
 * (les recherches de l'application), pages par pagesCorrespondantes. Mise en lignes,
 * destinations et déplacement au clavier : src/lib/rechercheGlobale.js.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search, X } from 'lucide-react';
import { useClientSearch } from '@hooks/useClients';
import { useLeadSearch } from '@hooks/useLeads';
import {
  SAISIE_MINIMALE, pagesCorrespondantes, lignesDeResultat, indexVoisin,
} from '@/lib/rechercheGlobale';

/**
 * @param {Object} props
 * @param {string} props.orgId  org CORE
 * @param {boolean} props.peutChercherClients
 * @param {boolean} props.peutChercherLeads
 * @param {Array<{ name: string, href: string }>} props.pages  entrées visibles du menu
 * @param {() => void} props.onClose
 */
export function RechercheGlobale({ orgId, peutChercherClients, peutChercherLeads, pages, onClose }) {
  const navigate = useNavigate();
  const [saisie, setSaisie] = useState('');
  const [actif, setActif] = useState(0);
  const listeRef = useRef(null);

  const clients = useClientSearch(peutChercherClients ? orgId : null);
  const leads = useLeadSearch(peutChercherLeads ? orgId : null);
  const chercherClients = clients.search;
  const chercherLeads = leads.search;
  useEffect(() => {
    chercherClients(saisie.trim());
    chercherLeads(saisie.trim());
  }, [saisie, chercherClients, chercherLeads]);

  const assezLong = saisie.trim().length >= SAISIE_MINIMALE;
  const lignes = useMemo(() => lignesDeResultat({
    clients: assezLong ? clients.results : [],
    leads: assezLong ? leads.results : [],
    pages: pagesCorrespondantes(pages, saisie),
  }), [assezLong, clients.results, leads.results, pages, saisie]);
  // Les hooks attendent 300 ms après la dernière frappe avant de chercher : pendant ce
  // délai on ne sait pas encore — « aucun résultat » ne s'écrit qu'une fois la réponse là.
  const [frappe, setFrappe] = useState(false);
  useEffect(() => {
    setFrappe(true);
    const minuterie = setTimeout(() => setFrappe(false), 400);
    return () => clearTimeout(minuterie);
  }, [saisie]);
  const enCours = assezLong && (frappe || clients.searching || leads.searching);
  // Une recherche en échec se dit : elle ne se lit jamais « aucun résultat ».
  const echecs = [
    peutChercherClients && clients.error ? 'les clients' : null,
    peutChercherLeads && leads.error ? 'les leads' : null,
  ].filter(Boolean);

  // La ligne active reste dans la liste quand les résultats changent.
  const indexActif = lignes.length === 0 ? -1 : Math.min(actif, lignes.length - 1);

  const ouvrir = (ligne) => {
    if (!ligne) return;
    onClose();
    navigate(ligne.href);
  };

  const auClavier = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const suivant = indexVoisin(indexActif, lignes.length, e.key === 'ArrowDown' ? 1 : -1);
      setActif(Math.max(suivant, 0));
      listeRef.current?.querySelector(`[data-index="${suivant}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      ouvrir(lignes[indexActif]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 px-3 pt-[10vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Recherche"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-secondary-200 px-4">
          <Search className="h-5 w-5 shrink-0 text-secondary-400" strokeWidth={1.75} aria-hidden="true" />
          <input
            autoFocus
            type="text"
            value={saisie}
            onChange={(e) => { setSaisie(e.target.value); setActif(0); }}
            onKeyDown={auClavier}
            placeholder="Un client, un lead, une page…"
            role="combobox"
            aria-expanded={lignes.length > 0}
            aria-controls="recherche-globale-resultats"
            aria-activedescendant={indexActif >= 0 ? `recherche-globale-${indexActif}` : undefined}
            className="h-14 w-full border-0 bg-transparent text-base text-secondary-900 placeholder:text-secondary-400 focus:outline-none focus:ring-0"
          />
          {enCours && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-secondary-400" aria-hidden="true" />}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la recherche"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary-500 hover:bg-secondary-100"
          >
            <X className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div ref={listeRef} id="recherche-globale-resultats" role="listbox" className="overflow-y-auto">
          {lignes.map((ligne, index) => (
            <div key={ligne.cle}>
              {(index === 0 || lignes[index - 1].groupe !== ligne.groupe) && (
                <p className="px-4 pb-1 pt-3 text-caption text-secondary-500">
                  {ligne.groupe}
                </p>
              )}
              <button
                type="button"
                role="option"
                id={`recherche-globale-${index}`}
                data-index={index}
                aria-selected={index === indexActif}
                onMouseEnter={() => setActif(index)}
                onClick={() => ouvrir(ligne)}
                className={`flex w-full items-baseline gap-3 px-4 py-2.5 text-left ${index === indexActif ? 'bg-primary-50' : ''}`}
              >
                <span className="min-w-0 flex-1 truncate text-cell font-medium text-secondary-900">{ligne.titre}</span>
                {ligne.detail && <span className="shrink-0 truncate text-caption text-secondary-500 max-w-[55%]">{ligne.detail}</span>}
              </button>
            </div>
          ))}

          {assezLong && !enCours && echecs.length > 0 && (
            <p className="px-4 py-3 text-sm text-amber-900">
              La recherche n’a pas abouti pour {echecs.join(' et ')}. Réessayez.
            </p>
          )}

          {lignes.length === 0 && !(assezLong && !enCours && echecs.length > 0) && (
            <p className="px-4 py-8 text-center text-sm text-secondary-500">
              {!assezLong
                ? 'Saisissez au moins deux caractères : un nom, un téléphone, une ville.'
                : enCours
                  ? 'Recherche…'
                  : 'Aucun résultat.'}
            </p>
          )}
        </div>

        <p className="hidden border-t border-secondary-200 px-4 py-2 text-caption text-secondary-500 sm:block">
          ↑ ↓ pour choisir · Entrée pour ouvrir · Échap pour fermer
        </p>
      </div>
    </div>,
    document.body,
  );
}

export default RechercheGlobale;
