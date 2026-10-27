/**
 * EquipmentModelDocuments.jsx — notice / vue éclatée du modèle, côté terrain
 * ============================================================================
 * Lecture seule des documents du MODÈLE d'appareil (equipment_documents,
 * partagés par marque + modèle) sur la fiche d'intervention et le certificat :
 * le technicien, tablette en main devant l'appareil, ouvre la notice (code
 * erreur) ou la vue éclatée (commande de pièce) sans repasser par la fiche
 * client. Le dépôt reste sur la fiche client (EquipmentDocumentsSection).
 * Rien n'est affiché quand le modèle n'a aucun document.
 * ============================================================================
 */

import { BookOpen, Layers, FileText, ExternalLink } from 'lucide-react';
import { useEquipmentModelDocuments, openEquipmentDocument } from '@hooks/useEquipmentDocuments';
import { equipmentDocumentTypeLabel } from '@services/equipmentDocuments.service';

const TYPE_ICON = { notice: BookOpen, vue_eclatee: Layers, autre: FileText };

/**
 * @param {Object} props
 * @param {Object} props.equipment - équipement de l'intervention (id, brand, model)
 * @param {string} [props.className]
 */
export function EquipmentModelDocuments({ equipment, className = '' }) {
  const { documentsByEquipmentId } = useEquipmentModelDocuments(equipment?.id ? [equipment.id] : []);
  const docs = equipment?.id ? documentsByEquipmentId[equipment.id] || [] : [];
  if (docs.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {docs.map((doc) => {
        const Icon = TYPE_ICON[doc.document_type] || FileText;
        return (
          <button
            key={doc.id}
            type="button"
            onClick={() => openEquipmentDocument(doc)}
            title={doc.file_name}
            className="inline-flex items-center gap-2 min-h-[44px] px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-sm text-indigo-800 hover:bg-indigo-100"
          >
            <Icon className="h-4 w-4" />
            <span className="truncate max-w-[14rem]">{doc.label || equipmentDocumentTypeLabel(doc.document_type)}</span>
            <ExternalLink className="h-3.5 w-3.5 text-indigo-400" />
          </button>
        );
      })}
    </div>
  );
}

export default EquipmentModelDocuments;
