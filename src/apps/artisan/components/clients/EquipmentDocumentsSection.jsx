/**
 * EquipmentDocumentsSection.jsx — « Documents » d'une carte équipement
 * ============================================================================
 * Trois tiroirs, du plus étroit au plus large (règles pures `documentsAppareil.js`) :
 *   - « Cet appareil » : documents déposés pour cet équipement seulement (photo de l'installation, réglage
 *     particulier…) ;
 *   - « Modèle … » : documents partagés par marque + modèle dans l'org, documents relevés sur le site du
 *     fabricant (pastille « Fabricant », procédures repliées) et documentation de la ligne fournisseur liée
 *     (product_documents, lecture seule : elle se gère sur la fiche fournisseur) ;
 *   - « Marque … » : documents partagés par toute la marque.
 * Un tiroir vide ne s'affiche pas. Dépôt (fenêtre `EquipmentDocumentUploadModal`) : toujours possible avec le droit
 * de modifier la fiche, au moins pour « Cet appareil ». Retrait : `peutRetirerDocument` (appareil = modifier,
 * modèle / marque = supprimer, document relevé jamais).
 * Ouverture = `onOpenDocument(doc)` : la carte équipement ouvre le document dans le mode atelier de son bloc
 * « Pièces détachées » (onglet `doc:<id>`), dans la page.
 * Présentationnel : les mutations sont passées par le parent (onUpload / onDelete).
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileText, BookOpen, Layers, Upload, Trash2, Eye, ChevronDown, ChevronRight } from 'lucide-react';
import { equipmentDocumentTypeLabel, equipmentHasBrand, equipmentHasModel } from '@services/equipmentDocuments.service';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { logger } from '@lib/logger';
import { rangerDocumentsModele, titreDocumentModele } from '@/lib/catalogue/nomenclature';
import {
  PORTEES_DOCUMENT, rangerEnTiroirs, peutRetirerDocument, messageRetraitDocument,
  titreTiroir, messageDepotDocument, messageErreurDepotDocument,
} from '@/lib/catalogue/documentsAppareil';
import { EquipmentDocumentUploadModal } from './EquipmentDocumentUploadModal';

const TYPE_ICON = { notice: BookOpen, vue_eclatee: Layers, fiche_technique: FileText, procedure: FileText, autre: FileText };

function DocumentRow({ doc, badge, canDelete, onDelete, onOpen }) {
  const Icon = TYPE_ICON[doc.document_type] || FileText;
  const titre = titreDocumentModele(doc, equipmentDocumentTypeLabel);
  return (
    <div className="flex items-center gap-2 rounded-lg hover:bg-gray-50 group">
      <button
        type="button"
        onClick={() => onOpen?.(doc)}
        disabled={!onOpen}
        className="flex-1 min-w-0 min-h-[44px] flex items-center gap-2.5 p-2 text-left"
        title={`Consulter ${doc.file_name || titre}`}
      >
        <Icon className="w-4 h-4 text-indigo-500 flex-shrink-0" />
        <span className="text-sm text-gray-800 group-hover:text-indigo-700 truncate">{titre}</span>
        {badge && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">{badge}</span>}
        <Eye className="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-500 flex-shrink-0 ml-auto" />
      </button>
      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete(doc)}
          className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center mr-1 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded"
          title="Retirer ce document"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/** En-tête repliable d'un tiroir, avec son nombre de documents. */
