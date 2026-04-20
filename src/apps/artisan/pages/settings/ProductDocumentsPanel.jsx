/**
 * ProductDocumentsPanel.jsx - Majord'home Artisan
 * ============================================================================
 * Slide-over pour gérer les documents (manuels, fiches techniques) d'un produit.
 * Upload, liste avec téléchargement, suppression.
 * ============================================================================
 */

import { useState } from 'react';
import { X, Upload, FileText, Trash2, Loader2, Download, AlertCircle } from 'lucide-react';
import { useProductDocuments, useProductDocumentMutations } from '@hooks/useSuppliers';
import { storageService } from '@services/storage.service';
import { useAuth } from '@contexts/AuthContext';
import { toast } from 'sonner';

const DOC_TYPE_SUGGESTIONS = [
  'Manuel',
  'Fiche technique',
  'Notice d\'installation',
  'Schéma',
  'Certificat CE',
  'Guide dépannage',
];

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Variante inline (sans wrapper drawer) pour intégration dans un tab.
 */
export function ProductDocumentsInline({ productId, orgId }) {
  const { user } = useAuth();
  const { documents, isLoading } = useProductDocuments(productId);
  const { uploadDocument, deleteDocument, isUploading, isDeleting } = useProductDocumentMutations(orgId, productId);
  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState('Manuel');
  const [deletingId, setDeletingId] = useState(null);

  const handleUpload = async () => {
    if (!file) return;
    try {
      const { error } = await uploadDocument({ file, documentType: documentType || 'Manuel', userId: user?.id });
      if (error) throw error;
      toast.success('Document ajouté');
      setFile(null);
      setDocumentType('Manuel');
    } catch (err) {
      console.error('[ProductDocumentsInline] upload error:', err);
      toast.error('Erreur lors de l\'upload');
    }
  };

  const handleDelete = async (doc) => {
    setDeletingId(doc.id);
    try {
      const { error } = await deleteDocument({ documentId: doc.id, storagePath: doc.storage_path });
      if (error) throw error;
      toast.success('Document supprimé');
    } catch (err) {
      console.error('[ProductDocumentsInline] delete error:', err);
      toast.error('Erreur lors de la suppression');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (doc) => {
    try {
      const { url, error } = await storageService.getSignedUrl('product-documents', doc.storage_path, 3600);
      if (error) throw error;
      window.open(url, '_blank');
    } catch (err) {
      console.error('[ProductDocumentsInline] download error:', err);
      toast.error('Erreur lors du téléchargement');
    }
  };

  return (
    <div className="space-y-3">
      {/* Upload */}
      <div className="border border-dashed border-secondary-300 rounded-lg p-3 space-y-2 bg-secondary-50">
        <div className="flex gap-2">
          <input
            type="text"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            list="doc-type-suggestions-inline"
            placeholder="Type (ex: Fiche technique)"
            className="flex-1 px-3 py-2 text-sm bg-white border border-secondary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
          <datalist id="doc-type-suggestions-inline">
            {DOC_TYPE_SUGGESTIONS.map(t => <option key={t} value={t} />)}
          </datalist>
          <label className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-secondary-300 rounded-lg cursor-pointer hover:bg-secondary-100">
            <Upload className="w-4 h-4 text-secondary-500" />
            <span className="truncate text-secondary-700 max-w-[160px]">{file ? file.name : 'Fichier'}</span>
            <input type="file" accept=".pdf,.PDF,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" />
          </label>
          <button
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="btn-primary btn-sm"
          >
            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ajouter'}
          </button>
        </div>
      </div>

      {/* Liste */}
      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-secondary-400" /></div>
      ) : documents.length === 0 ? (
        <div className="text-center py-8 text-sm text-secondary-400 bg-secondary-50 rounded-lg">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
          Aucun document. Ajoute manuels, fiches techniques, certificats CE...
        </div>
      ) : (
        <div className="space-y-1.5">
          {documents.map(doc => (
            <div key={doc.id} className="flex items-center gap-3 p-2.5 bg-white border border-secondary-200 rounded-lg">
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-secondary-900 truncate">{doc.file_name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium bg-secondary-100 text-secondary-600 rounded">{doc.document_type}</span>
                  {doc.file_size && <span className="text-xs text-secondary-400">{formatFileSize(doc.file_size)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleDownload(doc)} className="p-1.5 text-secondary-400 hover:text-primary-600 hover:bg-primary-50 rounded" title="Télécharger">
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(doc)}
                  disabled={isDeleting && deletingId === doc.id}
                  className="p-1.5 text-secondary-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                  title="Supprimer"
                >
                  {isDeleting && deletingId === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProductDocumentsPanel({ isOpen, onClose, productId, productName, orgId }) {
  const { user } = useAuth();
  const { documents, isLoading } = useProductDocuments(productId);
  const { uploadDocument, deleteDocument, isUploading, isDeleting } = useProductDocumentMutations(orgId, productId);

  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState('Manuel');
  const [deletingId, setDeletingId] = useState(null);

  const handleUpload = async () => {
    if (!file) return;
    try {
      const { error } = await uploadDocument({
        file,
        documentType: documentType || 'Manuel',
        userId: user?.id,
      });
      if (error) throw error;
      toast.success('Document ajouté');
      setFile(null);
      setDocumentType('Manuel');
    } catch (err) {
      console.error('[ProductDocumentsPanel] upload error:', err);
      toast.error('Erreur lors de l\'upload');
    }
  };

  const handleDelete = async (doc) => {
    setDeletingId(doc.id);
    try {
      const { error } = await deleteDocument({ documentId: doc.id, storagePath: doc.storage_path });
      if (error) throw error;
      toast.success('Document supprimé');
    } catch (err) {
      console.error('[ProductDocumentsPanel] delete error:', err);
      toast.error('Erreur lors de la suppression');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (doc) => {
    try {
      const { url, error } = await storageService.getSignedUrl('product-documents', doc.storage_path, 3600);
      if (error) throw error;
      window.open(url, '_blank');
    } catch (err) {
      console.error('[ProductDocumentsPanel] download error:', err);
      toast.error('Erreur lors du téléchargement');
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">Documentation</h2>
              <p className="text-sm text-gray-500 truncate">{productName || 'Produit'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Upload section */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 space-y-3">
          <p className="text-sm font-medium text-gray-700">Ajouter un document</p>

          <div className="flex gap-2">
            <input
              type="text"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              list="doc-type-suggestions"
              placeholder="Type de document"
              className="flex-1 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
            <datalist id="doc-type-suggestions">
              {DOC_TYPE_SUGGESTIONS.map(t => <option key={t} value={t} />)}
            </datalist>
          </div>

          <div className="flex gap-2">
            <label className="flex-1 flex items-center gap-2 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
              <Upload className="w-4 h-4 text-gray-400" />
              <span className="truncate text-gray-600">
                {file ? file.name : 'Choisir un fichier...'}
              </span>
              <input
                type="file"
                accept=".pdf,.PDF,.png,.jpg,.jpeg,.webp"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
            <button
              onClick={handleUpload}
              disabled={!file || isUploading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Ajouter
            </button>
          </div>
        </div>

        {/* Document list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <FileText className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-gray-500 text-sm">Aucun document</p>
              <p className="text-gray-400 text-xs mt-1">Ajoutez des manuels et fiches techniques</p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map(doc => (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:shadow-sm transition-shadow"
                >
                  <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-red-500" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{doc.file_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">
                        {doc.document_type}
                      </span>
                      {doc.file_size && (
                        <span className="text-xs text-gray-400">{formatFileSize(doc.file_size)}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDownload(doc)}
                      className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      title="Télécharger"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(doc)}
                      disabled={isDeleting && deletingId === doc.id}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      title="Supprimer"
                    >
                      {isDeleting && deletingId === doc.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default ProductDocumentsPanel;
