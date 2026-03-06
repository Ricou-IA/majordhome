/**
 * PhotoCapture.jsx - Majord'home Artisan
 * ============================================================================
 * Composant de capture photo pour tablette terrain.
 * Utilise input[type=file][capture=environment] pour ouvrir la caméra arrière.
 * Preview, upload vers Storage, suppression.
 *
 * @version 1.0.0 - Sprint 3 Outil Terrain Tablette
 * ============================================================================
 */

import { useState, useRef } from 'react';
import { Camera, Trash2, Loader2, Image as ImageIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * @param {Object} props
 * @param {string} props.label - Label du champ (ex: "Photo avant", "Photo après")
 * @param {string|null} props.currentUrl - URL signée de la photo existante
 * @param {string|null} props.currentPath - Chemin Storage de la photo existante
 * @param {Function} props.onUpload - (file: File) => Promise<{ path, url }>
 * @param {Function} props.onDelete - (path: string) => Promise
 * @param {boolean} props.disabled - Désactiver le composant
 * @param {boolean} props.isUploading - Loading upload
 */
export function PhotoCapture({
  label = 'Photo',
  currentUrl = null,
  currentPath = null,
  onUpload,
  onDelete,
  disabled = false,
  isUploading = false,
}) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const inputRef = useRef(null);

  // Déclencher la capture
  const handleCapture = () => {
    if (inputRef.current) {
      inputRef.current.click();
    }
  };

  // Fichier sélectionné
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;

    // Preview locale immédiate
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);

    try {
      await onUpload(file);
    } catch (err) {
      console.error('[PhotoCapture] Upload error:', err);
      // Reset preview si erreur
      setPreviewUrl(null);
    }

    // Reset l'input pour permettre une nouvelle capture
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  // Supprimer la photo
  const handleDelete = async () => {
    if (!onDelete || !currentPath) return;

    try {
      await onDelete(currentPath);
      setPreviewUrl(null);
    } catch (err) {
      console.error('[PhotoCapture] Delete error:', err);
    }
  };

  // URL à afficher (locale ou signée)
  const displayUrl = previewUrl || currentUrl;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">{label}</label>

      {/* Zone d'affichage / capture */}
      {displayUrl ? (
        <div className="relative">
          {/* Thumbnail cliquable */}
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="w-full aspect-[4/3] rounded-lg border overflow-hidden bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <img
              src={displayUrl}
              alt={label}
              className="w-full h-full object-cover"
            />
          </button>

          {/* Boutons d'action */}
          {!disabled && (
            <div className="absolute top-2 right-2 flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCapture}
                disabled={isUploading}
                className="h-9 w-9 p-0 bg-white/80 backdrop-blur-sm shadow-sm"
              >
                <Camera className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={isUploading}
                className="h-9 w-9 p-0 bg-white/80 backdrop-blur-sm shadow-sm text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Overlay loading */}
          {isUploading && (
            <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded-lg">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          )}
        </div>
      ) : (
        // Zone vide — bouton de capture
        <button
          type="button"
          onClick={handleCapture}
          disabled={disabled || isUploading}
          className="w-full aspect-[4/3] rounded-lg border-2 border-dashed border-gray-300 bg-gray-50
                     flex flex-col items-center justify-center gap-2 text-gray-500
                     hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600
                     active:bg-blue-100
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors min-h-[120px]"
        >
          {isUploading ? (
            <Loader2 className="h-8 w-8 animate-spin" />
          ) : (
            <>
              <Camera className="h-8 w-8" />
              <span className="text-sm font-medium">Prendre une photo</span>
            </>
          )}
        </button>
      )}

      {/* Input caméra caché */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || isUploading}
      />

      {/* Preview plein écran */}
      {showPreview && displayUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setShowPreview(false)}
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowPreview(false)}
            className="absolute top-4 right-4 h-12 w-12 p-0 text-white hover:bg-white/20"
          >
            <X className="h-8 w-8" />
          </Button>
          <img
            src={displayUrl}
            alt={label}
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export default PhotoCapture;
