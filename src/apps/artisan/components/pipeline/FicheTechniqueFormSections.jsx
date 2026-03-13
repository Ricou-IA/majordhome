/**
 * FicheTechniqueFormSections.jsx - Majord'home Artisan
 * ============================================================================
 * 5 sections du formulaire Fiche Technique Terrain.
 * Pattern identique à LeadFormSections.jsx — composants contrôlés.
 *
 * - SectionContexte : champs read-only pré-remplis depuis le lead
 * - SectionBatiment : collapsible, tous optionnels
 * - SectionReleveTechnique : installation existante + contraintes terrain
 * - SectionPhotos : 5 zones PhotoDropZone par catégorie
 * - SectionSynthese : textareas + checkboxes next steps
 * ============================================================================
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  FormField,
  TextInput,
  SelectInput,
  TextArea,
  SectionTitle,
} from '@/apps/artisan/components/FormFields';
import { PhotoDropZone } from './PhotoDropZone';
import {
  BUILDING_TYPES,
  INSULATION_TYPES,
  GLAZING_TYPES,
  DPE_RATINGS,
  ENERGY_TYPES,
  EQUIPMENT_CONDITIONS,
  ECS_TYPES,
  AC_TYPES,
  OUTDOOR_ACCESS,
  PHOTO_CATEGORIES,
  NEXT_STEPS,
} from './FicheTechniqueConfig';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Wrapper champ avec auto-save on blur
 */
function AutoSaveField({
  label,
  field,
  value,
  onChange,
  onAutoSave,
  disabled,
  required,
  children,
}) {
  const handleBlur = () => {
    if (onAutoSave && !disabled) {
      onAutoSave(field, value);
    }
  };

  return (
    <FormField label={label} required={required}>
      <div onBlur={handleBlur}>{children}</div>
    </FormField>
  );
}

/**
 * Checkbox simple pour les suites à donner / booleans
 */
function CheckboxField({ label, checked, onChange, disabled }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked || false}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
      />
      <span className={`text-sm ${disabled ? 'text-secondary-400' : 'text-secondary-700'}`}>
        {label}
      </span>
    </label>
  );
}

// ============================================================================
// SECTION 1 — CONTEXTE (READ-ONLY)
// ============================================================================

