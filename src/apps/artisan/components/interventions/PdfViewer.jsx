/**
 * PdfViewer.jsx - Majord'home Artisan
 * ============================================================================
 * Viewer PDF intégré (iframe) depuis une URL Storage signée.
 * États loading, erreur, bouton télécharger.
 *
 * @version 1.0.0 - Sprint 3 Outil Terrain Tablette
 * ============================================================================
 */

import { useState } from 'react';
import { FileText, Download, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * @param {Object} props
 * @param {string|null} props.pdfUrl - URL signée du PDF
 * @param {boolean} props.isLoading - Chargement en cours
 * @param {string|null} props.error - Message d'erreur
 */
export function PdfViewer({
  pdfUrl = null,
  isLoading = false,
  error = null,
}) {
  const [iframeError, setIframeError] = useState(false);

  // État : chargement
  if (isLoading) {
    return (
      <div className="w-full aspect-[3/4] rounded-lg border bg-gray-50 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
        <p className="text-sm text-gray-600">Génération du PV en cours...</p>
      </div>
    );
  }

  // État : erreur
  if (error) {
    return (
      <div className="w-full aspect-[3/4] rounded-lg border bg-red-50 flex flex-col items-center justify-center gap-3 p-4">
        <AlertCircle className="h-10 w-10 text-red-500" />
        <p className="text-sm text-red-700 text-center">{error}</p>
      </div>
    );
  }

  // État : pas de PDF
  if (!pdfUrl) {
    return (
      <div className="w-full aspect-[3/4] rounded-lg border-2 border-dashed bg-gray-50 flex flex-col items-center justify-center gap-3">
        <FileText className="h-10 w-10 text-gray-400" />
        <p className="text-sm text-gray-500">Aucun PV généré</p>
        <p className="text-xs text-gray-400">
          Cliquez sur "Générer le PV" une fois le rapport complété
        </p>
      </div>
    );
  }

  // État : PDF disponible
  return (
    <div className="space-y-2">
      {/* Bouton télécharger */}
      <div className="flex justify-end">
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          download
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] text-base gap-2"
          >
            <Download className="h-4 w-4" />
            Télécharger le PV
          </Button>
        </a>
      </div>

      {/* iframe PDF */}
      {!iframeError ? (
        <iframe
          src={pdfUrl}
          title="PV d'intervention"
          className="w-full aspect-[3/4] rounded-lg border"
          onError={() => setIframeError(true)}
        />
      ) : (
        <div className="w-full aspect-[3/4] rounded-lg border bg-gray-50 flex flex-col items-center justify-center gap-3">
          <FileText className="h-10 w-10 text-gray-400" />
          <p className="text-sm text-gray-500">
            Impossible d'afficher le PDF dans le navigateur
          </p>
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download>
            <Button type="button" className="min-h-[44px] text-base gap-2">
              <Download className="h-4 w-4" />
              Ouvrir le PDF
            </Button>
          </a>
        </div>
      )}
    </div>
  );
}

export default PdfViewer;
