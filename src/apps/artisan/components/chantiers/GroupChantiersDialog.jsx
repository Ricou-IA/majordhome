/**
 * GroupChantiersDialog.jsx — Majord'home Artisan
 * ============================================================================
 * « Grouper avec… » : d'autres chantiers du MÊME lead rejoignent celui-ci (devis, RDV,
 * réceptions), puis disparaissent. Aperçu par chantierSplit.resumeGroupement ; la RPC
 * chantier_group applique les mêmes règles (statut le plus avancé, vides complétés).
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { X, Loader2, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { formatEuro } from '@/lib/utils';
import { resumeGroupement } from '@/lib/chantierSplit';
import { useChantiers, useChantierMutations } from '@hooks/useChantiers';
import { getChantierStatusConfig, getChantierAmount } from '@services/chantiers.service';

export function GroupChantiersDialog({ chantier, onClose, onGrouped }) {
  const { organization } = useAuth();
  const { chantiers } = useChantiers(organization?.id);
  const { groupChantiers, isGrouping } = useChantierMutations();
  const [sourceIds, setSourceIds] = useState([]);

  const candidats = useMemo(
    () => chantiers.filter((c) => c.lead_id === chantier.lead_id && c.id !== chantier.id),
    [chantiers, chantier.lead_id, chantier.id],
  );
  const sources = candidats.filter((c) => sourceIds.includes(c.id));
  const apercu = resumeGroupement(chantier, sources);

  const handleGroup = async () => {
    if (sourceIds.length === 0) return;
    try {
      await groupChantiers(chantier.id, sourceIds);
      toast.success(sourceIds.length > 1 ? `${sourceIds.length} chantiers groupés` : 'Chantiers groupés');
      onGrouped?.();
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Impossible de grouper ces chantiers');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-12 pb-8">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[calc(100vh-6rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Layers className="w-4 h-4" /> Grouper avec…</h2>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-sm text-gray-600">Les chantiers cochés rejoignent « {chantier.label || 'ce chantier'} » (devis, jours d&apos;installation, réceptions) et disparaissent du kanban.</p>
          {candidats.length === 0 && <p className="text-sm text-gray-400">Aucun autre chantier sur ce lead.</p>}
          {candidats.map((c) => {
            const cfg = getChantierStatusConfig(c.chantier_status);
            return (
              <label key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 text-sm cursor-pointer">
                <input type="checkbox" checked={sourceIds.includes(c.id)}
                  onChange={() => setSourceIds((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]))} />
                <span className="font-medium text-gray-900 truncate">{c.label || 'Sans libellé'}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full text-white shrink-0" style={{ backgroundColor: cfg.color }}>{cfg.label}</span>
                <span className="ml-auto font-semibold tabular-nums shrink-0">{formatEuro(getChantierAmount(c))}</span>
              </label>
            );
          })}
          {sources.length > 0 && (
            <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 text-sm space-y-1">
              <p className="font-semibold text-gray-900">Résultat</p>
              <p className="text-gray-600">{formatEuro(apercu.montant)} · {apercu.devis} devis ({apercu.devisValides} validés) · statut « {getChantierStatusConfig(apercu.statut).label} »</p>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t bg-gray-50 rounded-b-xl flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-100">Annuler</button>
          <button type="button" onClick={handleGroup} disabled={sourceIds.length === 0 || isGrouping}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {isGrouping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
            Grouper
          </button>
        </div>
      </div>
    </div>
  );
}

export default GroupChantiersDialog;
