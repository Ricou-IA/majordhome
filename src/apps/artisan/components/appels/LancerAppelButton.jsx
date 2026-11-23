import { useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
      {/* Action secondaire : « Nouveau contrat » reste la seule action principale de la page. */}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        disabled={disabled}
        // L'infobulle « Aucune carte avec téléphone » doit rester lisible sur le bouton désactivé.
        className="disabled:pointer-events-auto disabled:cursor-not-allowed"
        title={disabled ? 'Aucune carte avec téléphone' : `Appeler ${callable.length} contact(s)`}
      >
        <PhoneCall className="h-4 w-4" />
        Lancer l&apos;appel ({callable.length})
      </Button>
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
