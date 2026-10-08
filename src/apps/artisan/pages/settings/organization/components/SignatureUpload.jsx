// src/apps/artisan/pages/settings/organization/components/SignatureUpload.jsx
// Image de signature (PNG) du signataire des mandats : upload org-scopé dans le bucket
// product-documents, aperçu via URL signée, suppression. Le chemin est porté par le
// formulaire parent (settings.signatory_signature_path) — « ne pas oublier d'Enregistrer ».
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, Trash2, Loader2 } from 'lucide-react';
import { storageService } from '@services/storage.service';

const BUCKET = 'product-documents';
const MAX_BYTES = 500 * 1024;

export default function SignatureUpload({ orgId, path, onChange }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) { setPreviewUrl(null); return undefined; }
    storageService.getSignedUrl(BUCKET, path).then(({ url, error }) => {
      if (!cancelled) setPreviewUrl(error ? null : url);
    });
    return () => { cancelled = true; };
  }, [path]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !orgId) return;
    if (file.type !== 'image/png') { toast.error('Seul le format PNG est accepté'); return; }
    if (file.size > MAX_BYTES) { toast.error('Image trop lourde (500 Ko maximum)'); return; }
    setBusy(true);
    const target = `${orgId}/branding/signature-mandat.png`;
    const { path: stored, error } = await storageService.uploadFile(BUCKET, target, file, { upsert: true, contentType: 'image/png' });
    setBusy(false);
    if (error || !stored) { toast.error(`Échec de l'upload : ${error?.message ?? 'erreur inconnue'}`); return; }
    onChange(stored);
    toast.success('Signature téléversée — ne pas oublier d’Enregistrer');
  };

  const handleDelete = async () => {
    if (!path) return;
    setBusy(true);
    const { error } = await storageService.deleteFile(BUCKET, path);
    setBusy(false);
    if (error) { toast.error(`Suppression impossible : ${error.message}`); return; }
    onChange('');
  };

  return (
    <div className="flex items-start gap-4 flex-wrap">
      <div className="w-48 h-20 border border-dashed border-secondary-300 rounded-md bg-white flex items-center justify-center overflow-hidden">
        {previewUrl ? <img src={previewUrl} alt="Signature du signataire" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-secondary-400">Aucune signature</span>}
      </div>
      <div className="flex flex-col gap-2">
        <input ref={fileRef} type="file" accept="image/png" className="hidden" onChange={handleUpload} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || !orgId} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {path ? 'Remplacer' : 'Téléverser'} (PNG)
        </button>
        {path && (
          <button type="button" onClick={handleDelete} disabled={busy} className="text-sm text-secondary-500 hover:text-secondary-800 flex items-center gap-1 disabled:opacity-50">
            <Trash2 className="w-4 h-4" /> Supprimer
          </button>
        )}
        <p className="text-xs text-secondary-500">Fond blanc ou transparent, 500 Ko maximum. Apposée sur les mandats générés.</p>
      </div>
    </div>
  );
}