function Tiroir({ titre, nombre, ouvert, onToggle, children }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={ouvert}
        className="w-full min-h-[44px] flex items-center gap-1.5 px-2 py-1 text-left text-xs font-medium text-gray-600 hover:text-gray-900"
      >
        {ouvert ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
        {titre} ({nombre})
      </button>
      {ouvert && children}
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Object} props.equipment
 * @param {Array} [props.modelDocuments] - documents de l'équipement (trois portées, vue majordhome_equipment_model_documents)
 * @param {Array} [props.productDocuments] - documentation de la ligne fournisseur liée (lecture seule)
 * @param {boolean} [props.canUpload] - droit clients.edit (dépôt, et retrait d'un document « Cet appareil »)
 * @param {boolean} [props.canDelete] - org_admin (retrait d'un document de modèle ou de marque)
 * @param {Function} [props.onUpload] - (equipment, { file, documentType, label, scope }) => Promise
 * @param {Function} [props.onDelete] - (doc) => Promise
 * @param {Function} [props.onOpenDocument] - (doc) : ouvre le document (mode atelier de la carte équipement)
 */
export function EquipmentDocumentsSection({
  equipment,
  modelDocuments = [],
  productDocuments = [],
  canUpload = false,
  canDelete = false,
  onUpload,
  onDelete,
  onOpenDocument,
}) {
  const [uploading, setUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [proceduresOuvertes, setProceduresOuvertes] = useState(false);
  const [fermes, setFermes] = useState({});

  const tiroirs = useMemo(() => rangerEnTiroirs(modelDocuments, productDocuments), [modelDocuments, productDocuments]);
  // Tiroir Modèle : documents du modèle (rangés, procédures repliées), puis documentation fournisseur en lecture seule
  const rangesModele = useMemo(() => {
    const fournisseur = new Set(productDocuments);
    return rangerDocumentsModele(tiroirs.modele.filter((d) => !fournisseur.has(d)));
  }, [tiroirs, productDocuments]);

  const noms = {
    marque: equipment?.brand, modele: equipment?.model,
    aMarque: equipmentHasBrand(equipment), aModele: equipmentHasModel(equipment),
  };
  const total = modelDocuments.length + productDocuments.length;
  const showUpload = canUpload && !!onUpload;
  if (total === 0 && !showUpload) return null;

  const droits = { peutModifier: canUpload, peutSupprimer: canDelete };
  const retirable = (doc) => !!onDelete && peutRetirerDocument(doc, droits);
  const basculer = (portee) => setFermes((f) => ({ ...f, [portee]: !f[portee] }));

  const submitUpload = async (payload) => {
    setIsSubmitting(true);
    try {
      await onUpload(equipment, payload);
      toast.success(messageDepotDocument(payload.scope));
      setUploading(false);
    } catch (err) {
      logger.error('[EquipmentDocumentsSection] upload:', err);
      toast.error(messageErreurDepotDocument(err));
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
      logger.error('[EquipmentDocumentsSection] delete:', err);
      toast.error('Le document n\'a pas pu être retiré');
    } finally {
      setIsDeleting(false);
    }
  };

  const ligne = (doc) => (
    <DocumentRow key={doc.id} doc={doc} badge={doc.from_site ? 'Fabricant' : null} onOpen={onOpenDocument}
      canDelete={retirable(doc)} onDelete={setDeleting} />
  );

  const contenuTiroir = (portee) => {
    if (portee !== 'modele') return tiroirs[portee].map(ligne);
    return (
      <>
        {rangesModele.principaux.map(ligne)}
        {rangesModele.procedures.length > 0 && (
          <button
            type="button"
            onClick={() => setProceduresOuvertes((v) => !v)}
            aria-expanded={proceduresOuvertes}
            className="w-full min-h-[44px] flex items-center gap-2.5 p-2 text-left text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
          >
            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
            Procédures ({rangesModele.procedures.length})
            <span className="ml-auto text-xs text-indigo-600">{proceduresOuvertes ? 'Masquer' : 'Afficher'}</span>
          </button>
        )}
        {proceduresOuvertes && rangesModele.procedures.map(ligne)}
        {productDocuments.map((doc) => (
          <DocumentRow key={`p-${doc.id}`} doc={{ ...doc, label: doc.file_name, document_type: 'autre' }} badge={doc.document_type || 'Fournisseur'} onOpen={onOpenDocument} />
        ))}
      </>
    );
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Documents</span>
        {showUpload && (
          <button
            type="button"
            onClick={() => setUploading(true)}
            className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800"
          >
            <Upload className="w-3.5 h-3.5" />
            Déposer
          </button>
        )}
      </div>

      {total > 0 ? (
        <div className="mt-1.5 -mx-2 space-y-1">
          {PORTEES_DOCUMENT.filter((portee) => tiroirs[portee].length > 0).map((portee) => (
            <Tiroir
              key={portee}
              titre={titreTiroir(portee, noms)}
              nombre={tiroirs[portee].length}
              ouvert={!fermes[portee]}
              onToggle={() => basculer(portee)}
            >
              {contenuTiroir(portee)}
            </Tiroir>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-xs text-gray-400">Aucun document pour cet appareil.</p>
      )}

      {uploading && (
        <EquipmentDocumentUploadModal
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
        description={deleting ? messageRetraitDocument({ ...deleting, label: titreDocumentModele(deleting, equipmentDocumentTypeLabel) }) : ''}
        confirmLabel="Retirer"
        variant="destructive"
        onConfirm={confirmDelete}
        loading={isDeleting}
      />
    </div>
  );
}
