/**
 * PartsReplacedList.jsx - Majord'home Artisan
 * ============================================================================
 * Liste dynamique de pièces remplacées (nom, référence, quantité).
 * Add/remove rows, compatible React Hook Form (useFieldArray).
 *
 * @version 1.0.0 - Sprint 3 Outil Terrain Tablette
 * ============================================================================
 */

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * @param {Object} props
 * @param {Array} props.parts - Liste des pièces [{ name, reference, quantity }]
 * @param {Function} props.onChange - Callback avec la nouvelle liste
 * @param {boolean} props.disabled - Désactiver l'édition
 */
export function PartsReplacedList({
  parts = [],
  onChange,
  disabled = false,
}) {
  // Ajouter une pièce vide
  const handleAdd = () => {
    const updated = [...parts, { name: '', reference: '', quantity: 1 }];
    onChange?.(updated);
  };

  // Modifier une pièce
  const handleChange = (index, field, value) => {
    const updated = parts.map((part, i) =>
      i === index ? { ...part, [field]: value } : part
    );
    onChange?.(updated);
  };

  // Supprimer une pièce
  const handleRemove = (index) => {
    const updated = parts.filter((_, i) => i !== index);
    onChange?.(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-base font-medium">Pièces remplacées</Label>
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAdd}
            className="min-h-[44px] text-base gap-1"
          >
            <Plus className="h-4 w-4" />
            Ajouter
          </Button>
        )}
      </div>

      {parts.length === 0 ? (
        <p className="text-sm text-gray-500 italic py-2">
          Aucune pièce remplacée
        </p>
      ) : (
        <div className="space-y-3">
          {parts.map((part, index) => (
            <div
              key={index}
              className="bg-white rounded-lg border p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-gray-500 mt-2">
                  Pièce {index + 1}
                </span>
                {!disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(index)}
                    className="h-9 w-9 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* Nom de la pièce */}
              <div>
                <Input
                  placeholder="Nom de la pièce"
                  value={part.name}
                  onChange={(e) => handleChange(index, 'name', e.target.value)}
                  disabled={disabled}
                  className="min-h-[44px] text-base"
                />
              </div>

              {/* Référence + Quantité */}
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Input
                    placeholder="Référence"
                    value={part.reference}
                    onChange={(e) => handleChange(index, 'reference', e.target.value)}
                    disabled={disabled}
                    className="min-h-[44px] text-base"
                  />
                </div>
                <div>
                  <Input
                    type="number"
                    min="1"
                    placeholder="Qté"
                    value={part.quantity}
                    onChange={(e) => handleChange(index, 'quantity', parseInt(e.target.value) || 1)}
                    disabled={disabled}
                    className="min-h-[44px] text-base text-center"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PartsReplacedList;
