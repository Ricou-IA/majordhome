/**
 * EtapeApercu.jsx - Import des clients, étape 3
 * Ce qui sera importé, les doublons (repris ou écartés au choix) et les lignes écartées, avant toute écriture.
 */

import { useMemo } from 'react';
import { ArrowLeft, Download, Loader2, AlertCircle, RefreshCw, Upload } from 'lucide-react';
import { ListePretes, ListeDoublons, ListeEcartees } from './ListeLignes';

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
  classees, bilan, existants, choix, enCours, libelleRetour,
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

  const n = bilan?.importees ?? 0;
  const nonImportees = bilan ? bilan.doublons_ecartes + bilan.ecartees : 0;

  return (
    <div className="space-y-6">
      {!classees && !existants.error && (
        <p className="flex items-center gap-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-4 py-3">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" aria-hidden="true" />
          Lecture de vos clients existants…
        </p>
      )}
      {!classees && existants.error && (
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
            <p className="text-sm text-gray-700">
              {pluriel(bilan.lues, 'ligne lue', 'lignes lues')} = {bilan.importees} à importer
              + {pluriel(bilan.doublons_ecartes, 'doublon écarté', 'doublons écartés')}
              + {pluriel(bilan.ecartees, 'écartée', 'écartées')}
            </p>
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
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="w-4 h-4" aria-hidden="true" />
          Importer {pluriel(n, 'client', 'clients')}
        </button>
      </div>
    </div>
  );
}
