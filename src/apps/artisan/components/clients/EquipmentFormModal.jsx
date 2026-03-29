/**
 * EquipmentFormModal.jsx - Majord'home Artisan
 * ============================================================================
 * Slide-over (panneau droit) pour ajouter ou modifier un équipement.
 *
 * Le dropdown "Type" utilise la table pricing_equipment_types (grille tarifaire)
 * pour permettre le lien direct avec le calcul de montant des contrats.
 *
 * Champs :
 *   - Type (select, depuis pricing_equipment_types, groupé par catégorie)
 *   - Marque (select, depuis table equipment_brands)
 *   - Modèle (texte libre)
 *   - N° Série (texte libre)
 *   - Année (select, 2000 → année en cours)
 *   - Note (textarea)
 *
 * @example
 * // Mode ajout
 * <EquipmentFormModal
 *   isOpen={showModal}
 *   onClose={() => setShowModal(false)}
 *   onSubmit={handleAdd}
 *   isSubmitting={isAdding}
 * />
 *
 * // Mode édition
 * <EquipmentFormModal
 *   isOpen={showModal}
 *   onClose={() => setShowModal(false)}
 *   onSubmit={handleEdit}
 *   isSubmitting={isUpdating}
 *   equipment={selectedEquipment}
 * />
 * ============================================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { X, Wrench, Pencil, Loader2 } from 'lucide-react';
import { useEquipmentBrands, usePricingEquipmentTypes } from '@hooks/useClients';

// ============================================================================
// UTILITAIRES
// ============================================================================

/**
 * Génère la liste des années (2000 → année en cours, décroissant)
 */
const generateYears = () => {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y >= 2000; y--) {
    years.push(y);
  }
  return years;
};

const YEARS = generateYears();

/**
 * Labels des catégories pour le groupement dans le <select>
 */
const CATEGORY_LABELS = {
  poeles: 'Poêles',
  chaudieres: 'Chaudières',
  climatisation: 'Climatisation / PAC',
  eau_chaude: 'Eau chaude',
  energie: 'Énergie',
};

/**
 * État initial du formulaire
 */
const INITIAL_FORM = {
  equipmentTypeId: '', // UUID du pricing_equipment_type
  brand: '',
  model: '',
  serialNumber: '',
  installationYear: '',
  notes: '',
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function EquipmentFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
  equipment = null, // null = ajout, objet = édition
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const { brands, isLoading: brandsLoading } = useEquipmentBrands();
  const { equipmentTypes, isLoading: typesLoading } = usePricingEquipmentTypes();

  // Mode édition ou ajout
  const isEditMode = !!equipment;

  // Grouper les types par catégorie pour le <select> avec <optgroup>
  const groupedTypes = useMemo(() => {
    const groups = {};
    for (const type of equipmentTypes) {
      const cat = type.category || 'autre';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(type);
    }
    return groups;
  }, [equipmentTypes]);

  // Reset ou pré-remplissage du formulaire à l'ouverture
  useEffect(() => {
    if (isOpen) {
      if (equipment) {
        // Mode édition : pré-remplir avec les données existantes
        setForm({
          equipmentTypeId: equipment.equipment_type_id || '',
          brand: equipment.brand || '',
          model: equipment.model || '',
          serialNumber: equipment.serial_number || '',
          installationYear: equipment.installation_year ? String(equipment.installation_year) : '',
          notes: equipment.notes || '',
        });
      } else {
        // Mode ajout : formulaire vide
        setForm(INITIAL_FORM);
      }
    }
  }, [isOpen, equipment]);

  // Mise à jour d'un champ
  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  // Soumission : on envoie l'equipmentTypeId + le category ENUM dérivé
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.equipmentTypeId) return;

    // Trouver le type sélectionné pour récupérer le equipment_category (ENUM)
    const selectedType = equipmentTypes.find(t => t.id === form.equipmentTypeId);
    const category = selectedType?.equipment_category || null;

    await onSubmit({
      equipmentTypeId: form.equipmentTypeId,
      category, // ENUM DB dérivé automatiquement
      brand: form.brand || null,
      model: form.model || null,
      serialNumber: form.serialNumber || null,
      installationYear: form.installationYear || null,
      notes: form.notes || null,
    });
  };

  // Validation : le type est requis
  const isValid = !!form.equipmentTypeId;

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panneau slide-over droit */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isEditMode ? 'bg-amber-100' : 'bg-blue-100'}`}>
              {isEditMode ? (
                <Pencil className="w-5 h-5 text-amber-600" />
              ) : (
                <Wrench className="w-5 h-5 text-blue-600" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {isEditMode ? 'Modifier l\'équipement' : 'Ajouter un équipement'}
              </h2>
              <p className="text-sm text-gray-500">
                {isEditMode ? 'Mettre à jour les caractéristiques' : 'Saisir les caractéristiques du matériel'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Formulaire */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Type d'équipement — depuis pricing_equipment_types */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Type <span className="text-red-500">*</span>
            </label>
            <select
              value={form.equipmentTypeId}
              onChange={(e) => handleChange('equipmentTypeId', e.target.value)}
              disabled={typesLoading}
              className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors text-sm disabled:bg-gray-50 disabled:text-gray-400"
              required
            >
              <option value="">Sélectionner un type...</option>
              {Object.entries(groupedTypes).map(([category, types]) => (
                <optgroup key={category} label={CATEGORY_LABELS[category] || category}>
                  {types.map(type => (
                    <option key={type.id} value={type.id}>{type.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Marque */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Marque
            </label>
            <select
              value={form.brand}
              onChange={(e) => handleChange('brand', e.target.value)}
              disabled={brandsLoading}
              className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors text-sm disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="">Sélectionner une marque...</option>
              {brands.map(brand => (
                <option key={brand.id} value={brand.name}>{brand.name}</option>
              ))}
            </select>
          </div>

          {/* Modèle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Modèle
            </label>
            <input
              type="text"
              value={form.model}
              onChange={(e) => handleChange('model', e.target.value)}
              placeholder="Ex: i630 T"
              className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors text-sm"
            />
          </div>

          {/* N° Série */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              N° Série
            </label>
            <input
              type="text"
              value={form.serialNumber}
              onChange={(e) => handleChange('serialNumber', e.target.value)}
              placeholder="Ex: SN-2024-0001"
              className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors text-sm"
            />
          </div>

          {/* Année */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Année
            </label>
            <select
              value={form.installationYear}
              onChange={(e) => handleChange('installationYear', e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors text-sm"
            >
              <option value="">Sélectionner une année...</option>
              {YEARS.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Note
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Remarques, observations..."
              rows={3}
              className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors text-sm resize-none"
            />
          </div>
        </form>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {isEditMode ? 'Mise à jour...' : 'Ajout en cours...'}
              </>
            ) : (
              isEditMode ? 'Enregistrer les modifications' : 'Ajouter l\'équipement'
            )}
          </button>
        </div>
      </div>
    </>
  );
}

export default EquipmentFormModal;
