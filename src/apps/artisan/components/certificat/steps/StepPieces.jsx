/**
 * StepPieces.jsx - Étape 7 du wizard certificat
 * ============================================================================
 * Pièces remplacées (tableau dynamique) + recommandations + prochaine date.
 * ============================================================================
 */

import { ListeChoix } from '@/components/ui/liste-choix';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormField, TextInput, TextArea } from '@apps/artisan/components/FormFields';
import { SectionTitle } from '@apps/artisan/components/FormFields';

const emptyPiece = () => ({
  designation: '',
  reference: '',
  quantite: 1,
  prix_ht: null,
});

export function StepPieces({ formData, onChange }) {
  const pieces = formData.pieces_remplacees || [];

  const updatePiece = (index, field, value) => {
    const updated = [...pieces];
    updated[index] = { ...updated[index], [field]: value };
    onChange('pieces_remplacees', updated);
  };

  const addPiece = () => {
    onChange('pieces_remplacees', [...pieces, emptyPiece()]);
  };

  const removePiece = (index) => {
    onChange('pieces_remplacees', pieces.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <SectionTitle>Pièces remplacées</SectionTitle>

      {pieces.length === 0 && (
        <p className="text-sm text-secondary-400 italic">Aucune pièce remplacée.</p>
      )}

      {pieces.map((piece, index) => (
        <div key={index} className="border border-secondary-200 rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-secondary-700">Pièce {index + 1}</span>
            <button
              type="button"
              onClick={() => removePiece(index)}
              className="text-red-500 hover:text-red-700 p-1"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Désignation" required>
              <TextInput
                value={piece.designation}
                onChange={(val) => updatePiece(index, 'designation', val)}
                placeholder="Nom de la pièce"
              />
            </FormField>
            <FormField label="Référence">
              <TextInput
                value={piece.reference}
                onChange={(val) => updatePiece(index, 'reference', val)}
                placeholder="Réf. fournisseur"
              />
            </FormField>
            <FormField label="Quantité">
              <TextInput
                type="number"
                min="1"
                value={piece.quantite}
                onChange={(val) => updatePiece(index, 'quantite', val ? parseInt(val) : 1)}
              />
            </FormField>
            <FormField label="Prix TTC (€)">
              <TextInput
                type="number"
                step="0.01"
                value={piece.prix_ht ?? ''}
                onChange={(val) => updatePiece(index, 'prix_ht', val ? parseFloat(val) : null)}
                placeholder="0.00"
              />
            </FormField>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" onClick={addPiece} className="min-h-[44px]">
        <Plus className="w-4 h-4 mr-2" />
        Ajouter une pièce
      </Button>

      {/* Recommandations */}
      <SectionTitle>Recommandations</SectionTitle>
      <FormField label="Recommandations">
        <TextArea
          value={formData.recommandations || ''}
          onChange={(val) => onChange('recommandations', val)}
          rows={3}
          placeholder="Recommandations pour le client..."
        />
      </FormField>

      <FormField label="Prochaine intervention préconisée">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <ListeChoix
              libelle="Mois de la prochaine intervention"
              value={formData.prochaine_intervention ? formData.prochaine_intervention.slice(5, 7) : ''}
              onChange={(v) => {
                const year = formData.prochaine_intervention ? formData.prochaine_intervention.slice(0, 4) : String(new Date().getFullYear() + 1);
                onChange('prochaine_intervention', v ? `${year}-${v}` : '');
              }}
              options={[
                { value: '', label: 'Mois...' },
                ...['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'].map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m })),
              ]}
            />
          </div>
          <div className="w-28 shrink-0">
            <ListeChoix
              libelle="Année de la prochaine intervention"
              value={formData.prochaine_intervention ? formData.prochaine_intervention.slice(0, 4) : ''}
              onChange={(v) => {
                const month = formData.prochaine_intervention ? formData.prochaine_intervention.slice(5, 7) : '01';
                onChange('prochaine_intervention', v ? `${v}-${month}` : '');
              }}
              options={[
                { value: '', label: 'Année...' },
                ...[0, 1, 2, 3].map((offset) => {
                  const y = new Date().getFullYear() + offset;
                  return { value: y, label: String(y) };
                }),
              ]}
            />
          </div>
        </div>
      </FormField>
    </div>
  );
}
