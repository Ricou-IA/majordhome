/**
 * EntretienPartsSection.jsx - Majord'home Artisan
 * ============================================================================
 * Détail des pièces de rechange d'un entretien (agrégées sur les certificats
 * parent + enfants via `item.parts_detail`), avec total TTC et toggle « Offert »
 * par pièce réservé aux Team Leader / Admin (geste commercial).
 *
 * - Le total affiché exclut les pièces offertes (recalcul local pour feedback live).
 * - Le toggle persiste via la RPC `certificat_set_piece_offert` (role-checké côté DB),
 *   en optimiste, puis invalide la liste entretien-SAV (carte + total).
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { Wrench } from 'lucide-react';
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

  const total = useMemo(
    () => parts.reduce((sum, p) => sum + (p.offert ? 0 : lineTotal(p)), 0),
    [parts],
  );

  if (!parts.length) return null;

  const toggleOffert = async (p) => {
    const key = pieceKey(p);
    const next = !p.offert;
    setPendingKey(key);
    // Optimiste
    setParts((prev) => prev.map((x) => (pieceKey(x) === key ? { ...x, offert: next } : x)));

    const { error } = await supabase.rpc('certificat_set_piece_offert', {
      p_intervention_id: p.intervention_id,
      p_piece_index: p.idx,
      p_offert: next,
    });

    setPendingKey(null);
    if (error) {
      // Revert
      setParts((prev) => prev.map((x) => (pieceKey(x) === key ? { ...x, offert: p.offert } : x)));
      toast.error("Impossible de modifier le statut « Offert »");
      return;
    }
    toast.success(next ? 'Pièce offerte' : '« Offert » retiré');
    if (orgId) queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
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
              {isTeamLeaderOrAbove && (
                <button
                  type="button"
                  onClick={() => toggleOffert(p)}
                  disabled={pendingKey === key}
                  className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors disabled:opacity-50 ${
                    p.offert
                      ? 'border-gray-200 text-gray-500 hover:bg-gray-50'
                      : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                  }`}
                  title={p.offert ? 'Annuler l’offert' : 'Offrir cette pièce'}
                >
                  {p.offert ? 'Annuler' : 'Offrir'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
