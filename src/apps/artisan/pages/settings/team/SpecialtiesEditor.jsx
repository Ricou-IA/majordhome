// src/apps/artisan/pages/settings/team/SpecialtiesEditor.jsx
// ============================================================================
// Compétences d'un technicien = catégories d'équipement qu'il entretient
// (majordhome.team_members.specialties). Vide = polyvalent. Consommé par le
// moteur de tournées (proposerPourContrat) : un contrat clim n'est proposé
// qu'aux techniciens qui ont « clim ».
//
// Les catégories proposées sont celles réellement présentes dans la grille
// tarifaire de l'org (majordhome_pricing_equipment_types.equipment_category —
// ⚠️ PAS `category`, qui est la FAMILLE tarifaire « poeles/chaudieres/energie »
// et ne matche jamais le vocabulaire de `equipments.category` que compare
// techniciensEligibles). Une org sans PAC ne voit pas de chip PAC.
// ============================================================================
import { useMemo } from 'react';
import { usePricingData } from '@hooks/usePricing';
import { specialtyLabel } from './specialtyLabels';

/**
 * @param {{ value?: string[], onChange: (next: string[]) => void, disabled?: boolean }} props
 */
export function SpecialtiesEditor({ value = [], onChange, disabled }) {
  const { equipmentTypes } = usePricingData();
  const categories = useMemo(
    () => [...new Set((equipmentTypes || []).map((t) => t.equipment_category).filter(Boolean))].sort(),
    [equipmentTypes],
  );
  const toggle = (cat) => onChange(value.includes(cat) ? value.filter((c) => c !== cat) : [...value, cat]);

  return (
    <div className="flex flex-wrap items-center gap-1.5" title="Aucune compétence cochée = polyvalent (toutes les catégories)">
      {categories.map((cat) => {
        const on = value.includes(cat);
        return (
          <button
            key={cat}
            type="button"
            disabled={disabled}
            onClick={() => toggle(cat)}
            aria-pressed={on}
            className={`px-2 py-0.5 rounded-full text-xs border transition-colors disabled:opacity-50 ${on
              ? 'bg-primary-600 text-white border-primary-600'
              : 'bg-white text-secondary-600 border-secondary-300 hover:border-primary-400'}`}
          >
            {specialtyLabel(cat)}
          </button>
        );
      })}
      {value.length === 0 && <span className="text-xs text-secondary-400">polyvalent</span>}
    </div>
  );
}
