// src/apps/thermique/components/wizard/MateriauPicker.jsx
// Sélecteur de matériau cherchable (autocomplete sur materiaux.json, Th-U) — utilisé par le
// composeur de paroi pour ajouter une couche. onSelect remonte { nom, lambda, famille }.
import { useState } from 'react';
import { Search } from 'lucide-react';
import { materiaux } from '../../data';
import { chercheMateriaux } from '../../lib/composeurParois';

export default function MateriauPicker({ famille = null, onSelect, placeholder = 'Chercher un matériau…' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const results = open ? chercheMateriaux(materiaux, query, famille) : [];
  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-4 h-4 text-secondary-400 absolute left-2 top-1/2 -translate-y-1/2" />
        <input
          className="w-full pl-8 pr-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        />
      </div>
      {results.length > 0 && (
        <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-secondary-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {results.map((m, i) => (
            <li key={`${m.nom}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onSelect(m); setQuery(''); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary-50"
              >
                <span className="font-medium text-secondary-900">{m.nom}</span>
                <span className="text-secondary-500 text-xs"> · {m.famille} · λ {m.lambda}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
