// src/apps/artisan/pages/settings/catalogue/ArticleDocuments.jsx
// Documents d'un article Majord'home : UNE liste — ceux posés sur l'article et ceux de ses lignes fournisseur, sans
// doublon (décision d'Eric, 2026-10-25 : « photo et fiche technique sont des métadonnées propres à l'article et pas au
// fournisseur »). Ajout sur l'article (org_admin) ; un document d'une ligne fournisseur se gère sur la ligne.
import { useState } from 'react';
import { FileText, Upload, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useCatalogItemDocuments } from '@hooks/useCatalogItems';
import { storageService } from '@services/storage.service';

const TYPES = ['Fiche technique', 'Notice', 'Certificat CE', 'Photo', 'Autre'];

/**
 * @param {{ orgId: string, itemId: string, offers: Array<{ product_id: string, supplier_name: string }>, canEdit: boolean }} p
 */
export default function ArticleDocuments({ orgId, itemId, offers, canEdit }) {
  const { user } = useAuth();
  const { documents, isLoading, upload, remove, isUploading, isRemoving } = useCatalogItemDocuments(orgId, itemId, offers.map((o) => o.product_id));
  const [type, setType] = useState('Fiche technique');
  const fournisseurDe = (doc) => offers.find((o) => o.product_id === doc.supplier_product_id)?.supplier_name;

  const ouvrir = async (doc) => {
    const { url, error } = await storageService.getSignedUrl('product-documents', doc.storage_path, 3600);
    if (error || !url) { toast.error('Document introuvable'); return; }
    window.open(url, '_blank', 'noopener');
  };
  const ajouter = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { await upload({ file, documentType: type, userId: user?.id || null }); toast.success('Document ajouté à l’article'); }
    catch (err) { toast.error(err?.message || 'Envoi refusé'); }
  };
  const retirer = async (doc) => {
    if (!window.confirm(`Retirer « ${doc.file_name} » de l’article ?`)) return;
    try { await remove(doc); toast.success('Document retiré'); } catch (err) { toast.error(err?.message || 'Retrait refusé'); }
  };

  return (
    <div className="space-y-2">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className="border border-secondary-300 rounded-md px-2 py-1 text-sm" aria-label="Type de document">
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="btn-secondary btn-sm cursor-pointer">
            {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Upload className="w-3.5 h-3.5 mr-1" />} Ajouter à l&apos;article
            <input type="file" accept=".pdf,.PDF,.png,.jpg,.jpeg,.webp" onChange={ajouter} className="hidden" />
          </label>
        </div>
      )}
      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-secondary-400" /></div>
      ) : documents.length === 0 ? (
        <p className="text-xs text-secondary-400">Aucun document. Les fiches techniques des fournisseurs et celles ajoutées ici s&apos;affichent ensemble.</p>
      ) : (
        <ul className="divide-y divide-secondary-100 border border-secondary-200 rounded-lg">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-3 py-2">
              <FileText className="w-4 h-4 text-secondary-400 flex-shrink-0" />
              <button type="button" onClick={() => ouvrir(d)} className="flex-1 min-w-0 text-left">
                <span className="text-sm text-secondary-900 break-words">{d.file_name}</span>
                <span className="block text-[11px] text-secondary-400">{d.document_type}{d.origine === 'fournisseur' ? ` · relevé ${fournisseurDe(d) || 'fournisseur'}` : ' · article'}</span>
              </button>
              <button type="button" onClick={() => ouvrir(d)} className="p-1 text-secondary-400 hover:text-primary-700" title="Ouvrir"><ExternalLink className="w-3.5 h-3.5" /></button>
              {canEdit && d.origine === 'article' && (
                <button type="button" onClick={() => retirer(d)} disabled={isRemoving} className="p-1 text-secondary-400 hover:text-red-600" title="Retirer de l'article"><Trash2 className="w-3.5 h-3.5" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
