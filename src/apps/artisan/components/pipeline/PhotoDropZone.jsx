/**
 * PhotoDropZone.jsx - Majord'home Artisan
 * ============================================================================
 * Zone de drag-and-drop pour upload de photos.
 * Adapté de PhotoCapture.jsx avec support multi-fichiers et drag-and-drop.
 * ============================================================================
 */

import { useState, useRef, useCallback } from 'react';
import { Camera, Trash2, Loader2, Upload, X, ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * @param {Object} props
 * @param {string} props.category - Catégorie de la photo (facade, installation, etc.)
 * @param {string} props.label - Label affiché
 * @param {Array} props.photos - Photos existantes [{ id, signed_url, file_name, storage_path }]
 * @param {Function} props.onUpload - (files: File[]) => Promise
 * @param {Function} props.onDelete - (photoId, storagePath) => Promise
 * @param {boolean} props.disabled - Mode lecture seule
 * @param {number} props.maxFiles - Nombre max de photos (défaut 5)
 */
export function PhotoDropZone({
  category,
  label,
  photos = [],
  onUpload,
  onDelete,
  disabled = false,
  maxFiles = 5,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const inputRef = useRef(null);

  const isUploading = uploadingCount > 0;
  const canAddMore = photos.length < maxFiles && !disabled;

  // ========== DRAG & DROP ==========

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled || !onUpload) return;

    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/')
    );
    if (!files.length) return;

    const remaining = maxFiles - photos.length;
    const toUpload = files.slice(0, remaining);

    setUploadingCount(toUpload.length);
    try {
      await onUpload(toUpload);
    } catch (err) {
      console.error('[PhotoDropZone] Drop upload error:', err);
    } finally {
      setUploadingCount(0);
    }
  }, [disabled, onUpload, maxFiles, photos.length]);

  // ========== FILE INPUT ==========

  const handleFileChange = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !onUpload) return;

    const remaining = maxFiles - photos.length;
    const toUpload = files.slice(0, remaining);

    setUploadingCount(toUpload.length);
    try {
      await onUpload(toUpload);
    } catch (err) {
      console.error('[PhotoDropZone] File input upload error:', err);
    } finally {
      setUploadingCount(0);
    }

    // Reset input
    if (inputRef.current) inputRef.current.value = '';
  }, [onUpload, maxFiles, photos.length]);

  const handleClickAdd = () => {
    if (inputRef.current) inputRef.current.click();
  };

  // ========== DELETE ==========

  const handleDelete = useCallback(async (photo) => {
    if (!onDelete || disabled) return;
    try {
      await onDelete(photo.id, photo.storage_path);
    } catch (err) {
      console.error('[PhotoDropZone] Delete error:', err);
    }
  }, [onDelete, disabled]);

  // ========== RENDER ==========

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">{label}</label>

      {/* Grille de photos existantes */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group">
              <button
                type="button"
                onClick={() => setPreviewUrl(photo.signed_url)}
                className="w-full aspect-square rounded-lg border overflow-hidden bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <img
                  src={photo.signed_url}
                  alt={photo.file_name || label}
                  className="w-full h-full object-cover"
                />
              </button>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleDelete(photo)}
                  className="absolute top-1 right-1 h-7 w-7 flex items-center justify-center
                             bg-white/80 backdrop-blur-sm rounded-full shadow-sm
                             text-red-600 hover:text-red-700 hover:bg-white
                             opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}

          {/* Bouton ajouter (dans la grille) */}
          {canAddMore && (
            <button
              type="button"
              onClick={handleClickAdd}
              disabled={isUploading}
              className="w-full aspect-square rounded-lg border-2 border-dashed border-gray-300
                         flex flex-col items-center justify-center gap-1 text-gray-400
                         hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/50
                         transition-colors disabled:opacity-50"
            >
              {isUploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-xs">Ajouter</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Zone vide — drag and drop */}
      {photos.length === 0 && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={canAddMore ? handleClickAdd : undefined}
          className={`w-full rounded-lg border-2 border-dashed py-6 px-4
                      flex flex-col items-center justify-center gap-2 text-center
                      transition-colors cursor-pointer min-h-[100px]
                      ${isDragging
                        ? 'border-blue-500 bg-blue-50 text-blue-600'
                        : 'border-gray-300 bg-gray-50 text-gray-500 hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-600'
                      }
                      ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                      ${isUploading ? 'pointer-events-none' : ''}`}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Upload en cours...</span>
            </>
          ) : (
            <>
              <Upload className="h-6 w-6" />
              <span className="text-sm font-medium">
                Glisser-déposer ou cliquer
              </span>
              <span className="text-xs text-gray-400">
                {maxFiles} photo{maxFiles > 1 ? 's' : ''} max
              </span>
            </>
          )}
        </div>
      )}

      {/* Input fichier caché */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || isUploading}
      />

      {/* Preview plein écran */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() => setPreviewUrl(null)}
            className="absolute top-4 right-4 h-12 w-12 p-0 text-white hover:bg-white/20"
          >
            <X className="h-8 w-8" />
          </Button>
          <img
            src={previewUrl}
            alt={label}
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export default PhotoDropZone;
