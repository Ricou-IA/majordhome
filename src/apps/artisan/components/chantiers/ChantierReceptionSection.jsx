/**
 * ChantierReceptionSection.jsx — Majord'home Artisan
 * ============================================================================
 * Section "Gestion des Appro" dans la fiche chantier.
 *
 * Version simplifiée (2026-07-21) : suivi appro à 2 axes seulement —
 *  - Équipement
 *  - Matériaux
 * chacun cyclable N/A → Commandé → Reçu (mêmes couleurs que les bulles Éq./Mat.
 * de la carte kanban). Pilote chantier_status via chantiersService.updateOrderStatus :
 * les deux axes en « Reçu » (ou « N/A ») font auto-basculer commande_a_faire → À planifier
 * (et inversement).
 *
 * Le suivi ligne par ligne des devis Pennylane (réception par quantité) a été
 * retiré : identifier ce qui relève du matériau vs de l'équipement depuis les
 * lignes du devis n'est pas possible tant qu'il n'existe pas de table de mapping.
 * → à ré-outiller plus tard.
 *
 * Les devis Pennylane rattachés restent affichés en référence (n° · montant · PDF),
 * avec le ✕ d'éjection conservé : c'est le seul endroit de l'app où retirer un
 * devis mal rattaché par le cron pennylane-sync-quote-status.
 *
 * @version 4.0.0 — appro simplifiée (Équipement / Matériaux)
 * ============================================================================
 */

import { useState, useEffect, useMemo } from 'react';
import { Package, ExternalLink, X, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { formatEuro } from '@/lib/utils';
import { ORDER_STATUSES } from '@services/chantiers.service';
import { useChantierMutations } from '@hooks/useChantiers';
import { useCanAccess } from '@hooks/usePermissions';
import { DetachChantierDialog } from './DetachChantierDialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  useLinkedPennylaneQuotes,
  useLinkedPennylaneQuotesMutations,
} from '@hooks/usePennylane';

// Statuts Pennylane non validés (affichés en libellé sur la référence devis)
const PL_STATUS_LABELS = {
  pending: 'En attente',
  draft: 'Brouillon',
  expired: 'Expiré',
  refused: 'Refusé',
  denied: 'Refusé',
  canceled: 'Annulé',
};

const ORDER_ACTIVE_CLASS = {
  recu: 'bg-emerald-500 text-white',
  commande: 'bg-blue-500 text-white',
  na: 'bg-gray-200 text-gray-600',
};

/**
 * Réglage segmenté N/A · Commandé · Reçu pour un axe d'appro.
 */
