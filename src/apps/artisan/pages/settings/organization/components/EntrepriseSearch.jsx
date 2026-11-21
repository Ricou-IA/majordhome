// Recherche d'une entreprise dans l'annuaire des entreprises (nom, SIREN ou SIRET).
// Présentation seule : la lecture de l'annuaire est dans src/lib/organisation/annuaire.js.
import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { chercherEntreprises } from '@/lib/organisation/annuaireClient';
import { formatSiret } from '@/lib/organisation/identite';
import { INPUT_CLASS } from './layout';

/**
 * @param {{ onSelect: (entreprise: import('@/lib/organisation/annuaire').EntrepriseAnnuaire) => void, autoFocus?: boolean }} p
 */
export default function EntrepriseSearch({ onSelect, autoFocus = false }) {
  const [requete, setRequete] = useState('');
  // null = pas de recherche en cours d'affichage ; [] = recherche faite, rien trouvé
  const [propositions, setPropositions] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [panne, setPanne] = useState(false);

  useEffect(() => {
    const q = requete.trim();
    setPanne(false);
    if (q.length < 3) {
      setPropositions(null);
      setEnCours(false);
      return undefined;
    }
    const ctrl = new AbortController();
    const minuteur = setTimeout(async () => {
      setEnCours(true);
      try {
        setPropositions(await chercherEntreprises(q, ctrl.signal));
      } catch {
        if (!ctrl.signal.aborted) {
          setPropositions(null);
          setPanne(true);
        }
      } finally {
        if (!ctrl.signal.aborted) setEnCours(false);
      }
    }, 300);
    return () => {
      clearTimeout(minuteur);
      ctrl.abort();
    };
  }, [requete]);

  const choisir = (e) => {
    setRequete('');
    setPropositions(null);
    onSelect(e);
  };

  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
        <input
          type="search"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder="Nom de l’entreprise ou SIRET"
          autoFocus={autoFocus}
          autoComplete="off"
          className={`${INPUT_CLASS} pl-9 pr-9`}
        />
        {enCours && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-secondary-400" />}
      </div>

      {panne && (
        <p className="mt-1.5 text-xs text-amber-800">
          L’annuaire des entreprises ne répond pas. Réessayez dans un instant, ou saisissez à la main.
        </p>
      )}
      {propositions && propositions.length === 0 && !enCours && (
        <p className="mt-1.5 text-xs text-secondary-600">Aucune entreprise trouvée pour cette saisie.</p>
      )}
      {propositions && propositions.length > 0 && (
        <ul className="mt-1.5 border border-secondary-200 rounded-lg divide-y divide-secondary-100 bg-white overflow-hidden">
          {propositions.map((e) => (
            <li key={e.siret}>
              <button
                type="button"
                onClick={() => choisir(e)}
                className="w-full text-left px-3 py-2 hover:bg-secondary-50 focus:bg-secondary-50 focus:outline-none"
              >
                <span className="block text-sm font-medium text-secondary-900">
                  {e.raison_sociale}
                  {e.etat === 'ferme' && <span className="ml-2 text-xs font-normal text-amber-800">établissement fermé</span>}
                </span>
                <span className="block text-xs text-secondary-600 tabular-nums">
                  SIRET {formatSiret(e.siret)}
                  {(e.code_postal || e.ville) && ` · ${[e.code_postal, e.ville].filter(Boolean).join(' ')}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
