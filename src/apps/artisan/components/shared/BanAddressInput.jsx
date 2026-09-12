// src/apps/artisan/components/shared/BanAddressInput.jsx
// ============================================================================
// Saisie d'adresse avec suggestions BAN (api-adresse.data.gouv.fr).
//
// Une suggestion choisie remplit adresse / CP / ville ET remonte `location`
// ({ lat, lng, precision }). Si l'adresse exacte n'existe pas, l'utilisateur
// garde son texte et « localise à la commune » : location = centroïde,
// précision « municipality » — suffisant pour les tournées (décision produit
// 2026-09-12 : « le code postal suffit dans 99 % des cas »).
//
// Le composant ne fait aucun appel réseau lui-même : geocoding.service.js.
// Toute modification manuelle d'un champ efface `location` (l'appelant ne
// doit jamais enregistrer des coordonnées qui ne correspondent plus au texte).
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { MapPin, Check } from 'lucide-react';
import { suggestAddresses, geocodeCommune } from '@services/geocoding.service';
import { useDebounce } from '@hooks/useDebounce';
import { FormField, TextInput } from '@apps/artisan/components/FormFields';

const PRECISION_LABEL = {
  housenumber: 'adresse exacte',
  street: 'rue',
  locality: 'lieu-dit',
  municipality: 'commune',
};

/**
 * @param {object} props
 * @param {{ address?: string, postalCode?: string, city?: string, location?: { lat, lng, precision }|null }} props.value
 * @param {(next: { address: string, postalCode: string, city: string, location: object|null }) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.showLocation=true]  masquer l'état « localisée » (leads : le géocodage reste en aval)
 */
export function BanAddressInput({ value, onChange, disabled, showLocation = true }) {
  const address = value?.address || '';
  const postalCode = value?.postalCode || '';
  const city = value?.city || '';
  const location = value?.location || null;

  const [suggestions, setSuggestions] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [localisation, setLocalisation] = useState(false);
  const debounced = useDebounce(address, 300);
  const boite = useRef(null);

  useEffect(() => {
    let actif = true;
    if (!ouvert || debounced.trim().length < 3) { setSuggestions([]); return undefined; }
    suggestAddresses(debounced, { postcode: postalCode }).then((s) => { if (actif) setSuggestions(s); });
    return () => { actif = false; };
  }, [debounced, ouvert, postalCode]);

  useEffect(() => {
    const fermer = (e) => { if (boite.current && !boite.current.contains(e.target)) setOuvert(false); };
    document.addEventListener('mousedown', fermer);
    return () => document.removeEventListener('mousedown', fermer);
  }, []);

  const emettre = (patch) => onChange({ address, postalCode, city, location, ...patch });

  const choisir = (s) => {
    setOuvert(false);
    emettre({
      // Une commune choisie ne remplace pas le texte de l'adresse (l'utilisateur
      // garde ce qu'il a tapé) ; une voie/un numéro, si.
      address: s.type === 'municipality' ? address : s.name,
      postalCode: s.postcode || postalCode,
      city: s.city || city,
      location: { lat: s.lat, lng: s.lng, precision: s.type },
    });
  };

  const localiserCommune = async () => {
    setLocalisation(true);
    try {
      const c = await geocodeCommune(postalCode, city);
      if (!c) return;
      setOuvert(false);
      emettre({
        postalCode: c.postcode || postalCode,
        city: c.city || city,
        location: { lat: c.lat, lng: c.lng, precision: 'municipality' },
      });
    } finally {
      setLocalisation(false);
    }
  };

  return (
    <div ref={boite} className="space-y-4">
      <FormField label="Adresse">
        <div className="relative">
          <TextInput
            value={address}
            onChange={(v) => { setOuvert(true); emettre({ address: v, location: null }); }}
            onFocus={() => setOuvert(true)}
            placeholder="12 rue des Lilas"
            disabled={disabled}
          />
          {ouvert && suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full bg-white border border-secondary-200 rounded-md shadow-lg max-h-56 overflow-auto text-sm">
              {suggestions.map((s) => (
                <li key={`${s.citycode}-${s.label}`}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-secondary-50 flex items-center gap-2"
                    onClick={() => choisir(s)}
                  >
                    <MapPin className="w-3.5 h-3.5 text-secondary-400 shrink-0" />
                    <span className="truncate">{s.label}</span>
                    <span className="ml-auto text-xs text-secondary-400 shrink-0">{PRECISION_LABEL[s.type] || s.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Code postal">
          <TextInput
            value={postalCode}
            onChange={(v) => emettre({ postalCode: v.replace(/\D/g, '').slice(0, 5), location: null })}
            placeholder="81100"
            disabled={disabled}
          />
        </FormField>
        <FormField label="Ville">
          <TextInput
            value={city}
            onChange={(v) => emettre({ city: v, location: null })}
            placeholder="Castres"
            disabled={disabled}
          />
        </FormField>
      </div>
      {showLocation && (
        <div className="flex items-center justify-between text-xs">
          {location ? (
            <span className="inline-flex items-center gap-1 text-green-700">
              <Check className="w-3.5 h-3.5" />
              Localisée ({PRECISION_LABEL[location.precision] || location.precision})
            </span>
          ) : (
            <span className="text-amber-700">Adresse non localisée</span>
          )}
          {!location && (postalCode || city) && (
            <button
              type="button"
              disabled={disabled || localisation}
              onClick={localiserCommune}
              className="text-primary-700 hover:underline disabled:opacity-50"
            >
              {localisation ? 'Recherche…' : 'Localiser à la commune'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
