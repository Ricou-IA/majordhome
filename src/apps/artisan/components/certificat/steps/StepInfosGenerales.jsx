/**
 * StepInfosGenerales.jsx - Étape 1 du wizard certificat
 * ============================================================================
 * Infos client (pré-rempli, lecture seule) + technicien (éditable) + équipement.
 * ============================================================================
 */

import { FormField, TextInput, SelectInput } from '@apps/artisan/components/FormFields';
import { SectionTitle } from '@apps/artisan/components/FormFields';
import {
  EQUIPMENT_CATEGORY_LABELS,
  COMBUSTIBLES,
  FLUIDES_FRIGORIGENES,
  SECTIONS_PAR_EQUIPEMENT,
} from '../constants';

// Certifications propres à Mayer Énergie (en dur)
const CERTIFICATIONS_ENTREPRISE = ['QualiPAC', 'QualiBois'];

export function StepInfosGenerales({ formData, onChange, client, technicians = [], canSelectTechnician = false }) {
  const config = SECTIONS_PAR_EQUIPEMENT[formData.equipement_type] || {};
  const showFluide = config.showFGaz;
  const showCombustible = config.showRamonage;

  const technicianOptions = technicians.map((t) => ({
    value: t.display_name || `${t.first_name || ''} ${t.last_name || ''}`.trim(),
    label: t.display_name || `${t.first_name || ''} ${t.last_name || ''}`.trim(),
  }));

  return (
    <div className="space-y-6">
      {/* ── Client ── */}
      <SectionTitle>Client</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Nom">
          <TextInput value={client?.display_name || client?.last_name || ''} disabled />
        </FormField>
        <FormField label="Téléphone">
          <TextInput value={client?.phone || ''} disabled />
        </FormField>
        <FormField label="Adresse" className="sm:col-span-2">
          <TextInput
            value={[client?.address, client?.postal_code, client?.city].filter(Boolean).join(', ')}
            disabled
          />
        </FormField>
      </div>

      {/* ── Technicien ── */}
      <SectionTitle>Technicien</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Nom du technicien" required>
          {canSelectTechnician ? (
            <SelectInput
              value={formData.technicien_nom || ''}
              onChange={(val) => onChange('technicien_nom', val)}
              options={technicianOptions}
              placeholder="Sélectionner un technicien..."
            />
          ) : (
            <TextInput value={formData.technicien_nom} disabled />
          )}
        </FormField>
        <FormField label="Certifications">
          <div className="flex flex-wrap gap-2">
            {CERTIFICATIONS_ENTREPRISE.map(cert => (
              <span
                key={cert}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white border border-blue-600"
              >
                {cert}
              </span>
            ))}
          </div>
        </FormField>
      </div>

      {/* ── Équipement ── */}
      <SectionTitle>Équipement</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Type">
          <TextInput value={EQUIPMENT_CATEGORY_LABELS[formData.equipement_type] || formData.equipement_type} disabled />
        </FormField>
        <FormField label="Marque">
          <TextInput
            value={formData.equipement_marque}
            onChange={(val) => onChange('equipement_marque', val)}
            placeholder="Marque"
          />
        </FormField>
        <FormField label="Modèle">
          <TextInput
            value={formData.equipement_modele}
            onChange={(val) => onChange('equipement_modele', val)}
            placeholder="Modèle"
          />
        </FormField>
        <FormField label="N° de série">
          <TextInput
            value={formData.equipement_numero_serie}
            onChange={(val) => onChange('equipement_numero_serie', val)}
            placeholder="N° série"
          />
        </FormField>
        <FormField label="Année d'installation">
          <TextInput
            type="number"
            value={formData.equipement_annee || ''}
            onChange={(val) => onChange('equipement_annee', val ? parseInt(val) : null)}
            placeholder="2020"
          />
        </FormField>
        <FormField label="Puissance (kW)">
          <TextInput
            type="number"
            step="0.1"
            value={formData.equipement_puissance_kw || ''}
            onChange={(val) => onChange('equipement_puissance_kw', val ? parseFloat(val) : null)}
            placeholder="12.5"
          />
        </FormField>

        {/* Fluide frigorigène (PAC/clim) */}
        {showFluide && (
          <>
            <FormField label="Fluide frigorigène">
              <SelectInput
                value={formData.equipement_fluide}
                onChange={(val) => onChange('equipement_fluide', val)}
                options={FLUIDES_FRIGORIGENES}
                placeholder="Sélectionner..."
              />
            </FormField>
            <FormField label="Charge fluide (kg)">
              <TextInput
                type="number"
                step="0.001"
                value={formData.equipement_charge_kg || ''}
                onChange={(val) => onChange('equipement_charge_kg', val ? parseFloat(val) : null)}
                placeholder="1.800"
              />
            </FormField>
          </>
        )}

        {/* Combustible (bois/gaz/fioul) */}
        {showCombustible && (
          <FormField label="Combustible">
            <SelectInput
              value={formData.combustible}
              onChange={(val) => onChange('combustible', val)}
              options={COMBUSTIBLES}
              placeholder="Sélectionner..."
            />
          </FormField>
        )}
      </div>

      {/* ── Date intervention ── */}
      <SectionTitle>Date d'intervention</SectionTitle>
      <FormField label="Date" required>
        <TextInput
          type="date"
          value={formData.date_intervention}
          onChange={(val) => onChange('date_intervention', val)}
        />
      </FormField>
    </div>
  );
}
