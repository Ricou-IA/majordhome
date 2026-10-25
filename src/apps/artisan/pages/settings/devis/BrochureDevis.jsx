// src/apps/artisan/pages/settings/devis/BrochureDevis.jsx
// Brochure de l'entreprise jointe à la fin de chaque devis PDF (demande d'Eric, 2026-10-25). PDF déposé dans le
// bucket product-documents sous `${orgId}/devis/…` ; référence dans settings.devis.brochure = { storage_path, file_name }.
// Enregistrée tout de suite (sans passer par « Enregistrer le modèle ») : on repart de settings.devis TEL QU'ENREGISTRÉ
// (merge JSONB niveau 1 : l'objet devis complet est renvoyé).
import { useRef, useState } from 'react';
import { FileText, Upload, Trash2, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { storageService } from '@services/storage.service';

const BUCKET = 'product-documents';
const TAILLE_MAX = 20 * 1024 * 1024;

/**
 * @param {{ orgId: string, settings: object, save: (patch: object) => Promise<any>, brochure: { storage_path: string, file_name: string } | null }} p
 */
export default function BrochureDevis({ orgId, settings, save, brochure }) {
  const fileRef = useRef(null);
  const [enCours, setEnCours] = useState(false);
  const devisEnregistre = settings?.devis && typeof settings.devis === 'object' ? settings.devis : {};

  const deposer = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') { toast.error('La brochure doit être un PDF'); return; }
    if (file.size > TAILLE_MAX) { toast.error('Brochure trop lourde (20 Mo au plus)'); return; }
    setEnCours(true);
    const chemin = `${orgId}/devis/brochure-${crypto.randomUUID()}.pdf`;
    try {
      const { error } = await storageService.uploadFile(BUCKET, chemin, file, { contentType: 'application/pdf' });
      if (error) throw error;
      await save({ devis: { ...devisEnregistre, brochure: { storage_path: chemin, file_name: file.name } } });
      if (brochure?.storage_path) await storageService.deleteFile(BUCKET, brochure.storage_path);
      toast.success('Brochure enregistrée : elle sera jointe à chaque devis');
    } catch (err) {
      await storageService.deleteFile(BUCKET, chemin);
      toast.error(err?.message || 'Dépôt refusé');
    } finally { setEnCours(false); }
  };

  const retirer = async () => {
    if (!brochure || !window.confirm('Retirer la brochure ? Elle ne sera plus jointe aux devis.')) return;
    setEnCours(true);
    try {
      await save({ devis: { ...devisEnregistre, brochure: null } });
      await storageService.deleteFile(BUCKET, brochure.storage_path);
      toast.success('Brochure retirée');
    } catch (err) { toast.error(err?.message || 'Retrait refusé'); }
    finally { setEnCours(false); }
  };

  const ouvrir = async () => {
    const { url, error } = await storageService.getSignedUrl(BUCKET, brochure.storage_path, 300);
    if (error || !url) { toast.error('Brochure introuvable'); return; }
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="card space-y-2">
      <h3 className="text-sm font-semibold text-secondary-800">Annexes du devis</h3>
      <p className="text-xs text-secondary-500">
        Jointes à la fin du PDF : la fiche technique de chaque équipement (documents de l&apos;article), puis la brochure de l&apos;entreprise.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {brochure ? (
          <>
            <button type="button" onClick={ouvrir} className="inline-flex items-center gap-1.5 text-sm text-primary-700 hover:underline min-w-0">
              <FileText className="w-4 h-4 flex-shrink-0" /> <span className="truncate">{brochure.file_name}</span> <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </button>
            <button type="button" onClick={retirer} disabled={enCours} className="p-1 hover:bg-red-50 rounded" title="Retirer la brochure"><Trash2 className="w-4 h-4 text-red-500" /></button>
          </>
        ) : (
          <span className="text-sm text-secondary-400">Aucune brochure</span>
        )}
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={deposer} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={enCours} className="btn-secondary btn-sm ml-auto">
          {enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
          {brochure ? 'Remplacer' : 'Déposer la brochure (PDF)'}
        </button>
      </div>
    </div>
  );
}