export function SectionContexte({ lead, form, disabled }) {
  // Nom complet : Prénom NOM
  const clientName = [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || '—';

  // Adresse complète : rue, complément, CP ville
  const addressParts = [];
  if (lead?.address) addressParts.push(lead.address);
  if (lead?.address_complement) addressParts.push(lead.address_complement);
  const cpVille = [lead?.postal_code, lead?.city].filter(Boolean).join(' ');
  if (cpVille) addressParts.push(cpVille);
  const fullAddress = addressParts.join(', ') || '—';

  return (
    <>
      <SectionTitle>Contexte de la visite</SectionTitle>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Client">
          <div className="px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-700">
            {clientName}
          </div>
        </FormField>

        <FormField label="Commercial assigné">
          <div className="px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-700">
            {form.commercial_name || '—'}
          </div>
        </FormField>

        <FormField label="Date de visite">
          <div className="px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-700">
            {form.visit_date
              ? new Date(form.visit_date).toLocaleDateString('fr-FR')
              : '—'}
          </div>
        </FormField>

        <FormField label="Type de projet">
          <div className="px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-700">
            {form.project_type || lead?.equipment_type_label || '—'}
          </div>
        </FormField>
      </div>

      {/* Adresse */}
      <div className="mt-3">
        <FormField label="Adresse du chantier">
          <div className="px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-700">
            {fullAddress}
          </div>
        </FormField>
      </div>
    </>
  );
}

// ============================================================================
// SECTION 2 — BÂTIMENT (COLLAPSIBLE, OPTIONNELLE)
// ============================================================================

export function SectionBatiment({ form, setField, onAutoSave, disabled }) {
  const [isOpen, setIsOpen] = useState(false);

  // Vérifie si au moins un champ bâtiment est rempli
  const hasData = form.building_type || form.building_surface || form.building_year
    || form.building_levels || form.building_rooms || form.insulation_type
    || form.glazing_type || form.dpe_rating;

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full text-left mt-6 mb-3"
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-secondary-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-secondary-400" />
        )}
        <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider">
          Description du bâtiment
        </h3>
        {!isOpen && hasData && (
          <span className="text-xs text-emerald-600 font-normal normal-case">
            (renseigné)
          </span>
        )}
        <span className="text-xs text-secondary-400 font-normal normal-case ml-auto">
          optionnel
        </span>
      </button>

      {isOpen && (
        <div className="space-y-3 pl-6">
          <div className="grid grid-cols-2 gap-3">
            <AutoSaveField label="Type de bâtiment" field="building_type" value={form.building_type} onAutoSave={onAutoSave} disabled={disabled}>
              <SelectInput
                value={form.building_type}
                onChange={(v) => setField('building_type', v)}
                options={BUILDING_TYPES}
                placeholder="Sélectionner..."
                disabled={disabled}
              />
            </AutoSaveField>

            <AutoSaveField label="Surface (m²)" field="building_surface" value={form.building_surface} onAutoSave={onAutoSave} disabled={disabled}>
              <TextInput
                type="number"
                value={form.building_surface}
                onChange={(v) => setField('building_surface', v)}
                placeholder="Ex: 120"
                disabled={disabled}
              />
            </AutoSaveField>

            <AutoSaveField label="Année construction" field="building_year" value={form.building_year} onAutoSave={onAutoSave} disabled={disabled}>
              <TextInput
                type="number"
                value={form.building_year}
                onChange={(v) => setField('building_year', v)}
                placeholder="Ex: 1985"
                disabled={disabled}
              />
            </AutoSaveField>

            <AutoSaveField label="Niveaux" field="building_levels" value={form.building_levels} onAutoSave={onAutoSave} disabled={disabled}>
              <TextInput
                type="number"
                value={form.building_levels}
                onChange={(v) => setField('building_levels', v)}
                placeholder="Ex: 2"
                disabled={disabled}
              />
            </AutoSaveField>

            <AutoSaveField label="Pièces" field="building_rooms" value={form.building_rooms} onAutoSave={onAutoSave} disabled={disabled}>
              <TextInput
                type="number"
                value={form.building_rooms}
                onChange={(v) => setField('building_rooms', v)}
                placeholder="Ex: 6"
                disabled={disabled}
              />
            </AutoSaveField>

            <AutoSaveField label="Isolation" field="insulation_type" value={form.insulation_type} onAutoSave={onAutoSave} disabled={disabled}>
              <SelectInput
                value={form.insulation_type}
                onChange={(v) => setField('insulation_type', v)}
                options={INSULATION_TYPES}
                placeholder="Sélectionner..."
                disabled={disabled}
              />
            </AutoSaveField>

            <AutoSaveField label="Vitrage" field="glazing_type" value={form.glazing_type} onAutoSave={onAutoSave} disabled={disabled}>
              <SelectInput
                value={form.glazing_type}
                onChange={(v) => setField('glazing_type', v)}
                options={GLAZING_TYPES}
                placeholder="Sélectionner..."
                disabled={disabled}
              />
            </AutoSaveField>

            <AutoSaveField label="DPE" field="dpe_rating" value={form.dpe_rating} onAutoSave={onAutoSave} disabled={disabled}>
              <SelectInput
                value={form.dpe_rating}
                onChange={(v) => setField('dpe_rating', v)}
                options={DPE_RATINGS}
                placeholder="Sélectionner..."
                disabled={disabled}
              />
            </AutoSaveField>

            <AutoSaveField label="N° DPE (ADEME)" field="dpe_number" value={form.dpe_number} onAutoSave={onAutoSave} disabled={disabled}>
              <TextInput
                value={form.dpe_number}
                onChange={(v) => setField('dpe_number', v)}
                placeholder="Ex: 2281E0123456N"
                disabled={disabled}
              />
            </AutoSaveField>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SECTION 3 — RELEVÉ TECHNIQUE
// ============================================================================

export function SectionReleveTechnique({ form, setField, onAutoSave, disabled }) {
  return (
    <>
      {/* Sous-section : Installation existante */}
      <SectionTitle>Installation existante</SectionTitle>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <AutoSaveField label="Énergie existante" field="existing_energy" value={form.existing_energy} onAutoSave={onAutoSave} disabled={disabled}>
            <SelectInput
              value={form.existing_energy}
              onChange={(v) => setField('existing_energy', v)}
              options={ENERGY_TYPES}
              placeholder="Sélectionner..."
              disabled={disabled}
            />
          </AutoSaveField>

          <AutoSaveField label="Type d'équipement" field="existing_equipment_type" value={form.existing_equipment_type} onAutoSave={onAutoSave} disabled={disabled}>
            <TextInput
              value={form.existing_equipment_type}
              onChange={(v) => setField('existing_equipment_type', v)}
              placeholder="Ex: Chaudière murale"
              disabled={disabled}
            />
          </AutoSaveField>

          <AutoSaveField label="Marque / Modèle" field="existing_brand_model" value={form.existing_brand_model} onAutoSave={onAutoSave} disabled={disabled}>
            <TextInput
              value={form.existing_brand_model}
              onChange={(v) => setField('existing_brand_model', v)}
              placeholder="Ex: Saunier Duval"
              disabled={disabled}
            />
          </AutoSaveField>

          <AutoSaveField label="Année installation" field="existing_year" value={form.existing_year} onAutoSave={onAutoSave} disabled={disabled}>
            <TextInput
              type="number"
              value={form.existing_year}
              onChange={(v) => setField('existing_year', v)}
              placeholder="Ex: 2005"
              disabled={disabled}
            />
          </AutoSaveField>

          <AutoSaveField label="État" field="existing_condition" value={form.existing_condition} onAutoSave={onAutoSave} disabled={disabled}>
            <SelectInput
              value={form.existing_condition}
              onChange={(v) => setField('existing_condition', v)}
              options={EQUIPMENT_CONDITIONS}
              placeholder="Sélectionner..."
              disabled={disabled}
            />
          </AutoSaveField>

          <AutoSaveField label="Production ECS" field="existing_ecs" value={form.existing_ecs} onAutoSave={onAutoSave} disabled={disabled}>
            <SelectInput
              value={form.existing_ecs}
              onChange={(v) => setField('existing_ecs', v)}
              options={ECS_TYPES}
              placeholder="Sélectionner..."
              disabled={disabled}
            />
          </AutoSaveField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <AutoSaveField label="Climatisation existante" field="existing_ac" value={form.existing_ac} onAutoSave={onAutoSave} disabled={disabled}>
            <SelectInput
              value={form.existing_ac === true ? 'true' : form.existing_ac === false ? 'false' : ''}
              onChange={(v) => setField('existing_ac', v === 'true' ? true : v === 'false' ? false : null)}
              disabled={disabled}
              placeholder="Sélectionner..."
              options={[
                { value: 'true', label: 'Oui' },
                { value: 'false', label: 'Non' },
              ]}
            />
          </AutoSaveField>

          {form.existing_ac === true && (
            <AutoSaveField label="Type de climatisation" field="existing_ac_type" value={form.existing_ac_type} onAutoSave={onAutoSave} disabled={disabled}>
              <SelectInput
                value={form.existing_ac_type}
                onChange={(v) => setField('existing_ac_type', v)}
                options={AC_TYPES}
                placeholder="Sélectionner..."
                disabled={disabled}
              />
            </AutoSaveField>
          )}
        </div>

        <AutoSaveField label="Observations" field="existing_observations" value={form.existing_observations} onAutoSave={onAutoSave} disabled={disabled}>
          <TextArea
            value={form.existing_observations}
            onChange={(v) => setField('existing_observations', v)}
            placeholder="État général, bruits, fuites, radiateurs..."
            rows={3}
            disabled={disabled}
          />
        </AutoSaveField>
      </div>

      {/* Sous-section : Contraintes terrain */}
      <SectionTitle>Contraintes terrain</SectionTitle>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <AutoSaveField label="Accès extérieur" field="outdoor_access" value={form.outdoor_access} onAutoSave={onAutoSave} disabled={disabled}>
            <SelectInput
              value={form.outdoor_access}
              onChange={(v) => setField('outdoor_access', v)}
              options={OUTDOOR_ACCESS}
              placeholder="Sélectionner..."
              disabled={disabled}
            />
          </AutoSaveField>

          {/* Tableau électrique */}
          <AutoSaveField label="Tableau électrique OK" field="electrical_panel_ok" value={form.electrical_panel_ok} onAutoSave={onAutoSave} disabled={disabled}>
            <SelectInput
              value={form.electrical_panel_ok === true ? 'true' : form.electrical_panel_ok === false ? 'false' : ''}
              onChange={(v) => setField('electrical_panel_ok', v === 'true' ? true : v === 'false' ? false : null)}
              disabled={disabled}
              placeholder="Sélectionner..."
              options={[
                { value: 'true', label: 'Oui — conforme' },
                { value: 'false', label: 'Non — à prévoir' },
              ]}
            />
          </AutoSaveField>
        </div>

        {form.electrical_panel_ok === false && (
          <AutoSaveField label="Notes tableau électrique" field="electrical_panel_notes" value={form.electrical_panel_notes} onAutoSave={onAutoSave} disabled={disabled}>
            <TextArea
              value={form.electrical_panel_notes}
              onChange={(v) => setField('electrical_panel_notes', v)}
              placeholder="Détails des travaux électriques nécessaires..."
              rows={2}
              disabled={disabled}
            />
          </AutoSaveField>
        )}

        <AutoSaveField label="Contraintes spécifiques" field="specific_constraints" value={form.specific_constraints} onAutoSave={onAutoSave} disabled={disabled}>
          <TextArea
            value={form.specific_constraints}
            onChange={(v) => setField('specific_constraints', v)}
            placeholder="Copropriété, servitude, PLU, accès difficile..."
            rows={2}
            disabled={disabled}
          />
        </AutoSaveField>
      </div>
    </>
  );
}

// ============================================================================
// SECTION 4 — PHOTOS
// ============================================================================

export function SectionPhotos({
  photosByCategory,
  onUploadPhotos,
  onDeletePhoto,
  disabled,
}) {
  return (
    <>
      <SectionTitle>Photos & documents</SectionTitle>

      <div className="space-y-4">
        {PHOTO_CATEGORIES.map((cat) => (
          <PhotoDropZone
            key={cat.value}
            category={cat.value}
            label={cat.label}
            photos={photosByCategory[cat.value] || []}
            onUpload={(files) => onUploadPhotos(files, cat.value)}
            onDelete={(photoId, storagePath) => onDeletePhoto(photoId, storagePath)}
            disabled={disabled}
            maxFiles={cat.value === 'other' ? 10 : 5}
          />
        ))}
      </div>
    </>
  );
}

// ============================================================================
// SECTION 5 — SYNTHÈSE & RECOMMANDATION
// ============================================================================

export function SectionSynthese({ form, setField, onAutoSave, disabled }) {
  return (
    <>
      <SectionTitle>Synthèse & recommandation</SectionTitle>

      <div className="space-y-3">
        <AutoSaveField label="Points clés du relevé" field="key_points" value={form.key_points} onAutoSave={onAutoSave} disabled={disabled}>
          <TextArea
            value={form.key_points}
            onChange={(v) => setField('key_points', v)}
            placeholder="Résumé des points importants relevés sur le terrain..."
            rows={4}
            disabled={disabled}
          />
        </AutoSaveField>

        <AutoSaveField label="Préconisation produit" field="product_recommendation" value={form.product_recommendation} onAutoSave={onAutoSave} disabled={disabled}>
          <TextArea
            value={form.product_recommendation}
            onChange={(v) => setField('product_recommendation', v)}
            placeholder="Recommandation technique : modèle, puissance, configuration..."
            rows={4}
            disabled={disabled}
          />
        </AutoSaveField>

        {/* Suites à donner */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-secondary-700 mb-2">
            Suites à donner
          </label>
          <div className="space-y-2">
            {NEXT_STEPS.map((step) => (
              <CheckboxField
                key={step.key}
                label={step.label}
                checked={form[step.key]}
                onChange={(checked) => {
                  setField(step.key, checked);
                  if (onAutoSave && !disabled) {
                    onAutoSave(step.key, checked);
                  }
                }}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
