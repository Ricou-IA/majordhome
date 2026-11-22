/**
 * EtapeApercu.jsx - Import des clients, étape 3
 * Ce qui sera importé, les doublons (repris ou écartés au choix) et les lignes écartées, avant toute écriture.
 */

import { useMemo } from 'react';
import { ArrowLeft, Download, Loader2, AlertCircle, RefreshCw, Upload, Info } from 'lucide-react';
import { ListePretes, ListeDoublons, ListeEcartees } from './ListeLignes';
import { phraseBilan, texteCorrections, texteSansCodePostal } from '@/lib/importClients/libelles';
import { resumeCorrections, fichesSansCodePostal } from '@/lib/importClients/controles';

const DOUBLONS = new Set(['doublon_fort', 'doublon_faible', 'doublon_fichier']);
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

function Compteur({ libelle, valeur }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
      <p className="text-2xl font-semibold text-gray-900">{valeur}</p>
      <p className="text-sm text-gray-600">{libelle}</p>
    </div>
  );
}

export default function EtapeApercu({
  classees, bilan, existants, choix, enCours, libelleRetour, avis,
  onRelire, onImporter, onEcarter, onTelechargerEcartees, onRetour, onLancer,
}) {
  const groupes = useMemo(() => {
    if (!classees) return null;
    return {
      pretes: classees.filter((l) => l.statut === 'prete'),
      doublons: classees.filter((l) => DOUBLONS.has(l.statut)),
      ecartees: classees.filter((l) => l.statut === 'ecartee'),
    };
  }, [classees]);

  // Valeurs illisibles des lignes qui seront importées : dites avant l'écriture, pas seulement dans les notes.
  const corrections = useMemo(() => (classees ? texteCorrections(resumeCorrections(classees, choix)) : null), [classees, choix]);
  const sansCodePostal = useMemo(() => (classees ? texteSansCodePostal(fichesSansCodePostal(classees, choix)) : null), [classees, choix]);

  const n = bilan?.importees ?? 0;
  // Une relecture en cours prime sur l'erreur précédente (react-query la garde pendant la relecture).
  const enErreur = !classees && !existants.isLoading && !!existants.error;
  const nonImportees = bilan ? bilan.doublons_ecartes + bilan.ecartees : 0;

  return (
    <div className="space-y-6">
      {avis && (
        <p role="status" className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          {avis}
        </p>
      )}
      {!classees && !enErreur && (
        <p className="flex items-center gap-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-4 py-3">
          <Loader2 className="w-4 h-4 animate-spin text-primary-700" aria-hidden="true" />
          Lecture de vos clients existants…
        </p>
      )}
      {enErreur && (
        <div role="alert" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            Vos clients existants n&apos;ont pas pu être lus : l&apos;import est fermé pour ne pas créer de doublons.
          </p>
          <button
            type="button"
            onClick={onRelire}
            className="inline-flex items-center gap-2 px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 shrink-0"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Réessayer
          </button>
        </div>
      )}

      {groupes && bilan && (
        <>
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Compteur libelle="lignes lues" valeur={bilan.lues} />
              <Compteur libelle="à importer" valeur={bilan.importees} />
              <Compteur libelle="doublons écartés" valeur={bilan.doublons_ecartes} />
              <Compteur libelle="écartées" valeur={bilan.ecartees} />
            </div>
            <p className="text-sm text-gray-700">{phraseBilan(bilan)}</p>
            {corrections && (
              <p className="flex items-start gap-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-4 py-3">
                <Info className="w-4 h-4 mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
                {corrections}
              </p>
            )}
            {sansCodePostal && (
              <p className="flex items-start gap-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-4 py-3">
                <Info className="w-4 h-4 mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
                {sansCodePostal}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <ListePretes lignes={groupes.pretes} />
            <ListeDoublons lignes={groupes.doublons} choix={choix} onImporter={onImporter} onEcarter={onEcarter} />
            <ListeEcartees lignes={groupes.ecartees} />
          </div>

          {nonImportees > 0 && (
            <button
              type="button"
              onClick={onTelechargerEcartees}
              className="inline-flex items-center gap-2 text-sm text-blue-700 underline"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              Télécharger les lignes écartées
            </button>
          )}
        </>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onRetour}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {libelleRetour}
        </button>
        <button
          type="button"
          onClick={onLancer}
          disabled={!classees || n === 0 || enCours}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-700 text-white rounded-lg hover:bg-primary-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="w-4 h-4" aria-hidden="true" />
          {bilan ? `Importer ${pluriel(n, 'client', 'clients')}` : 'Importer'}
        </button>
      </div>
    </div>
  );
}
