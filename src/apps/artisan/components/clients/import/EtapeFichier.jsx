/**
 * EtapeFichier.jsx - Import des clients, étape 1
 * Dépôt du fichier (clic ou glisser), fichier type, logiciel d'origine. La lecture est faite par la page.
 */

import { useRef, useState } from 'react';
import { Upload, Download, Loader2, AlertCircle } from 'lucide-react';

export default function EtapeFichier({ lecture, refus, sourceLabel, onSource, onFichier, onTelechargerType }) {
  const inputRef = useRef(null);
  const [survol, setSurvol] = useState(false);
  const enLecture = lecture === 'en_cours';

  const choisir = (fichiers) => {
    const f = fichiers?.[0];
    if (f) onFichier(f);
  };

  // Le glisser-déposer est intercepté sur toute l'étape : un fichier lâché à côté de la zone (ou pendant une
  // lecture) ne doit jamais être ouvert par le navigateur à la place de la page.
  const surDragOver = (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = enLecture ? 'none' : 'copy';
    if (!enLecture) setSurvol(true);
  };
  const surDrop = (e) => {
    e.preventDefault();
    setSurvol(false);
    if (!enLecture) choisir(e.dataTransfer?.files);
  };
  const surDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setSurvol(false);
  };

  return (
    <div className="space-y-6" onDragOver={surDragOver} onDrop={surDrop} onDragLeave={surDragLeave}>
      <div className="bg-white rounded-lg border border-secondary-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-secondary-900">Votre fichier de clients</h2>
        <p className="text-sm text-secondary-600">
          Déposez l&apos;export de votre ancien logiciel, au format Excel (.xlsx) ou CSV. Le fichier est lu dans votre
          navigateur : rien n&apos;est envoyé avant que vous ne lanciez l&apos;import.
        </p>

        <button
          type="button"
          aria-disabled={enLecture}
          onClick={() => { if (!enLecture) inputRef.current?.click(); }}
          className={`w-full flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            survol ? 'border-blue-500 bg-blue-50' : 'border-secondary-300 bg-secondary-50 hover:bg-secondary-100'
          } ${enLecture ? 'cursor-wait' : 'cursor-pointer'}`}
        >
          {enLecture ? (
            <>
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" aria-hidden="true" />
              <span className="text-sm font-medium text-secondary-700">Lecture du fichier…</span>
            </>
          ) : (
            <>
              <Upload className="w-8 h-8 text-secondary-400" aria-hidden="true" />
              <span className="text-sm font-medium text-secondary-700">Cliquez pour choisir un fichier, ou glissez-le ici</span>
              <span className="text-xs text-secondary-500">.xlsx ou .csv, 10 Mo et 10 000 lignes au plus</span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            choisir(e.target.files);
            e.target.value = ''; // redéposer le même fichier relance la lecture
          }}
        />

        {refus && (
          <p role="alert" className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{refus}</span>
          </p>
        )}

        <div>
          <label htmlFor="import-source" className="block text-sm font-medium text-secondary-700 mb-1">
            Logiciel d&apos;origine (facultatif)
          </label>
          <input
            id="import-source"
            type="text"
            value={sourceLabel}
            onChange={(e) => onSource(e.target.value)}
            maxLength={120}
            className="w-full max-w-md px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-secondary-500 mt-1">Il est noté avec l&apos;import pour le retrouver plus tard.</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-secondary-200 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="font-medium text-secondary-900">Pas d&apos;export sous la main ?</h3>
          <p className="text-sm text-secondary-600">
            Remplissez le fichier type : ses colonnes sont reconnues d&apos;office, sans rien à pointer.
          </p>
        </div>
        <button
          type="button"
          onClick={onTelechargerType}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-secondary-700 border border-secondary-300 rounded-lg hover:bg-secondary-50 transition-colors shadow-sm shrink-0"
        >
          <Download className="w-5 h-5" aria-hidden="true" />
          Télécharger le fichier type
        </button>
      </div>
    </div>
  );
}
