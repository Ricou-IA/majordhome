/**
 * EquipmentDocumentsSection.jsx — « Documents » d'une carte équipement
 * ============================================================================
 * Deux sources dans une seule liste :
 *   - les documents du MODÈLE (notice technique, vue éclatée, autre) : table
 *     majordhome.equipment_documents, partagés par marque + modèle dans l'org —
 *     déposés ici, visibles sur tous les équipements identiques ;
 *   - la documentation de la ligne fournisseur liée (product_documents), en
 *     lecture seule (elle se gère sur la fiche fournisseur).
 * Ouverture = URL signée dans un nouvel onglet (usage tablette chez le client).
 * Sans marque ni modèle : pas de dépôt possible, on dit pourquoi.
 * Présentationnel : les mutations sont passées par le parent (onUpload / onDelete).
 * ============================================================================
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { FileText, BookOpen, Layers, Upload, Trash2, Loader2, X, Download } from 'lucide-react';
import { storageService } from '@services/storage.service';
import {
  EQUIPMENT_DOCUMENT_BUCKET, EQUIPMENT_DOCUMENT_TYPES, equipmentDocumentTypeLabel, equipmentHasModel,
} from '@services/equipmentDocuments.service';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { MODAL_PANEL_PHONE, MODAL_FOOTER_PHONE } from '@/lib/modalClasses';

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
const MAX_SIZE = 20 * 1024 * 1024; // limite du bucket product-documents

const TYPE_ICON = { notice: BookOpen, vue_eclatee: Layers, autre: FileText };

async function ouvrir(doc) {
  const { url, error } = await storageService.getSignedUrl(EQUIPMENT_DOCUMENT_BUCKET, doc.storage_path, 3600);
  if (error || !url) { toast.error('Le document n\'a pas pu être ouvert'); return; }
  window.open(url, '_blank', 'noopener');
}

function DocumentRow({ doc, badge, canDelete, onDelete }) {
  const Icon = TYPE_ICON[doc.document_type] || FileText;
  const titre = doc.label || equipmentDocumentTypeLabel(doc.document_type);
  return (
    <div className="flex items-center gap-2 rounded-lg hover:bg-gray-50 group">
      <button
        type="button"
        onClick={() => ouvrir(doc)}
        className="flex-1 min-w-0 flex items-center gap-2.5 p-2 text-left"
        title={doc.file_name}
      >
        <Icon className="w-4 h-4 text-indigo-500 flex-shrink-0" />
        <span className="text-sm text-gray-800 group-hover:text-indigo-700 truncate">{titre}</span>
        {badge && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">{badge}</span>}
        <Download className="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-500 flex-shrink-0 ml-auto" />
      </button>
      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete(doc)}
          className="p-1.5 mr-1 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded"
          title="Retirer ce document (pour tous les équipements de ce modèle)"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/** Modale de dépôt : fichier + type + libellé facultatif. */
