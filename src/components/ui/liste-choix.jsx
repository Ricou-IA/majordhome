import { Combobox } from './combobox';
import { cn } from '@lib/utils';
import { useDeviceClass } from '@hooks/useDeviceClass';

/**
 * Liste déroulante des écrans métier (terrain compris) : un `<select>` natif sur téléphone
 * (sélecteur du système, plus sûr au doigt), le `Combobox` avec recherche ailleurs. Même API
 * que `Combobox` ; `onChange` reçoit `String(option.value ?? '')` dans les deux cas.
 *
 * @param {Object} props
 * @param {unknown} props.value
 * @param {(valeur: string) => void} props.onChange
 * @param {Array<{ value: unknown, label: string, disabled?: boolean }>} props.options
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 * @param {string} [props.libelle]            nom lu par un lecteur d'écran
 * @param {string} [props.id]
 * @param {string} [props.className]          classes du déclencheur (Combobox)
 * @param {string} [props.selectClassName]    classes du `<select>` natif (téléphone)
 * @param {boolean} [props.required]          `required` natif sur téléphone, `aria-required` ailleurs :
 *   la vérification reste à l'appelant.
 */
export function ListeChoix({ value, onChange, options = [], placeholder, disabled = false, libelle, id, className, selectClassName, required = false }) {
  const { isPhone } = useDeviceClass();

  if (!isPhone) {
    return (
      <Combobox
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        libelle={libelle}
        id={id}
        className={className}
        required={required}
      />
    );
  }

  return (
    <select
      id={id}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => onChange?.(e.target.value)}
      disabled={disabled}
      required={required}
      aria-label={libelle}
      className={cn(
        'min-h-[44px] w-full rounded-lg border border-secondary-300 bg-white px-3 text-sm text-secondary-900 outline-none',
        'focus-visible:border-primary-600 focus-visible:shadow-ring disabled:cursor-not-allowed disabled:bg-secondary-50 disabled:text-secondary-600',
        selectClassName,
      )}
    >
      {/* Liste vide : le texte d'attente s'affiche, comme le déclencheur du Combobox. */}
      {options.length === 0 && placeholder && <option value="">{placeholder}</option>}
      {options.map((o, i) => (
        <option key={`${String(o.value ?? '')}-${i}`} value={String(o.value ?? '')} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default ListeChoix;
