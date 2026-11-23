/**
 * EtapeCorrespondance.jsx - Import des clients, étape 2
 * Une ligne par colonne du fichier : son en-tête, trois valeurs, et le champ de la fiche qu'elle remplit.
 */

import { ListeChoix } from '@/components/ui/liste-choix';
import { useMemo } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Info, Lightbulb } from 'lucide-react';
import {
  CHAMPS, CIBLES_COMPOSEES, CIBLE_NOTES, CIBLE_IGNORER, CIBLE_A_CHOISIR,
} from '@/lib/importClients/champs';
import { conseilsCorrespondance } from '@/lib/importClients/correspondance';
import { texteAccentsRepares } from '@/lib/importClients/libelles';

/** Trois premières valeurs non vides de chaque colonne. */
function exemplesParColonne(lignes, nbColonnes) {
  const exemples = Array.from({ length: nbColonnes }, () => []);
  for (const l of lignes) {
    let complet = true;
    for (let k = 0; k < nbColonnes; k += 1) {
      if (exemples[k].length < 3) {
        if (l.cellules[k]) exemples[k].push(l.cellules[k]);
        if (exemples[k].length < 3) complet = false;
      }
    }
    if (complet) break;
  }
  return exemples;
}

/** Aperçu d'une ligne du fichier pour le choix de la ligne d'en-tête. */
function resumeLigne(ligne) {
  const texte = (ligne || []).filter((c) => String(c ?? '').trim() !== '').slice(0, 4).join(' · ');
  const coupe = texte.length > 70 ? `${texte.slice(0, 70)}…` : texte;
  return coupe || '(ligne vide)';
}

export default function EtapeCorrespondance({
  fichier, correspondance, validation, onEntete, onCible, onRetour, onSuite,
}) {
  const exemples = useMemo(
    () => exemplesParColonne(fichier.lignes, fichier.entetes.length),
    [fichier],
  );
  // Conseils lus sur les valeurs (adresse qui porte code postal et ville, nom qui porte le prénom) : ils ne bloquent rien.
  const conseils = useMemo(
    () => new Map(conseilsCorrespondance(correspondance, fichier.lignes).map((c) => [c.index, c])),
    [correspondance, fichier],
  );
  const accents = texteAccentsRepares(fichier.reparees);
  const { erreurs, aChoisir } = validation;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-secondary-200 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">Quelle colonne va où ?</h2>
            <p className="text-sm text-secondary-600">
              {fichier.nom} · {fichier.lignes.length} ligne{fichier.lignes.length > 1 ? 's' : ''}. Vérifiez le champ choisi
              pour chaque colonne de votre fichier.
            </p>
            {accents && (
              <p className="mt-1 flex items-start gap-2 text-sm text-secondary-700">
                <Info className="w-4 h-4 mt-0.5 shrink-0 text-secondary-500" aria-hidden="true" />
                {accents}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="import-entete" className="block text-sm font-medium text-secondary-700 mb-1">Ligne d&apos;en-tête</label>
            <ListeChoix
              id="import-entete"
              value={fichier.indexEntete}
              onChange={(v) => onEntete(Number(v))}
              className="sm:w-80"
              selectClassName="sm:w-80"
              options={fichier.matrice.slice(0, 10).map((ligne, i) => ({ value: i, label: `Ligne ${i + 1} : ${resumeLigne(ligne)}` }))}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-left text-secondary-500">
                <th scope="col" className="py-2 pr-4 font-medium">Colonne du fichier</th>
                <th scope="col" className="py-2 pr-4 font-medium">Premières valeurs</th>
                <th scope="col" className="py-2 font-medium">Champ de la fiche</th>
              </tr>
            </thead>
            <tbody>
              {correspondance.map((col) => {
                const aFaire = col.cible === CIBLE_A_CHOISIR;
                const idSelect = `import-cible-${col.index}`;
                const conseil = conseils.get(col.index);
                return (
                  <tr key={col.index} className={`border-b border-secondary-100 align-top ${aFaire ? 'bg-amber-50' : ''}`}>
                    <th scope="row" className="py-2 pr-4 font-medium text-secondary-900 text-left">
                      {col.entete}
                      {aFaire && <span className="block text-xs font-normal text-amber-800">À choisir</span>}
                    </th>
                    <td className="py-2 pr-4 text-secondary-600">
                      {exemples[col.index]?.length
                        ? exemples[col.index].map((v, i) => <div key={i} className="truncate max-w-xs">{v}</div>)
                        : <span className="text-secondary-400">(colonne vide)</span>}
                    </td>
                    <td className="py-2">
                      <label htmlFor={idSelect} className="sr-only">Champ pour la colonne {col.entete}</label>
                      <select
                        id={idSelect}
                        value={col.cible}
                        onChange={(e) => onCible(col.index, e.target.value)}
                        className={`w-full min-w-[14rem] px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          aFaire ? 'border-amber-400' : 'border-secondary-300'
                        }`}
                      >
                        <option value={CIBLE_A_CHOISIR}>— À choisir —</option>
                        <optgroup label="Champs de la fiche">
                          {CHAMPS.map((c) => <option key={c.cle} value={c.cle}>{c.libelle}</option>)}
                        </optgroup>
                        <optgroup label="Colonne qui remplit plusieurs champs">
                          {CIBLES_COMPOSEES.map((c) => <option key={c.cle} value={c.cle}>{c.libelle}</option>)}
                        </optgroup>
                        <optgroup label="Autre">
                          <option value={CIBLE_NOTES}>Ajouter aux notes</option>
                          <option value={CIBLE_IGNORER}>Ignorer</option>
                        </optgroup>
                      </select>
                      {conseil && (
                        <div className="mt-2 flex items-start justify-between gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                          <span className="flex items-start gap-1.5">
                            <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                            {conseil.message}
                          </span>
                          <button
                            type="button"
                            onClick={() => onCible(col.index, conseil.cible)}
                            className="shrink-0 px-2 py-0.5 bg-white text-secondary-700 border border-secondary-300 rounded-md hover:bg-secondary-50 transition-colors"
                          >
                            Séparer
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {aChoisir > 0 && (
        <p className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {aChoisir} colonne{aChoisir > 1 ? 's' : ''} à choisir ou à ignorer. Sans choix, {aChoisir > 1 ? 'elles seront ignorées' : 'elle sera ignorée'}.
          </span>
        </p>
      )}
      {erreurs.length > 0 && (
        <ul role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-1">
          {erreurs.map((e) => (
            <li key={e} className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onRetour}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-secondary-700 border border-secondary-300 rounded-lg hover:bg-secondary-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Changer de fichier
        </button>
        <button
          type="button"
          onClick={onSuite}
          disabled={erreurs.length > 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Voir l&apos;aperçu
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
