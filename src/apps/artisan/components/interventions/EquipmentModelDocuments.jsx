/**
 * EquipmentModelDocuments.jsx — notice / vue éclatée du modèle, côté terrain
 * ============================================================================
 * Lecture seule des documents du MODÈLE d'appareil (equipment_documents,
 * partagés par marque + modèle, ou relevés sur le site du fabricant pour un
 * équipement rattaché à son modèle) sur la fiche d'intervention et le
 * certificat : le technicien, tablette en main devant l'appareil, ouvre la
 * notice (code erreur) ou la fiche technique sans repasser par la fiche
 * client. Le dépôt reste sur la fiche client (EquipmentDocumentsSection).
 * Les procédures du fabricant (une dizaine sur un poêle à granulés) sont
 * repliées derrière un bouton « Procédures (N) ».
 * Rien n'est affiché quand le modèle n'a aucun document.
 * ============================================================================
 */

import { useState } from 'react';
import { BookOpen, Layers, FileText, Eye, ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import { useEquipmentModelDocuments } from '@hooks/useEquipmentDocuments';
import { equipmentDocumentTypeLabel } from '@services/equipmentDocuments.service';
import { rangerDocumentsModele, titreDocumentModele } from '@/lib/catalogue/nomenclature';
import LecteurEnLigne from '../equipements/LecteurEnLigne';

const TYPE_ICON = { notice: BookOpen, vue_eclatee: Layers, fiche_technique: FileText, procedure: ListChecks, autre: FileText };
const PUCE = 'inline-flex items-center gap-2 min-h-[44px] px-3 py-2 rounded-lg border text-sm';

function Puce({ doc, onOpen }) {
  const Icon = TYPE_ICON[doc.document_type] || FileText;
  return (
    <button
      type="button"
      onClick={() => onOpen(doc)}
      title={doc.file_name}
      className={`${PUCE} border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100`}
    >
      <Icon className="h-4 w-4" />
      <span className="truncate max-w-[14rem]">{titreDocumentModele(doc, equipmentDocumentTypeLabel)}</span>
      <Eye className="h-3.5 w-3.5 text-indigo-400" />
    </button>
  );
}

/**
 * @param {Object} props
 * @param {Object} props.equipment - équipement de l'intervention (id, brand, model)
 * @param {string} [props.className]
 */
export function EquipmentModelDocuments({ equipment, className = '' }) {
  const { documentsByEquipmentId } = useEquipmentModelDocuments(equipment?.id ? [equipment.id] : []);
  const [proceduresOuvertes, setProceduresOuvertes] = useState(false);
  const [consulte, setConsulte] = useState(null); // document ouvert dans la page, sous la liste
  const ouvrir = (doc) => setConsulte((courant) => (courant?.id === doc.id ? null : doc)); // même document = fermer
  const docs = equipment?.id ? documentsByEquipmentId[equipment.id] || [] : [];
  if (docs.length === 0) return null;
  const { principaux, procedures } = rangerDocumentsModele(docs);

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {principaux.map((doc) => <Puce key={doc.id} doc={doc} onOpen={ouvrir} />)}
      {procedures.length > 0 && (
        <button
          type="button"
          onClick={() => setProceduresOuvertes((v) => !v)}
          aria-expanded={proceduresOuvertes}
          className={`${PUCE} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
        >
          <ListChecks className="h-4 w-4" />
          Procédures ({procedures.length})
          {proceduresOuvertes ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      )}
      {proceduresOuvertes && procedures.map((doc) => <Puce key={doc.id} doc={doc} onOpen={ouvrir} />)}
      {consulte && <LecteurEnLigne doc={consulte} onClose={() => setConsulte(null)} className="basis-full w-full" />}
    </div>
  );
}

export default EquipmentModelDocuments;
