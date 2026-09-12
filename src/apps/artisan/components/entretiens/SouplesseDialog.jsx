// src/apps/artisan/components/entretiens/SouplesseDialog.jsx
// ============================================================================
// Dernière étape de la pose d'un créneau proposé (CTA « Trouver le créneau
// optimisé ») : qualifier la souplesse du RDV et montrer ce que le client va
// entendre — heure provisoire + fenêtre — et, si le moteur a dû glisser un
// voisin, le dire noir sur blanc avant que les deux écritures partent.
// ============================================================================
import { useState } from 'react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { SouplesseSelect } from '@/apps/artisan/components/shared/SouplesseSelect';
import { formatDateShortFR } from '@/lib/utils';
import { phraseAnnonce } from '@/lib/souplesse';

const minutesVersHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {{ date, startTime, endTime, technicianNom?, decalages?: Array }} props.slot
 * @param {number} [props.defaut=30]  souplesse par défaut de l'org
 * @param {(choix: { timeFlexMinutes: number }) => void} props.onConfirm
 * @param {() => void} props.onCancel
 * @param {boolean} [props.loading]
 */
export function SouplesseDialog({ open, slot, defaut = 30, onConfirm, onCancel, loading = false }) {
  const [flex, setFlex] = useState(null);
  const effectif = flex ?? defaut;
  if (!slot) return null;
  const decalages = slot.decalages || [];

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => { if (!o) onCancel(); }}
      title="Souplesse du rendez-vous"
      description="Jusqu’où ce rendez-vous peut-il bouger pour améliorer la tournée ? Un rendez-vous figé est une exigence du client."
      confirmLabel="Poser le rendez-vous"
      cancelLabel="Annuler"
      variant="default"
      loading={loading}
      onConfirm={() => onConfirm({ timeFlexMinutes: effectif })}
    >
      <div className="mt-4 space-y-3">
        <SouplesseSelect value={flex} onChange={setFlex} defaut={defaut} />
        <p className="text-sm text-gray-700">
          Vous lui annoncez : <span className="font-medium">{phraseAnnonce(slot, effectif, formatDateShortFR(slot.date))}</span>
          {slot.technicianNom ? ` — ${slot.technicianNom}` : ''}
        </p>
        {decalages.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {decalages.map((d) => (
              <p key={d.id}>
                {d.label} passera de {minutesVersHHMM(d.debutMinutesAvant)} à {minutesVersHHMM(d.debutMinutesApres)}
                {d.tolerance?.flex ? ` (dans sa tolérance ±${d.tolerance.flex} min)` : ''} — à lui annoncer.
              </p>
            ))}
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
}
