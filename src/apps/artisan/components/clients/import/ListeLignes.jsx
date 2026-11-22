/**
 * ListeLignes.jsx - Import des clients, listes repliables de l'aperçu
 * Lignes prêtes, doublons (fiche existante en face, coche de reprise) et lignes écartées.
 */

import { useState } from 'react';
import { CheckCircle2, Copy, XCircle } from 'lucide-react';
import { raisonAffichee } from '@/lib/importClients/controles';
import { libellesRapprochement } from '@/lib/importClients/libelles';

const PAS = 100;

/** Section repliable : un titre avec son compte, puis les `limite` premiers éléments (et « Afficher plus »). */
export function Repliable({ titre, icone: Icone, compte, limiteFixe, ouvert = false, children }) {
  const [limite, setLimite] = useState(limiteFixe ?? PAS);
  if (compte === 0) return null;
  const affiches = Math.min(limite, compte);
  return (
    <details open={ouvert} className="bg-white rounded-lg border border-gray-200 group">
      <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none font-medium text-gray-900">
        <Icone className="w-4 h-4 text-gray-500" aria-hidden="true" />
        {titre} ({compte})
      </summary>
      <div className="border-t border-gray-100 px-4 py-3 space-y-2">
        {children(affiches)}
        {affiches < compte && (
          <p className="text-xs text-gray-500">
            {affiches} affichées sur {compte}.
            {!limiteFixe && (
              <button type="button" onClick={() => setLimite((l) => l + PAS)} className="ml-2 text-blue-700 underline">
                Afficher plus
              </button>
            )}
          </p>
        )}
      </div>
    </details>
  );
}

const nomDe = (fiche) => fiche.display_name || '(sans nom)';
const lieuDe = (fiche) => [fiche.postal_code, fiche.city].filter(Boolean).join(' ');

function LigneFichier({ ligne }) {
  return (
    <span>
      <span className="text-gray-500">Ligne {ligne.numero} · </span>
      <span className="font-medium text-gray-900">{nomDe(ligne.fiche)}</span>
      {lieuDe(ligne.fiche) && <span className="text-gray-600"> · {lieuDe(ligne.fiche)}</span>}
    </span>
  );
}

// Échantillon tel qu'il sera écrit : téléphone mis en forme et e-mail en minuscules, pour vérifier avant d'importer.
export function ListePretes({ lignes }) {
  return (
    <Repliable titre="À importer" icone={CheckCircle2} compte={lignes.length} limiteFixe={20} ouvert>
      {(n) => (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th scope="col" className="py-1 pr-3 font-medium">Ligne</th>
                <th scope="col" className="py-1 pr-3 font-medium">Nom</th>
                <th scope="col" className="py-1 pr-3 font-medium">Téléphone</th>
                <th scope="col" className="py-1 pr-3 font-medium">E-mail</th>
                <th scope="col" className="py-1 font-medium">Commune</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lignes.slice(0, n).map((l) => (
                <tr key={l.numero}>
                  <td className="py-1 pr-3 text-gray-500">{l.numero}</td>
                  <td className="py-1 pr-3 font-medium text-gray-900">{nomDe(l.fiche)}</td>
                  <td className="py-1 pr-3 text-gray-700 whitespace-nowrap">{l.fiche.phone || '—'}</td>
                  <td className="py-1 pr-3 text-gray-700">{l.fiche.email || '—'}</td>
                  <td className="py-1 text-gray-700">{lieuDe(l.fiche) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Repliable>
  );
}

const ETIQUETTE_DOUBLON = {
  doublon_fort: 'Déjà dans vos clients',
  doublon_faible: 'Homonyme possible : importé, sauf si vous l\'écartez',
  doublon_fichier: 'En double dans le fichier',
};

function FicheExistante({ existant }) {
  const raisons = libellesRapprochement(existant);
  return (
    <li className="text-gray-700">
      {existant.display_name || '(sans nom)'}
      {existant.client_number && <span className="text-gray-500"> · n° {existant.client_number}</span>}
      {existant.city && <span className="text-gray-500"> · {existant.city}</span>}
      {raisons.length > 0 && <span className="text-gray-500"> — {raisons.join(', ')}</span>}
    </li>
  );
}

function LigneDoublon({ ligne, choix, onImporter, onEcarter }) {
  const idCoche = `import-doublon-${ligne.numero}`;
  const faible = ligne.statut === 'doublon_faible';
  const coche = faible ? choix.ecarter.has(ligne.numero) : choix.importer.has(ligne.numero);
  return (
    <li className="border border-gray-100 rounded-lg p-3 text-sm space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <LigneFichier ligne={ligne} />
          <p className="text-xs font-medium text-amber-800 mt-0.5">{ETIQUETTE_DOUBLON[ligne.statut]}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            id={idCoche}
            type="checkbox"
            checked={coche}
            onChange={() => (faible ? onEcarter(ligne.numero) : onImporter(ligne.numero))}
            className="w-4 h-4 rounded border-gray-300"
          />
          <label htmlFor={idCoche} className="text-gray-700">{faible ? 'Écarter' : 'Importer quand même'}</label>
        </div>
      </div>
      {ligne.statut === 'doublon_fichier' ? (
        <p className="text-gray-600">Déjà présent ligne {ligne.doublons[0]?.numero} du fichier</p>
      ) : (
        <ul className="pl-3 border-l-2 border-gray-200 space-y-0.5">
          {ligne.doublons.map((d) => <FicheExistante key={d.id} existant={d} />)}
        </ul>
      )}
    </li>
  );
}

export function ListeDoublons({ lignes, choix, onImporter, onEcarter }) {
  return (
    <Repliable titre="Doublons" icone={Copy} compte={lignes.length}>
      {(n) => (
        <ul className="space-y-2">
          {lignes.slice(0, n).map((l) => (
            <LigneDoublon key={l.numero} ligne={l} choix={choix} onImporter={onImporter} onEcarter={onEcarter} />
          ))}
        </ul>
      )}
    </Repliable>
  );
}

export function ListeEcartees({ lignes }) {
  return (
    <Repliable titre="Écartées" icone={XCircle} compte={lignes.length}>
      {(n) => (
        <ul className="text-sm space-y-1">
          {lignes.slice(0, n).map((l) => (
            <li key={l.numero}>
              <span className="text-gray-500">Ligne {l.numero}</span>
              <span className="text-gray-700"> — {raisonAffichee(l)}</span>
            </li>
          ))}
        </ul>
      )}
    </Repliable>
  );
}
