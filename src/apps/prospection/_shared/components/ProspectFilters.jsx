/**
 * ProspectFilters.jsx — Barre de filtres pour la liste prospects
 */

import { ListeChoix } from '@/components/ui/liste-choix';
import { Search, X } from 'lucide-react';

export default function ProspectFilters({ filters, onChange, module, statuses = [] }) {
  const handleChange = (key, value) => {
    onChange({ ...filters, [key]: value || null });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Recherche texte */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
        <input
          type="text"
          value={filters.search || ''}
          onChange={(e) => handleChange('search', e.target.value)}
          placeholder="Rechercher (nom, SIREN, ville...)"
          className="w-full pl-9 pr-8 py-2 border border-secondary-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#2196F3] focus:border-[#2196F3] outline-none transition-colors"
        />
        {filters.search && (
          <button
            type="button"
            onClick={() => handleChange('search', '')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-secondary-100 rounded"
          >
            <X className="w-3.5 h-3.5 text-secondary-400" />
          </button>
        )}
      </div>

      {/* Filtre statut */}
      <div className="min-w-[11rem]">
        <ListeChoix
          libelle="Statut"
          value={filters.statut || ''}
          onChange={(v) => handleChange('statut', v)}
          options={[
            { value: '', label: 'Tous les statuts' },
            ...statuses.map((s) => ({ value: s.key, label: s.label })),
          ]}
        />
      </div>

      {/* Filtre département */}
      <input
        type="text"
        value={filters.departement || ''}
        onChange={(e) => handleChange('departement', e.target.value)}
        placeholder="Dép."
        maxLength={3}
        className="w-20 px-3 py-2 border border-secondary-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#2196F3] outline-none"
      />

      {/* Filtre priorité (Cédants uniquement) */}
      {module === 'cedants' && (
        <div className="min-w-[9rem]">
          <ListeChoix
            libelle="Priorité"
            value={filters.priorite || ''}
            onChange={(v) => handleChange('priorite', v)}
            options={[
              { value: '', label: 'Priorité' },
              { value: 'A', label: 'Priorité A' },
              { value: 'B', label: 'Priorité B' },
            ]}
          />
        </div>
      )}

      {/* Bouton reset */}
      {(filters.search || filters.statut || filters.departement || filters.priorite) && (
        <button
          type="button"
          onClick={() => onChange({
            search: '',
            statut: null,
            departement: null,
            priorite: null,
            scoreMin: null,
            scoreMax: null,
            orderBy: 'created_at',
            ascending: false,
          })}
          className="px-3 py-2 text-sm text-secondary-600 hover:text-secondary-900 hover:bg-secondary-100 rounded-lg transition-colors"
        >
          Réinitialiser
        </button>
      )}
    </div>
  );
}
