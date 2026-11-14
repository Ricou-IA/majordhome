/**
 * EquipmentDocumentUploadModal.jsx — Fenêtre « Déposer un document » d'une carte équipement
 * ============================================================================
 * Fichier + portée (à qui le document s'applique : cet appareil, tous les appareils du modèle, toute la marque)
 * + type + libellé facultatif. Portées proposées par `porteesProposees` (« Cet appareil » toujours, présélectionné :
 * un document propre à un client ne doit jamais partir sur tout le parc par mégarde). Présentationnel :
 * `onSubmit({ file, documentType, label, scope })`, le parent dépose et affiche le résultat.
 * ============================================================================
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { Upload, Loader2, X } from 'lucide-react';
import { EQUIPMENT_DOCUMENT_TYPES, equipmentHasBrand, equipmentHasModel } from '@services/equipmentDocuments.service';
import { MODAL_PANEL_PHONE, MODAL_FOOTER_PHONE } from '@/lib/modalClasses';
import { porteesProposees, destinatairesPortee, typeParDefautPourFichier } from '@/lib/catalogue/documentsAppareil';

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
const MAX_SIZE = 20 * 1024 * 1024; // limite du bucket product-documents

const segmentClass = (actif) => `px-3 py-1.5 text-sm rounded-lg border transition-colors ${actif
  ? 'bg-indigo-600 border-indigo-600 text-white'
  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`;

const PLACEHOLDERS_LIBELLE = { notice: 'ex. Notice d\'installation 2019', vue_eclatee: 'ex. Vue éclatée corps de chauffe' };

/**
 * @param {Object} props
 * @param {Object} props.equipment
 * @param {Function} props.onClose
 * @param {Function} props.onSubmit - ({ file, documentType, label, scope }) => Promise
 * @param {boolean} [props.isSubmitting]
 */
export function EquipmentDocumentUploadModal({ equipment, onClose, onSubmit, isSubmitting = false }) {
  const [file, setFile] = useState(null);
  const [scope, setScope] = useState('appareil');
  const [documentType, setDocumentType] = useState('notice');
  const [typeChoisi, setTypeChoisi] = useState(false); // un type cliqué n'est jamais remplacé par la présélection
  const [label, setLabel] = useState('');
  const noms = { marque: equipment?.brand?.trim(), modele: equipment?.model?.trim() };
  const portees = porteesProposees({
    ...noms,
    aMarque: equipmentHasBrand(equipment),
    aModele: equipmentHasModel(equipment),
  });

  const handleFile = (e) => {
    const f = e.target.files?.[0] || null;
    if (f && f.size > MAX_SIZE) { toast.error('Fichier trop lourd (20 Mo maximum)'); e.target.value = ''; return; }
    setFile(f);
    const typeParDefaut = typeParDefautPourFichier({ fichier: f, typeChoisi });
    if (typeParDefaut) setDocumentType(typeParDefaut);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    await onSubmit({ file, documentType, label, scope });
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
            <p className="text-xs text-gray-500 mt-0.5">{destinatairesPortee(scope, noms)}</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 flex-1">
          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 mb-1.5">Pour qui ?</legend>
            <div className="flex flex-wrap gap-2">
              {portees.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={scope === p.value}
                  onClick={() => setScope(p.value)}
                  className={segmentClass(scope === p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Type de document</label>
            <div className="flex flex-wrap gap-2">
              {EQUIPMENT_DOCUMENT_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={documentType === t.value}
                  onClick={() => { setDocumentType(t.value); setTypeChoisi(true); }}
                  className={segmentClass(documentType === t.value)}
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
              placeholder={PLACEHOLDERS_LIBELLE[documentType] || 'ex. Schéma électrique'}
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
