import { useState } from 'react';
import { X, UserPlus } from 'lucide-react';

/**
 * Formulaire saisie minimale d'un nouveau prospect.
 * Enregistré APRÈS le vocal — pour M1 c'est juste un capture rapide.
 */
export default function NewProspectForm({ onClose, onSubmit }) {
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');

  const canSubmit = lastName.trim().length > 0 && phone.trim().length >= 8;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      last_name: lastName.trim().toUpperCase(),
      first_name: firstName.trim() || null,
      phone: phone.trim(),
      city: city.trim() || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-secondary-900 flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="p-2 -ml-2 rounded-lg hover:bg-white/10 transition"
        >
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-base font-semibold flex-1">Nouveau prospect</h2>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 py-6 space-y-4 max-w-md mx-auto w-full">
        <div className="text-secondary-400 text-sm">
          Saisis le minimum pour identifier le prospect — tu pourras compléter plus tard.
        </div>

        <Field label="Nom *" value={lastName} onChange={setLastName} placeholder="DUPONT" autoFocus autoCapitalize="characters" />
        <Field label="Prénom" value={firstName} onChange={setFirstName} placeholder="Sophie" />
        <Field
          label="Téléphone *"
          value={phone}
          onChange={setPhone}
          placeholder="06 12 34 56 78"
          inputMode="tel"
          type="tel"
        />
        <Field label="Ville" value={city} onChange={setCity} placeholder="Albi" />

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full mt-6 py-3.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium transition disabled:bg-white/10 disabled:text-secondary-500 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <UserPlus className="w-4 h-4" />
          Continuer vers l'enregistrement
        </button>

        <p className="text-secondary-500 text-xs text-center">
          Le prospect sera créé en base APRÈS l'envoi du vocal.
        </p>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, ...rest }) {
  return (
    <label className="block">
      <span className="block text-secondary-300 text-sm mb-1.5">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-secondary-500 focus:outline-none focus:border-orange-500/50 focus:bg-white/10"
        {...rest}
      />
    </label>
  );
}
