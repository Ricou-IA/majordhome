/**
 * DetachChantierDialog.jsx — Majord'home Artisan
 * ============================================================================
 * « Détacher en chantier distinct » : des devis (+ jours d'installation, + commande)
 * quittent ce chantier pour une nouvelle carte du même lead. Aperçu par le module pur
 * chantierSplit (mêmes règles que la RPC chantier_detach) ; rien n'est écrit avant « Détacher ».
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { X, Loader2, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import { formatEuro } from '@/lib/utils';
import { resumeDetachement, commandeSuitParDefaut } from '@/lib/chantierSplit';
import { useChantierMutations } from '@hooks/useChantiers';
import { FormField, TextInput } from '@apps/artisan/components/FormFields';

function dateFR(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function DetachChantierDialog({ chantier, quotes = [], appointments = [], onClose, onDetached }) {
  const { detachChantier, isDetaching } = useChantierMutations();
  const [quoteIds, setQuoteIds] = useState([]);
  const [appointmentIds, setAppointmentIds] = useState([]);
  const [movePlannedOrder, setMovePlannedOrder] = useState(null); // null = suit le défaut
  const [label, setLabel] = useState('');

  const plannedOrder = { teamSize: chantier?.planned_team_size ?? null, days: chantier?.planned_days ?? null };
  const resume = useMemo(
    () => resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds, appointmentIds }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plannedOrder est recréé à chaque rendu : on dépend de ses valeurs
    [quotes, appointments, plannedOrder.teamSize, plannedOrder.days, quoteIds, appointmentIds],
  );
  const moveByDefault = commandeSuitParDefaut(plannedOrder, resume.nouveau.jours);
  const move = movePlannedOrder ?? moveByDefault;
  const hasOrder = Boolean(plannedOrder.teamSize || plannedOrder.days);

  const toggle = (setter) => (id) => setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleDetach = async () => {
    if (!resume.ok) return;
    try {
      await detachChantier({ chantierId: chantier.id, quoteIds, appointmentIds, movePlannedOrder: hasOrder && move, label: label.trim() || null });
      toast.success('Chantier détaché');
      onDetached?.();
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Impossible de détacher ce chantier');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-12 pb-8">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[calc(100vh-6rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Scissors className="w-4 h-4" /> Détacher en chantier distinct</h2>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section className="space-y-2">
            <p className="text-xs font-semibold text-secondary-500 uppercase tracking-wider">Devis qui partent</p>
            {quotes.map((q) => (
              <label key={q.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm cursor-pointer ${q.is_validated ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-200'}`}>
                <input type="checkbox" checked={quoteIds.includes(q.id)} onChange={() => toggle(setQuoteIds)(q.id)} />
                <span className="font-medium text-gray-900">{q.quote_number_pl || q.quote_label}</span>
                {!q.is_validated && <span className="text-gray-400">· non validé</span>}
                <span className="ml-auto font-semibold tabular-nums">{formatEuro(Number(q.quote_amount_ht) || 0)}</span>
              </label>
            ))}
          </section>

          {appointments.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-secondary-500 uppercase tracking-wider">Jours d’installation qui partent</p>
              {appointments.map((a) => (
                <label key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 text-sm cursor-pointer">
                  <input type="checkbox" checked={appointmentIds.includes(a.id)} onChange={() => toggle(setAppointmentIds)(a.id)} />
                  <span className="font-medium text-gray-900">{dateFR(a.scheduled_date)}</span>
                  <span className="text-gray-500">{(a.scheduled_start || '').slice(0, 5)}{a.scheduled_end ? ` – ${a.scheduled_end.slice(0, 5)}` : ''}</span>
                  <span className="ml-auto text-xs text-gray-500">{(a.technician_ids || []).length} pers.</span>
                </label>
              ))}
            </section>
          )}

          {hasOrder && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={move} onChange={(e) => setMovePlannedOrder(e.target.checked)} />
              La commande {plannedOrder.teamSize ? `${plannedOrder.teamSize} pers.` : ''}{plannedOrder.teamSize && plannedOrder.days ? ' × ' : ''}{plannedOrder.days ? `${plannedOrder.days} j` : ''} part avec le nouveau chantier
            </label>
          )}

          <FormField label="Libellé du nouveau chantier (facultatif)">
            <TextInput value={label} onChange={setLabel} placeholder="Repris de l'objet du devis si vide" />
          </FormField>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {[['Chantier d’origine', resume.origine], ['Nouveau chantier', resume.nouveau]].map(([titre, r]) => (
              <div key={titre} className="p-3 rounded-lg border border-gray-200 bg-gray-50 space-y-1">
                <p className="font-semibold text-gray-900">{titre}</p>
                <p className="text-gray-600">{formatEuro(r.montant)} · {r.devis} devis · {r.jours} jour{r.jours > 1 ? 's' : ''}</p>
              </div>
            ))}
          </div>
          {resume.erreurs.length > 0 && (
            <ul className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
              {resume.erreurs.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t bg-gray-50 rounded-b-xl flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-100">Annuler</button>
          <button type="button" onClick={handleDetach} disabled={!resume.ok || isDetaching}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {isDetaching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
            Détacher
          </button>
        </div>
      </div>
    </div>
  );
}

export default DetachChantierDialog;