function ApproToggle({ label, value, onChange, disabled }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
        {ORDER_STATUSES.map((s) => {
          const active = value === s.value;
          return (
            <button
              key={s.value}
              type="button"
              // Re-cliquer le statut actif le désactive (retour à « non renseigné ») :
              // sans ça, un clic était définitif — on ne pouvait plus sortir d'un N/A posé par erreur.
              onClick={() => onChange(active ? null : s.value)}
              title={active ? 'Cliquer à nouveau pour effacer' : undefined}
              disabled={disabled}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-r border-gray-200 last:border-r-0 disabled:cursor-not-allowed disabled:opacity-60 ${
                active ? ORDER_ACTIVE_CLASS[s.value] : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ChantierReceptionSection({ chantier, onUpdated, disabled = false, appointments = [] }) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { can } = useCanAccess();
  const [showDetach, setShowDetach] = useState(false);

  const { updateOrderStatus, isUpdatingOrder } = useChantierMutations();

  // État local optimiste : la modale garde un `chantier` figé (sélection kanban),
  // on reflète donc le changement immédiatement plutôt que d'attendre un refetch.
  // NULL reste NULL (aucun bouton actif) : « N/A » est une réponse qualifiée (rien à
  // recevoir, prestation) qui confirme une pose provisoire — on ne la présélectionne pas.
  const [equip, setEquip] = useState(chantier?.equipment_order_status || null);
  const [mat, setMat] = useState(chantier?.materials_order_status || null);

  useEffect(() => {
    setEquip(chantier?.equipment_order_status || null);
    setMat(chantier?.materials_order_status || null);
  }, [chantier?.id, chantier?.equipment_order_status, chantier?.materials_order_status]);

  // Devis Pennylane rattachés (référence + éjection). Léger : pas de chargement
  // des lignes, juste le pivot lead_pennylane_quotes.
  const { linkedQuotes } = useLinkedPennylaneQuotes(chantier?.lead_id, { chantierId: chantier?.id });
  const { ejectQuote, isEjecting } = useLinkedPennylaneQuotesMutations(orgId, chantier?.lead_id);

  // Validés d'abord, puis les autres
  const quotes = useMemo(
    () =>
      (linkedQuotes || [])
        .slice()
        .sort((a, b) => (b.is_validated ? 1 : 0) - (a.is_validated ? 1 : 0)),
    [linkedQuotes]
  );

  const applyOrder = async (field, next) => {
    const prevEquip = equip;
    const prevMat = mat;
    const newEquip = field === 'equipment' ? next : equip;
    const newMat = field === 'materials' ? next : mat;

    // Optimiste
    if (field === 'equipment') setEquip(next);
    else setMat(next);

    try {
      const res = await updateOrderStatus(chantier.id, {
        equipmentOrderStatus: newEquip,
        materialsOrderStatus: newMat,
        currentChantierStatus: chantier.chantier_status,
        hasActiveRdv: Boolean(chantier.has_active_rdv),
      });

      onUpdated?.();

      if (res?.autoTransitioned) {
        const libelles = {
          planification: 'Appros reçues : pose confirmée, chantier déplacé en « Planification »',
          commande_recue: 'Chantier déplacé en « À planifier »',
          commande_a_faire: 'Chantier repassé en « Commande à faire »',
        };
        toast.success(libelles[res.newChantierStatus] || 'Statut du chantier mis à jour');
      }
    } catch {
      // Rollback
      setEquip(prevEquip);
      setMat(prevMat);
      toast.error('Erreur de mise à jour');
    }
  };

  // Retrait d'un devis : confirmation dans l'app (plus de window.confirm) qui dit ce que le geste
  // fait — le devis quitte le lead, il n'est pas déplacé. Vécu 2026-10-01 : la borne GOUIN retirée
  // au lieu d'être détachée. { pennylaneQuoteId, label } pendant la confirmation, null sinon.
  const [ejectTarget, setEjectTarget] = useState(null);

  const handleEject = async () => {
    if (!ejectTarget) return;
    try {
      await ejectQuote(ejectTarget.pennylaneQuoteId, 'manual_ui');
      setEjectTarget(null);
      onUpdated?.();
      toast.success('Devis retiré du chantier');
    } catch (e) {
      toast.error(e?.message || 'Erreur retrait du devis');
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
        <Package className="w-4 h-4" />
        Gestion des Appro
      </h3>

      {/* Suivi appro : 2 axes */}
      <div className="space-y-2.5 p-3 bg-white border border-gray-200 rounded-lg">
        <ApproToggle
          label="Équipement"
          value={equip}
          onChange={(v) => applyOrder('equipment', v)}
          disabled={disabled || isUpdatingOrder}
        />
        <ApproToggle
          label="Matériaux"
          value={mat}
          onChange={(v) => applyOrder('materials', v)}
          disabled={disabled || isUpdatingOrder}
        />
      </div>

      {/* Référence devis rattachés (lecture seule + éjection) */}
      {quotes.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-400">
            Devis de ce chantier
          </p>
          {quotes.map((q) => {
            const qid = q.pennylane_quote_id;
            const label = q.quote_number_pl || q.quote_label || `#${qid}`;
            return (
              <div
                key={qid}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
                  q.is_validated
                    ? 'bg-blue-50 border-blue-100'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-gray-900">{label}</span>
                  {!q.is_validated && (
                    <span className="text-gray-400">
                      {' '}
                      · {PL_STATUS_LABELS[q.quote_status] || q.quote_status || '—'}
                    </span>
                  )}
                </div>
                {q.quote_amount_ht != null && (
                  <span className="font-semibold text-gray-900 tabular-nums shrink-0">
                    {formatEuro(Number(q.quote_amount_ht))}
                  </span>
                )}
                {q.pdf_url && (
                  <a
                    href={q.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 shrink-0"
                  >
                    <ExternalLink className="w-3 h-3" />
                    PDF
                  </a>
                )}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => setEjectTarget({ pennylaneQuoteId: qid, label })}
                    disabled={isEjecting}
                    title="Retirer ce devis du chantier"
                    aria-label={`Retirer le devis ${label}`}
                    className="text-gray-400 hover:text-amber-600 transition-colors p-1 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {can('chantiers', 'edit') && quotes.filter((q) => q.is_validated).length >= 2 && (
            <button type="button" onClick={() => setShowDetach(true)}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1">
              <Scissors className="w-3.5 h-3.5" /> Détacher en chantier distinct
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(ejectTarget)}
        onOpenChange={(open) => { if (!open) setEjectTarget(null); }}
        title={`Retirer le devis ${ejectTarget?.label || ''} de ce chantier ?`}
        description="Le devis quitte le chantier ET le lead : il redevient « non rattaché » dans l'explorateur de devis, le montant de la carte est recalculé sans lui. Aucun jour d'installation n'est touché. À utiliser pour un devis mal rattaché ou annulé par un avoir."
        confirmLabel={isEjecting ? 'Retrait…' : 'Retirer ce devis'}
        cancelLabel="Annuler"
        variant="destructive"
        loading={isEjecting}
        onConfirm={handleEject}
      >
        <p className="mt-3 text-sm text-gray-600">
          Pour séparer ce devis sur sa propre carte (autre commande du même client), utilisez plutôt
          <span className="font-medium text-gray-900"> « Détacher en chantier distinct »</span>.
        </p>
      </ConfirmDialog>

      {showDetach && (
        <DetachChantierDialog
          chantier={chantier}
          quotes={quotes}
          appointments={appointments}
          onClose={() => setShowDetach(false)}
          onDetached={onUpdated}
        />
      )}
    </div>
  );
}

export default ChantierReceptionSection;
