/**
 * LeadHardDeleteDialog.jsx — god mode org_admin : suppression définitive d'un lead
 * (RPC lead_hard_delete). Décompte preflight des dépendances à l'ouverture.
 * La mutation est passée par le parent (une seule instance, état « en cours » partagé).
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { supabase } from '@/lib/supabaseClient';
import { logger } from '@lib/logger';

export function LeadHardDeleteDialog({ open, onOpenChange, leadId, hardDeleteLead, isHardDeleting, onDeleted }) {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    if (!open || !leadId) {
      setCounts(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const [apptRes, mailRes, interactRes] = await Promise.all([
          supabase.from('majordhome_appointments').select('id', { count: 'exact', head: true }).eq('lead_id', leadId),
          supabase.from('majordhome_mailing_logs').select('id', { count: 'exact', head: true }).eq('lead_id', leadId),
          supabase.from('majordhome_lead_interactions').select('id', { count: 'exact', head: true }).eq('lead_id', leadId),
        ]);
        if (cancelled) return;
        setCounts({
          appointments: apptRes.count ?? 0,
          mailings: mailRes.count ?? 0,
          interactions: interactRes.count ?? 0,
        });
      } catch (err) {
        logger.warn('[LeadModal] hard delete preflight count error:', err);
        if (!cancelled) setCounts({ appointments: null, mailings: null, interactions: null });
      }
    })();
    return () => { cancelled = true; };
  }, [open, leadId]);

  const handleConfirm = async () => {
    if (!leadId) return;
    try {
      const result = await hardDeleteLead(leadId);
      const nbApp = result?.counts?.appointments ?? 0;
      toast.success(
        nbApp > 0
          ? `Lead supprimé (${nbApp} RDV nettoyé${nbApp > 1 ? 's' : ''})`
          : 'Lead supprimé définitivement',
      );
      onOpenChange(false);
      onDeleted?.();
    } catch (err) {
      logger.error('[LeadModal] hard delete error:', err);
      const code = err?.message || '';
      const msg = code.includes('org_admin_required')
        ? 'Action réservée aux administrateurs'
        : code.includes('lead_not_found')
        ? 'Lead introuvable (déjà supprimé ?)'
        : `Erreur : ${code || 'suppression échouée'}`;
      toast.error(msg);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Supprimer définitivement ce lead ?"
      description="Cette action est irréversible. Le lead et toutes ses données associées seront purgés de la base."
      confirmLabel={isHardDeleting ? 'Suppression…' : 'Supprimer définitivement'}
      cancelLabel="Annuler"
      variant="destructive"
      loading={isHardDeleting}
      onConfirm={handleConfirm}
    >
      <div className="mt-4 rounded-lg border border-red-100 bg-red-50/60 p-3 text-sm text-gray-700">
        <p className="font-medium text-red-700 mb-2">Données qui seront supprimées :</p>
        {counts === null ? (
          <p className="text-gray-500 italic">Calcul en cours…</p>
        ) : (
          <ul className="space-y-1 list-disc list-inside text-xs">
            <li>
              <span className="font-medium">{counts.appointments ?? '?'}</span>{' '}
              RDV planning lié{(counts.appointments || 0) > 1 ? 's' : ''}
            </li>
            <li>
              <span className="font-medium">{counts.interactions ?? '?'}</span>{' '}
              interaction{(counts.interactions || 0) > 1 ? 's' : ''} (timeline)
            </li>
            <li>
              <span className="font-medium">{counts.mailings ?? '?'}</span>{' '}
              log{(counts.mailings || 0) > 1 ? 's' : ''} mailing
            </li>
            <li className="text-gray-500">
              + activités, devis Pennylane liés, visites techniques (cascade DB)
            </li>
          </ul>
        )}
        <p className="mt-3 text-xs text-gray-500 italic">
          Les interventions ou devis fournisseur liés seront déliés (préservés mais sans lead).
        </p>
      </div>
    </ConfirmDialog>
  );
}
