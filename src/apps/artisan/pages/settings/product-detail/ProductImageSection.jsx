/**
 * ProductImageSection.jsx — Upload et preview de la photo produit
 * ============================================================================
 * - Drop zone drag&drop + input file
 * - Preview avec bouton supprimer
 * - Gère aussi les image_url externes (scrapées) avec badge "Image externe"
 * ============================================================================
 */

import { useRef, useState } from 'react';
import { Upload, Image as ImageIcon, Trash2, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useProductImageMutations } from '@hooks/useSuppliers';

export default function ProductImageSection({ product, orgId, supplierId }) {
  const { uploadImage, clearImage, isUploading, isClearing } = useProductImageMutations(
    orgId,
    product?.id,
    supplierId
  );
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const hasImage = !!product?.image_url;
  const isExternalImage = !!product?.image_source_url;

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Fichier non supporté — image requise');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image trop volumineuse (max 5 Mo)');
      return;
    }
    try {
      const result = await uploadImage(file);
      if (result?.error) throw result.error;
      toast.success('Photo mise à jour');
    } catch (err) {
      toast.error(err?.message || 'Erreur upload photo');
    }
  };

  const handleInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleClear = async () => {
    if (!window.confirm('Supprimer la photo du produit ?')) return;
    try {
      const result = await clearImage();
      if (result?.error) throw result.error;
      toast.success('Photo supprimée');
    } catch (err) {
      toast.error(err?.message || 'Erreur suppression');
    }
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleInputChange}
        className="hidden"
      />

      {hasImage ? (
        <div className="relative group">
          <div className="aspect-[4/3] rounded-lg overflow-hidden bg-secondary-50 border border-secondary-200">
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-contain"
              onError={(e) => {
                e.target.onerror = null;
                e.target.style.display = 'none';
              }}
            />
          </div>
          {isExternalImage && (
            <a
              href={product.image_source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-1 bg-black/60 text-white text-xs rounded backdrop-blur-sm hover:bg-black/80"
              title="Source de l'image"
            >
              <ExternalLink className="w-3 h-3" /> Source
            </a>
          )}
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="p-2 bg-white/90 hover:bg-white rounded-lg shadow-sm border border-secondary-200"
              title="Remplacer"
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 text-secondary-600" />}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={isClearing}
              className="p-2 bg-white/90 hover:bg-red-50 rounded-lg shadow-sm border border-secondary-200"
              title="Supprimer"
            >
              {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 text-red-500" />}
            </button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`aspect-[4/3] rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-primary-400 bg-primary-50'
              : 'border-secondary-300 bg-secondary-50 hover:bg-secondary-100'
          }`}
        >
          {isUploading ? (
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
          ) : (
            <>
              <ImageIcon className="w-10 h-10 text-secondary-300 mb-2" />
              <p className="text-sm font-medium text-secondary-600">Cliquer ou glisser une image</p>
              <p className="text-xs text-secondary-400 mt-1">JPG, PNG, WebP — max 5 Mo</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