function UploadModal({ equipment, onClose, onSubmit, isSubmitting }) {
  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState('notice');
  const [label, setLabel] = useState('');
  const modele = `${equipment.brand} ${equipment.model}`.trim();

  const handleFile = (e) => {
    const f = e.target.files?.[0] || null;
    if (f && f.size > MAX_SIZE) { toast.error('Fichier trop lourd (20 Mo maximum)'); e.target.value = ''; return; }
    setFile(f);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    await onSubmit({ file, documentType, label });
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[80]" onClick={isSubmitting ? undefined : onClose} />
      <form
        onSubmit={submit}
        className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[90] w-full max-w-md bg-white rounded-xl shadow-xl flex flex-col ${MODAL_PANEL_PHONE} max-sm:translate-x-0 max-sm:translate-y-0 max-sm:left-0 max-sm:top-0`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="font-semibold text-gray-900">Déposer un document</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Pour le modèle <span className="font-medium text-gray-700">{modele}</span> — visible sur tous les équipements identiques.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 flex-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Type de document</label>
            <div className="flex flex-wrap gap-2">
              {EQUIPMENT_DOCUMENT_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setDocumentType(t.value)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${documentType === t.value
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Fichier <span className="text-gray-400 font-normal">(PDF ou image, 20 Mo max)</span></label>
            <input
              type="file"
              accept={ACCEPT}
              onChange={handleFile}
              className="block w-full text-sm text-gray-700 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Libellé <span className="text-gray-400 font-normal">(facultatif)</span></label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder={documentType === 'notice' ? 'ex. Notice d\'installation 2019' : documentType === 'vue_eclatee' ? 'ex. Vue éclatée corps de chauffe' : 'ex. Schéma électrique'}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        <div className={`flex items-center justify-end gap-3 px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl ${MODAL_FOOTER_PHONE}`}>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
            Annuler
          </button>
          <button
            type="submit"
            disabled={!file || isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Déposer
          </button>
        </div>
      </form>
    </>
  );
}

/**
 * @param {Object} props
 * @param {Object} props.equipment
 * @param {Array} [props.modelDocuments] - documents du modèle (equipment_documents) pour cet équipement
 * @param {Array} [props.productDocuments] - documentation de la ligne fournisseur liée (lecture seule)
 * @param {boolean} [props.canUpload] - droit clients.edit
 * @param {boolean} [props.canDelete] - org_admin
 * @param {Function} [props.onUpload] - (equipment, { file, documentType, label }) => Promise
 * @param {Function} [props.onDelete] - (doc) => Promise
 */
export function EquipmentDocumentsSection({
  equipment,
  modelDocuments = [],
  productDocuments = [],
  canUpload = false,
  canDelete = false,
  onUpload,
  onDelete,
}) {
  const [uploading, setUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const hasModel = equipmentHasModel(equipment);
  const total = modelDocuments.length + productDocuments.length;
  const showUpload = canUpload && !!onUpload;
  if (total === 0 && !showUpload) return null;

  const submitUpload = async (payload) => {
    setIsSubmitting(true);
    try {
      await onUpload(equipment, payload);
      toast.success('Document déposé — visible sur tous les équipements de ce modèle');
      setUploading(false);
    } catch (err) {
      console.error('[EquipmentDocumentsSection] upload:', err);
      toast.error(err?.message?.includes('model_required')
        ? 'Renseignez la marque et le modèle de l\'équipement avant de déposer un document'
        : 'Le document n\'a pas pu être déposé');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      await onDelete(deleting);
      toast.success('Document retiré');
      setDeleting(null);
    } catch (err) {
      console.error('[EquipmentDocumentsSection] delete:', err);
      toast.error('Le document n\'a pas pu être retiré');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Documents</span>
        {showUpload && (
          hasModel ? (
            <button
              type="button"
              onClick={() => setUploading(true)}
              className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800"
            >
              <Upload className="w-3.5 h-3.5" />
              Déposer
            </button>
          ) : (
            <span className="text-xs text-gray-400" title="Les documents sont partagés par marque + modèle">
              Renseignez la marque et le modèle pour déposer des documents
            </span>
          )
        )}
      </div>

      {total > 0 ? (
        <div className="mt-1.5 -mx-2">
          {modelDocuments.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} canDelete={canDelete && !!onDelete} onDelete={setDeleting} />
          ))}
          {productDocuments.map((doc) => (
            <DocumentRow key={`p-${doc.id}`} doc={{ ...doc, label: doc.file_name, document_type: 'autre' }} badge={doc.document_type || 'Fournisseur'} />
          ))}
        </div>
      ) : (
        hasModel && (
          <p className="mt-1 text-xs text-gray-400">Aucune notice ni vue éclatée pour ce modèle.</p>
        )
      )}

      {uploading && (
        <UploadModal
          equipment={equipment}
          onClose={() => { if (!isSubmitting) setUploading(false); }}
          onSubmit={submitUpload}
          isSubmitting={isSubmitting}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title="Retirer ce document"
        description={deleting ? `« ${deleting.label || equipmentDocumentTypeLabel(deleting.document_type)} » sera retiré pour tous les équipements ${deleting.brand} ${deleting.model} de l'entreprise.` : ''}
        confirmLabel="Retirer"
        variant="destructive"
        onConfirm={confirmDelete}
        loading={isDeleting}
      />
    </div>
  );
}
