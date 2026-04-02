/**
 * FormFields.jsx - Composants formulaire partagés
 * ============================================================================
 * Utilisé par ClientDetail, LeadModal, EventModal, CreateContractModal
 * Tokens projet : secondary-* (gris), primary-* (bleu)
 * ============================================================================
 */

import { AlertTriangle } from 'lucide-react';
import { formatPhoneNumber } from '@/lib/utils';

// Classes de base réutilisables
const baseClass =
  'w-full px-3 py-2 border rounded-lg text-sm outline-none transition-colors';

const enabledClass =
  'bg-white border-secondary-300 text-secondary-900 focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

const disabledClass =
  'bg-secondary-50 border-secondary-200 text-secondary-600 cursor-not-allowed';

export const inputClass = `${baseClass} ${enabledClass} disabled:bg-secondary-50 disabled:border-secondary-200 disabled:text-secondary-600 disabled:cursor-not-allowed`;

export const selectClass = `${inputClass} appearance-none`;

/**
 * FormField — wrapper label + children + erreur optionnelle
 */
export function FormField({ label, required = false, error = null, className = '', children }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-sm font-medium text-secondary-700">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {error && (
        <p className="text-sm text-red-600 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * TextInput — input contrôlé (text, date, number, email)
 */
export function TextInput({ value, onChange, placeholder, type = 'text', disabled = false, autoComplete = 'off', ...props }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={autoComplete}
      className={`${baseClass} ${disabled ? disabledClass : enabledClass}`}
      {...props}
    />
  );
}

/**
 * PhoneInput — input téléphone avec formatage FR (06 12 34 56 78)
 */
export function PhoneInput({ value, onChange, placeholder = '06 12 34 56 78', disabled = false }) {
  return (
    <input
      type="tel"
      value={value || ''}
      onChange={(e) => onChange(formatPhoneNumber(e.target.value))}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
      maxLength={14}
      className={`${baseClass} ${disabled ? disabledClass : enabledClass}`}
    />
  );
}

/**
 * SelectInput — select contrôlé avec options {value, label}[]
 */
export function SelectInput({ value, onChange, options, placeholder, disabled = false, children }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      className={`${baseClass} ${disabled ? disabledClass : enabledClass}`}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options
        ? options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))
        : children}
    </select>
  );
}

/**
 * TextArea — textarea contrôlée
 */
export function TextArea({ value, onChange, placeholder, rows = 3, disabled = false }) {
  return (
    <textarea
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      className={`${baseClass} resize-none ${disabled ? disabledClass : enabledClass}`}
    />
  );
}

/**
 * SectionTitle — titre de section uppercase
 */
export function SectionTitle({ children }) {
  return (
    <h3 className="text-xs font-bold text-secondary-400 uppercase tracking-widest mt-8 mb-3 pt-4 border-t border-secondary-200 first:mt-0 first:pt-0 first:border-t-0">
      {children}
    </h3>
  );
}
