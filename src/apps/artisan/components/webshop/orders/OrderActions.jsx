/**
 * OrderActions — journal des envois d'une commande (e-mails client, ordre colis) + « Rejouer ».
 * Lecture : vue majordhome_webshop_order_actions (une ligne par envoi × événement × action).
 * Rejeu : edge webshop-process (`retry`) ; une action `sent` ne repart jamais.
 */
import { toast } from 'sonner';
import { Loader2, RotateCcw, Send } from 'lucide-react';
import {
  libelleAction, libelleEvenementAction, issueAction, peutRejouer, libelleErreurAction, actionBloquee,
} from '@/lib/webshop/orders';

const STATUS_TONES = {
  sent: 'bg-sky-100 text-sky-700',
  failed: 'bg-amber-100 text-amber-800',
  skipped: 'bg-secondary-100 text-secondary-600',
  pending: 'bg-secondary-100 text-secondary-600',
};

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const fmtDateTime = (iso) => (iso
  ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '');

export default function OrderActions({ actions, isLoading, error, onRetry, retryingId }) {
  const handleRetry = async (a) => {
    try {
      const res = await onRetry(a.id);
      const report = res?.action;
      if (report?.status === 'sent') toast.success(`${cap(libelleAction(a.action))} envoyé`);
      else toast.warning(`${cap(libelleAction(a.action))} ${report ? issueAction(report) : 'non envoyé'}`);
    } catch (err) {
      toast.error(`Rejeu refusé : ${err.message}`);
    }
  };

  return (
    <section className="py-4 border-b border-secondary-100">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-secondary-400 mb-2">
        <Send className="w-3.5 h-3.5" /> Envois
      </h3>
      {isLoading && <Loader2 className="w-4 h-4 animate-spin text-secondary-400" />}
      {error && <p className="text-sm text-red-600">Journal des envois illisible : {error.message}</p>}
      {!isLoading && !error && actions.length === 0 && (
        <p className="text-sm text-secondary-400">Aucun envoi pour cette commande.</p>
      )}
      <ul className="space-y-2">
        {actions.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="text-secondary-800">
                {cap(libelleAction(a.action))}
                <span className="text-secondary-400"> · {a.envoi} · {libelleEvenementAction(a.evenement)}</span>
              </p>
              <p className="text-xs text-secondary-500 truncate">
                {[a.recipient, fmtDateTime(a.updated_at)].filter(Boolean).join(' · ')}
              </p>
              {a.status !== 'sent' && a.error_code && (
                <p className="text-xs text-amber-800">
                  {libelleErreurAction(a.error_code)}
                  {a.error_message && a.error_message !== a.error_code && <span className="text-secondary-500"> — {a.error_message}</span>}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${actionBloquee(a) ? STATUS_TONES.failed : (STATUS_TONES[a.status] ?? STATUS_TONES.pending)}`}>
                {issueAction({ status: a.status, error_code: null, updated_at: a.updated_at })}
              </span>
              {peutRejouer(a) && (
                <button
                  type="button"
                  disabled={retryingId === a.id}
                  onClick={() => handleRetry(a)}
                  className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline disabled:opacity-50"
                >
                  {retryingId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Rejouer
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
