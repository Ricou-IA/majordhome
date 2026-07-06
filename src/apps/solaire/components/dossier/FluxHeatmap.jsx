// src/apps/solaire/components/dossier/FluxHeatmap.jsx
// Affiche l'image de flux persistée (heatmap Google Solar) via une signed URL Storage.
import { useEffect, useState } from 'react';
import { Sun } from 'lucide-react';
import { storageService } from '@services/storage.service';
import { logger } from '@lib/logger';

const BUCKET = 'product-documents';

export default function FluxHeatmap({ fluxImagePath }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!fluxImagePath) { setUrl(null); return undefined; }
    storageService.getSignedUrl(BUCKET, fluxImagePath)
      .then(({ url: signed, error }) => {
        if (error) throw error;
        if (!cancelled) setUrl(signed);
      })
      .catch((err) => logger.warn('[solaire] flux signed url', err));
    return () => { cancelled = true; };
  }, [fluxImagePath]);

  if (!fluxImagePath || !url) return null;
  return (
    <div className="card space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-secondary-800">
        <Sun className="w-4 h-4 text-[#F5C542]" /> Ensoleillement de la toiture
      </div>
      <img src={url} alt="Heatmap de flux solaire annuel" className="w-full rounded-lg border border-secondary-200" />
      <p className="text-xs text-secondary-500">Flux solaire annuel (source : Google Solar).</p>
    </div>
  );
}
