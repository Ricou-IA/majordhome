/**
 * ProductImagesField — photos d'un produit : dépôt (glisser / parcourir), ordre, principale.
 * L'envoi est immédiat (Storage) ; l'URL n'entre dans le produit qu'à l'enregistrement du drawer.
 */
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, ChevronLeft, ChevronRight, Star, X, Loader2, ImageOff } from 'lucide-react';
import { webshopProductsService } from '@services/webshopProducts.service';
import { checkImageFile, resolveImageUrl } from '@/lib/webshop/catalog';

export default function ProductImagesField({ images, onChange, orgId, productId, siteUrl, disabled }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    const accepted = [];
    for (const f of files) {
      const err = checkImageFile(f);
      if (err) toast.error(`${f.name} : ${err}`);
      else accepted.push(f);
    }
    if (accepted.length === 0) return;
    setUploading((n) => n + accepted.length);
    const urls = [];
    for (const f of accepted) {
      const { data, error } = await webshopProductsService.uploadImage(orgId, productId, f);
      if (error) toast.error(`${f.name} : envoi impossible (${error.message})`);
      else urls.push(data);
      setUploading((n) => n - 1);
    }
    if (urls.length) onChange([...images, ...urls]);
  };

  const move = (i, delta) => {
    const next = [...images];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item);
    onChange(next);
  };
  const makeMain = (i) => onChange([images[i], ...images.filter((_, j) => j !== i)]);
  const remove = (i) => onChange(images.filter((_, j) => j !== i));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {images.map((url, i) => {
          const src = resolveImageUrl(url, siteUrl);
          return (
            <div key={url} className="relative group aspect-square rounded-lg border border-secondary-200 bg-secondary-50 overflow-hidden">
              {src ? (
                <img src={src} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-secondary-400 text-[10px] p-1 text-center">
                  <ImageOff className="w-5 h-5 mb-1" /> Aperçu indisponible
                </div>
              )}
              {i === 0 && (
                <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-primary-600 text-white text-[10px] font-medium">Principale</span>
              )}
              {!disabled && (
                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-white disabled:opacity-30" aria-label="Avancer"><ChevronLeft className="w-4 h-4" /></button>
                  {i !== 0 && (
                    <button type="button" onClick={() => makeMain(i)} className="p-1 text-white" aria-label="Mettre en principale" title="Mettre en principale"><Star className="w-4 h-4" /></button>
                  )}
                  <button type="button" onClick={() => remove(i)} className="p-1 text-white" aria-label="Retirer" title="Retirer"><X className="w-4 h-4" /></button>
                  <button type="button" disabled={i === images.length - 1} onClick={() => move(i, 1)} className="p-1 text-white disabled:opacity-30" aria-label="Reculer"><ChevronRight className="w-4 h-4" /></button>
                </div>
              )}
            </div>
          );
        })}
        {Array.from({ length: uploading }).map((_, i) => (
          <div key={`up-${i}`} className="aspect-square rounded-lg border border-dashed border-secondary-300 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-secondary-400" />
          </div>
        ))}
      </div>
      {images.length === 0 && disabled && <p className="text-sm text-secondary-400">Aucune photo.</p>}
      {!disabled && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed py-5 cursor-pointer text-sm transition-colors ${
            dragOver ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-secondary-200 text-secondary-500 hover:border-secondary-300'
          }`}
        >
          <ImagePlus className="w-5 h-5" />
          <span>Glisser des photos ici ou <span className="text-primary-600 font-medium">parcourir</span></span>
          <span className="text-xs text-secondary-400">JPEG, PNG ou WebP · 8 Mo max · la première est la photo principale</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
        </div>
      )}
    </div>
  );
}
