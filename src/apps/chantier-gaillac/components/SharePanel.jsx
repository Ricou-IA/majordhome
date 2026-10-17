import { useState } from 'react';
import { toast } from 'sonner';
import { Share2, Copy, RefreshCw, Ban, Loader2, ChevronDown } from 'lucide-react';
import { useChantierGaillacPartageAdmin } from '../useChantierGaillac';

const shareUrl = (token) => `${window.location.origin}/gaillac/${token}`;

const btn = 'inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5C542] disabled:opacity-50';

/**
 * Admin : lien externe en lecture seule (n°, site, action, thème, technicien, journée, statut).
 * Un seul lien actif ; régénérer coupe l'ancien.
 */
export default function SharePanel({ orgId }) {
  const [open, setOpen] = useState(false);
  const { token, isLoading, gerer } = useChantierGaillacPartageAdmin(orgId, open);

  const run = async (action, ok) => {
    try {
      await gerer.mutateAsync(action);
      toast.success(ok);
    } catch (e) {
      toast.error(`Partage : ${e?.message || 'opération refusée'}`);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      toast.success('Lien copié');
    } catch {
      toast.error('Copie impossible : sélectionnez le lien à la main');
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-800"
      >
        <span className="inline-flex items-center gap-2"><Share2 className="h-4 w-4 text-[#1565C0]" aria-hidden />Partage externe (lecture seule)</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-200 px-4 py-3 text-sm">
          <p className="text-slate-600">
            Le lien ouvre le suivi sans compte : n°, site, action, thème, technicien, journée et statut.
            Durées, achats, observations et commentaires terrain ne sont jamais envoyés.
          </p>
          {isLoading ? (
            <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Chargement…</p>
          ) : token ? (
            <>
              <input
                readOnly
                value={shareUrl(token)}
                onFocus={(e) => e.target.select()}
                aria-label="Lien de partage"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-2 py-2 font-mono text-xs"
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copy} className={`${btn} border-[#1565C0] bg-[#1565C0] text-white`}>
                  <Copy className="h-4 w-4" aria-hidden />Copier le lien
                </button>
                <button type="button" disabled={gerer.isPending} onClick={() => run('generer', 'Nouveau lien créé, l\'ancien ne fonctionne plus')} className={`${btn} border-slate-300 text-slate-700`}>
                  <RefreshCw className="h-4 w-4" aria-hidden />Régénérer
                </button>
                <button type="button" disabled={gerer.isPending} onClick={() => run('revoquer', 'Lien révoqué')} className={`${btn} border-slate-300 text-slate-700`}>
                  <Ban className="h-4 w-4" aria-hidden />Révoquer
                </button>
              </div>
            </>
          ) : (
            <button type="button" disabled={gerer.isPending} onClick={() => run('generer', 'Lien de partage créé')} className={`${btn} border-[#1565C0] bg-[#1565C0] text-white`}>
              <Share2 className="h-4 w-4" aria-hidden />Créer un lien de partage
            </button>
          )}
        </div>
      )}
    </section>
  );
}
