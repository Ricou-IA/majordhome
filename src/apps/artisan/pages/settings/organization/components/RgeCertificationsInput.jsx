// src/apps/artisan/pages/settings/organization/components/RgeCertificationsInput.jsx
import { useState, useRef } from 'react';
import { X } from 'lucide-react';

const RGE_SUGGESTIONS = [
  'Qualibat',
  'QualiPAC',
  'QualiBois',
  'QualiPV',
  'QualiSol',
  'QualiForage',
  'Eco Artisan',
  'RGE Études',
];

const MAX_ITEM_LENGTH = 30;
const MAX_ITEMS = 20;

/**
 * Input chips pour settings.rge_certifications (array de strings).
 * Autocomplete sur RGE_SUGGESTIONS + saisie libre.
 *
 * @param {Object} props
 * @param {string[]} props.value - liste actuelle de certifications
 * @param {Function} props.onChange - (newList: string[]) => void
 * @param {boolean} [props.disabled]
 */
export default function RgeCertificationsInput({ value = [], onChange, disabled = false }) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);

  const suggestions = RGE_SUGGESTIONS.filter(
    (s) => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s)
  );

  const addItem = (item) => {
    const trimmed = item.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_ITEM_LENGTH) return;
    if (value.includes(trimmed)) return;
    if (value.length >= MAX_ITEMS) return;
    onChange([...value, trimmed]);
    setInput('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const removeItem = (item) => {
    onChange(value.filter((v) => v !== item));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem(input);
    } else if (e.key === 'Backspace' && !input && value.length) {
      removeItem(value[value.length - 1]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 min-h-[34px]">
        {value.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 px-2 py-1 bg-primary-100 text-primary-700 text-xs font-medium rounded-md"
          >
            {item}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeItem(item)}
                className="hover:text-primary-900"
                aria-label={`Retirer ${item}`}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
      </div>

      {!disabled && value.length < MAX_ITEMS && (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={handleKeyDown}
            maxLength={MAX_ITEM_LENGTH}
            placeholder="Tape une certification..."
            className="w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full bg-white border border-secondary-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map((s) => (
                <li
                  key={s}
                  className="px-3 py-2 text-sm hover:bg-secondary-50 cursor-pointer"
                  onMouseDown={() => addItem(s)}
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {value.length >= MAX_ITEMS && (
        <p className="text-xs text-secondary-500">
          Limite atteinte ({MAX_ITEMS} certifications maximum).
        </p>
      )}
    </div>
  );
}
