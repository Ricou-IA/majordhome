import { useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { PhoningPanel } from './PhoningPanel';

/**
 * Bouton affiché dans le header de la colonne "À planifier".
 * @param {{ items: Array, orgId: string }} props - items = cartes de la colonne
 */
export function LancerAppelButton({ items, orgId }) {
  const [open, setOpen] = useState(false);
  const callable = (items || []).filter((i) => i.client_phone);
  const disabled = callable.length === 0;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        title={disabled ? 'Aucune carte avec téléphone' : `Appeler ${callable.length} contact(s)`}
      >
        <PhoneCall className="h-4 w-4" />
        Lancer l&apos;appel ({callable.length})
      </button>
      {open && (
        <PhoningPanel
          orgId={orgId}
          contacts={callable.map((i) => ({
            id: i.id,
            phone: i.client_phone,
            name: i.client_name || `${i.client_last_name || ''} ${i.client_first_name || ''}`.trim(),
          }))}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
