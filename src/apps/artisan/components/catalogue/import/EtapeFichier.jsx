/**
 * EtapeFichier.jsx - Import d'articles, étape 1
 * Dépôt du fichier (clic ou glisser) et fichier type. La lecture est faite par la page.
 */

import { useRef, useState } from 'react';
import { Upload, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LIMITES_TEXTE } from '@/lib/importClients/lireFichier';
import { Encadre } from './Encadres';

export default function EtapeFichier({ lecture, refus, onFichier, onTelechargerType }) {
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
      <Card className="p-6 space-y-4">
        <h2 className="font-display text-section text-secondary-900">Votre fichier d&apos;articles</h2>
        <p className="text-sm text-secondary-600">
          Déposez l&apos;export de votre ancien logiciel ou votre tarif, au format Excel (.xlsx) ou CSV. Les prix du fichier
          sont lus hors taxe. Le fichier est lu dans votre navigateur : rien n&apos;est envoyé avant que vous ne lanciez l&apos;import.
        </p>

        <button
          type="button"
          aria-disabled={enLecture}
          onClick={() => { if (!enLecture) inputRef.current?.click(); }}
          className={`w-full flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
            survol ? 'border-primary-500 bg-primary-50' : 'border-secondary-300 bg-secondary-50 hover:bg-secondary-100'
          } ${enLecture ? 'cursor-wait' : 'cursor-pointer'}`}
        >
          {enLecture ? (
            <>
              <Loader2 className="w-8 h-8 text-primary-600 animate-spin" aria-hidden="true" />
              <span className="text-sm font-medium text-secondary-700">Lecture du fichier en cours</span>
            </>
          ) : (
            <>
              <Upload className="w-8 h-8 text-secondary-400" aria-hidden="true" />
              <span className="text-sm font-medium text-secondary-700">Cliquez pour choisir un fichier, ou glissez-le ici</span>
              <span className="text-xs text-secondary-500">.xlsx ou .csv, {LIMITES_TEXTE.octets} et {LIMITES_TEXTE.lignes} au plus</span>
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

        {refus && <Encadre ton="alerte" role="alert">{refus}</Encadre>}
      </Card>

      <Card className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="font-medium text-secondary-900">Pas d&apos;export sous la main ?</h3>
          <p className="text-sm text-secondary-600">
            Remplissez le fichier type : ses colonnes sont reconnues d&apos;office, sans rien à pointer.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={onTelechargerType} className="shrink-0">
          <Download aria-hidden="true" />
          Télécharger le fichier type
        </Button>
      </Card>
    </div>
  );
}
