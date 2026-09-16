/**
 * MergeLeadDialog.jsx — « Fusionner un doublon dans cette carte »
 * ============================================================================
 * God-mode org_admin (même posture que la corbeille rouge de la fiche lead).
 * La carte OUVERTE est le survivant ; l'admin choisit la carte à absorber parmi
 * les doublons probables (même client Majord'home, téléphone, email, nom+prénom
 * — filet partagé findPotentialDuplicates), voit ce qui sera transféré, confirme.
 *
 * Tout se passe côté DB (RPC lead_merge, 2026-09-16) : re-parentage complet,
 * complément des champs vides du survivant, soft delete de l'absorbé avec
 * instantané dans une activité `lead_merged` (réversible à la main).
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GitMerge } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { leadsService } from '@services/leads.service';
import { useLeadMutations } from '@hooks/useLeads';
import { formatDateShortFR } from '@/lib/utils';

const REASON_LABELS = {
  client: 'même client',
  phone: 'même téléphone',
  email: 'même email',
  name: 'même nom',
};

/** Décompte de ce que porte la carte à absorber (devis PL actifs, RDV, activités). */
async function countAbsorbedLinks(leadId) {
  const head = { count: 'exact', head: true };
  const [quotes, appts, activities] = await Promise.all([
    supabase.from('majordhome_lead_pennylane_quotes').select('id', head).eq('lead_id', leadId).is('ejected_at', null),
    supabase.from('majordhome_appointments').select('id', head).eq('lead_id', leadId),
    supabase.from('majordhome_lead_activities').select('id', head).eq('lead_id', leadId),
  ]);
  return {
    quotes: quotes.count ?? 0,
    appointments: appts.count ?? 0,
    activities: activities.count ?? 0,
  };
}

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {Function} props.onOpenChange
 * @param {Object|null} props.lead - la carte ouverte (survivant)
 * @param {string} props.orgId
 * @param {Function} [props.onMerged] - après fusion réussie
 */
export function MergeLeadDialog({ open, onOpenChange, lead, orgId, onMerged }) {
  const { mergeLeads, isMerging } = useLeadMutations();
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!open) setSelected(null);
  }, [open, lead?.id]);

  // Doublons probables — même filet que la création (fiche lead, planning, explorateur).
  const { data: candidates = [], isLoading: loadingCandidates } = useQuery({
    queryKey: ['lead-merge-candidates', orgId, lead?.id],
    queryFn: async () => {
      const { data, error } = await leadsService.findPotentialDuplicates({
        orgId,
        phone: lead?.phone,
        email: lead?.email,
        firstName: lead?.first_name,
        lastName: lead?.last_name,
        clientId: lead?.client_id,
      });
      if (error) throw error;
      return (data || []).filter((c) => c.id !== lead?.id);
    },
    enabled: open && !!orgId && !!lead?.id,
  });

  // Ce qui sera transféré depuis la carte choisie.
  const { data: counts } = useQuery({
    queryKey: ['lead-merge-preflight', selected?.id],
    queryFn: () => countAbsorbedLinks(selected.id),
    enabled: open && !!selected?.id,
  });

  const handleConfirm = async () => {
    if (!selected) {
      toast.error('Choisissez la carte à absorber');
      return;
    }
    try {
      const result = await mergeLeads(lead.id, selected.id);
      const c = result?.counts || {};
      toast.success(
        `Fusion faite : ${c.pennylane_quotes ?? 0} devis, ${c.appointments ?? 0} RDV, ${c.activities ?? 0} activités transférés`,
      );
      onOpenChange(false);
      onMerged?.(result);
    } catch (err) {
      console.error('[MergeLeadDialog] merge error:', err);
      const code = err?.message || '';
      toast.error(
        code.includes('org_admin_required') ? 'Action réservée aux administrateurs'
          : code.includes('lead_deleted') ? 'Une des deux cartes est déjà supprimée'
            : 'Fusion impossible',
      );
    }
  };

  const survivorName = `${lead?.last_name || ''} ${lead?.first_name || ''}`.trim() || 'cette carte';

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Fusionner un doublon dans cette carte"
      description={`« ${survivorName} » est conservée. La carte absorbée lui transfère ses devis, RDV, activités et interactions, complète ses champs vides, puis est archivée (réversible).`}
      confirmLabel={isMerging ? 'Fusion…' : 'Fusionner dans cette carte'}
      cancelLabel="Annuler"
      variant="default"
      loading={isMerging}
      onConfirm={handleConfirm}
    >
      <div className="mt-4 space-y-3">
        <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
          <GitMerge className="h-4 w-4 text-gray-500" />
          Carte à absorber
        </p>

        {loadingCandidates && <p className="text-sm text-gray-500 italic">Recherche des doublons…</p>}

        {!loadingCandidates && candidates.length === 0 && (
          <p className="text-sm text-gray-500 italic">
            Aucune autre carte active ne partage le client, le téléphone, l&apos;email ou le nom de celle-ci.
          </p>
        )}

        {candidates.length > 0 && (
          <div className="max-h-64 overflow-y-auto space-y-1.5">
            {candidates.map((c) => {
              const isSel = selected?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    isSel ? 'bg-primary-50 border-primary-300' : 'bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <p className="text-sm font-medium text-gray-900">
                    {c.display_name || `${c.last_name || ''} ${c.first_name || ''}`.trim() || 'Sans nom'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {[
                      c.status_label,
                      c.city,
                      c.created_at ? `créée le ${formatDateShortFR(c.created_at)}` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    {(c.matchReasons || []).map((r) => REASON_LABELS[r] || r).join(', ')}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
            <p className="font-medium mb-1">Sera transféré depuis cette carte :</p>
            {counts ? (
              <ul className="list-disc list-inside space-y-0.5">
                <li><span className="font-medium">{counts.quotes}</span> devis Pennylane rattaché{counts.quotes > 1 ? 's' : ''}</li>
                <li><span className="font-medium">{counts.appointments}</span> RDV planning</li>
                <li><span className="font-medium">{counts.activities}</span> activité{counts.activities > 1 ? 's' : ''} (timeline)</li>
                <li className="text-gray-500">+ interactions, mailings, visites techniques, études, dossiers PV</li>
              </ul>
            ) : (
              <p className="text-gray-500 italic">Calcul en cours…</p>
            )}
            <p className="mt-2 text-gray-500 italic">
              Le statut le plus avancé est conservé (Gagné l&apos;emporte). Le placement Kanban reste piloté par Pennylane.
            </p>
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
}

export default MergeLeadDialog;
