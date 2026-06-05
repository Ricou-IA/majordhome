/**
 * EntretienPartsSection.jsx - Majord'home Artisan
 * ============================================================================
 * Détail des pièces de rechange d'un entretien (agrégées sur les certificats
 * parent + enfants via `item.parts_detail`), avec total TTC et, pour les
 * Team Leader / Admin, l'édition de la liste :
 *   - toggle « Offert » par pièce (geste commercial, exclue du total)
 *   - suppression d'une pièce (croix rouge, confirmation inline)
 *
 * Les deux persistent via RPC role-checkées et retirent/annotent l'élément dans
 * `certificats.pieces_remplacees` → un certificat PDF régénéré reflète la liste.
 * Après chaque mutation on re-synchronise `parts_detail` depuis la vue (les `idx`
 * d'origine se décalent après une suppression) puis on invalide la liste kanban.
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { Wrench, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { formatEuro } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';
import { entretienSavKeys } from '@hooks/cacheKeys';

const pieceKey = (p) => `${p.intervention_id}:${p.idx}`;
const lineTotal = (p) => (Number(p.prix_ht) || 0) * (Number(p.quantite) || 1);

export function EntretienPartsSection({ item, orgId }) {
  const { isTeamLeaderOrAbove } = useAuth();
  const queryClient = useQueryClient();
  const [parts, setParts] = useState(() => item.parts_detail || []);
  const [pendingKey, setPendingKey] = useState(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState(null);

  const total = useMemo(
    () => parts.reduce((sum, p) => sum + (p.offert ? 0 : lineTotal(p)), 0),
    [parts],
  );

  if (!parts.length) return null;

  const busy = pendingKey !== null;

  // Recharge parts_detail frais depuis la vue : les `idx` sont recalculés (ORDINALITY)
  // donc canoniques après une suppression qui décale les positions du tableau.
  const refreshParts = async () => {
    const { data } = await supabase
      .from('majordhome_entretien_sav')
      .select('parts_detail')
      .eq('id', item.id)
      .maybeSingle();
    if (data) setParts(data.parts_detail || []);
  };

  const afterMutation = async () => {
    await refreshParts();
    if (orgId) queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
  };

  const toggleOffert = async (p) => {
    const key = pieceKey(p);
    const next = !p.offert;
    setPendingKey(key);
    setParts((prev) => prev.map((x) => (pieceKey(x) === key ? { ...x, offert: next } : x)));

    const { error } = await supabase.rpc('certificat_set_piece_offert', {
      p_intervention_id: p.intervention_id,
      p_piece_index: p.idx,
      p_offert: next,
    });

    if (error) {
      setParts((prev) => prev.map((x) => (pieceKey(x) === key ? { ...x, offert: p.offert } : x)));
      toast.error("Impossible de modifier le statut « Offert »");
      setPendingKey(null);
      return;
    }
    toast.success(next ? 'Pièce offerte' : '« Offert » retiré');
    await afterMutation();
    setPendingKey(null);
  };

  const confirmDelete = async (p) => {
    const key = pieceKey(p);
    setConfirmDeleteKey(null);
    setPendingKey(key);
    const prevParts = parts;
    setParts((prev) => prev.filter((x) => pieceKey(x) !== key));

    const { error } = await supabase.rpc('certificat_delete_piece', {
      p_intervention_id: p.intervention_id,
      p_piece_index: p.idx,
    });

    if (error) {
      setParts(prevParts);
      toast.error('Impossible de supprimer la pièce');
      setPendingKey(null);
      return;
    }
    toast.success('Pièce supprimée');
    await afterMutation();
    setPendingKey(null);
  };

  return (
    <div className="text-sm text-gray-500">
      <div className="flex items-center gap-2">
        <Wrench className="w-4 h-4 text-gray-400" />
        <span>Pièces de rechange</span>
        <span className="ml-auto text-sm font-semibold text-emerald-700">{formatEuro(total)}</span>
      </div>
      <ul className="mt-1 ml-6 space-y-1">
        {parts.map((p) => {
          const key = pieceKey(p);
          const confirming = confirmDeleteKey === key;
          return (
            <li key={key} className="flex items-center gap-2 text-xs">
              <span className={`truncate ${p.offert ? 'line-through text-gray-400' : 'text-gray-600'}`}>
                {p.designation || 'Pièce'}
                {Number(p.quantite) > 1 ? ` ×${p.quantite}` : ''}
              </span>
              {p.offert && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium flex-shrink-0">
                  Offert
                </span>
              )}
              <span className={`ml-auto flex-shrink-0 ${p.offert ? 'line-through text-gray-400' : 'text-gray-600'}`}>
                {formatEuro(lineTotal(p))}
              </span>

              {isTeamLeaderOrAbove && !confirming && (
                <>
                  <button
                    type="button"
                    onClick={() => toggleOffert(p)}
                    disabled={busy}
                    className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors disabled:opacity-40 ${
                      p.offert
                        ? 'border-gray-200 text-gray-500 hover:bg-gray-50'
                        : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                    }`}
                    title={p.offert ? 'Annuler l’offert' : 'Offrir cette pièce'}
                  >
                    {p.offert ? 'Annuler' : 'Offrir'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteKey(key)}
                    disabled={busy}
                    className="flex-shrink-0 p-0.5 rounded text-red-500 hover:bg-red-50 disabled:opacity-40"
                    title="Supprimer cette pièce"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              )}

              {isTeamLeaderOrAbove && confirming && (
                <span className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[10px] text-gray-500">Supprimer ?</span>
                  <button
                    type="button"
                    onClick={() => confirmDelete(p)}
                    disabled={busy}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
                  >
                    Oui
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteKey(null)}
                    disabled={busy}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                  >
                    Non
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
