// src/apps/artisan/components/devis/PennylaneLeadsMultiPayeurs.jsx
// ============================================================================
// Leads rattachés à PLUSIEURS clients Pennylane, remontés sur le TABLEAU DE
// BORD de l'org_admin (découverte mouchard 2026-09-16 : le cron réécrivait
// l'identité de 3 leads toutes les 15 min, en alternant entre deux clients PL).
// Source = vue live `majordhome_lead_multi_customers`. Tant qu'un lead y
// figure, la synchro d'identité Pennylane est SUSPENDUE pour lui (migration
// 20260916_5) : c'est à l'admin de trancher, ici même.
//   - deux personnes différentes → « Retirer » les devis du mauvais client :
//     ils redeviennent « Non rattachés » dans l'explorateur /devis, où on les
//     rattache au bon lead (ou on le crée) ;
//   - même contact en double dans Pennylane → fusionner les fiches PL (on
//     donne l'identifiant à chercher, pas de lien profond : 404 multi-cabinet).
// Le lead sort de la carte de lui-même dès qu'il ne reste qu'un client.
// ============================================================================
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Split } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLeadMultiCustomers, useEjectLeadCustomerQuotes } from '@hooks/usePennylane';
import { formatDateShortFR } from '@/lib/utils';

const STATUS_LABELS = {
  pending: 'en attente',
  accepted: 'accepté',
  invoiced: 'facturé',
  denied: 'refusé',
  refused: 'refusé',
  expired: 'expiré',
  draft: 'brouillon',
};

const statusSummary = (statuses) => {
  const counts = new Map();
  for (const s of statuses) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts.entries()].map(([s, n]) => `${n} ${STATUS_LABELS[s] || s}`).join(', ');
};

const normalizeName = (name) => (name || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Carte du tableau de bord (org_admin + Pennylane actif). Rien à afficher = rien ; un échec de chargement, lui, se voit. */
export function PennylaneLeadsMultiPayeurs() {
  const navigate = useNavigate();
  const { leads, error } = useLeadMultiCustomers();
  const { ejectCustomerQuotes, isEjecting } = useEjectLeadCustomerQuotes();
  const [pending, setPending] = useState(null); // { lead, customer }

  if (error) {
    return (
      <div className="card text-xs text-amber-800 bg-amber-50 border-amber-200">
        Leads multi-payeurs Pennylane indisponibles — chargement en échec ({error.message || 'échec inconnu'}).
      </div>
    );
  }
  if (leads.length === 0) return null;

  const handleConfirm = async () => {
    if (!pending) return;
    const { lead, customer } = pending;
    try {
      const { ejected } = await ejectCustomerQuotes(customer.quoteIds);
      toast.success(`${ejected} devis de « ${customer.name || customer.pennylaneId} » retiré(s) du lead ${lead.lastName || ''}. Ils sont dans l'explorateur, onglet Non rattachés.`);
      setPending(null);
    } catch (err) {
      toast.error(`Retrait interrompu : ${err?.message || 'erreur inconnue'}. Les devis déjà retirés le restent (rattachables depuis l'explorateur).`);
    }
  };

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-secondary-900 flex items-center gap-2 mb-1">
        <Split className="w-5 h-5 text-amber-500" />
        Leads rattachés à plusieurs clients Pennylane
        <span className="text-sm font-normal text-gray-400">({leads.length})</span>
      </h2>
      <p className="text-xs text-secondary-500 mb-3">
        Pennylane ne peut pas faire foi sur l’identité de ces leads : leur synchronisation est suspendue.
        Deux personnes différentes → retirer les devis du mauvais client (ils redeviennent « Non rattachés » dans
        l’explorateur). Même contact en double → fusionner les fiches dans Pennylane.
      </p>

      <ul className="divide-y divide-gray-100">
        {leads.map((lead) => {
          const names = new Set(lead.customers.map((c) => normalizeName(c.name)).filter(Boolean));
          const sameContact = lead.customers.length > 1 && names.size === 1;
          const leadLabel = [lead.lastName, lead.firstName].filter(Boolean).join(' ') || 'Lead sans nom';
          return (
            <li key={lead.leadId} className="px-2 py-3">
              <div className="flex items-baseline justify-between gap-3">
                {lead.clientId ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/clients/${lead.clientId}`)}
                    className="text-sm font-medium text-secondary-900 hover:underline truncate text-left"
                  >
                    {leadLabel}
                  </button>
                ) : (
                  <span className="text-sm font-medium text-secondary-900 truncate">{leadLabel}</span>
                )}
                {lead.leadCity && <span className="shrink-0 text-xs text-gray-400">{lead.leadCity}</span>}
              </div>

              {sameContact && (
                <p className="mt-0.5 text-xs text-amber-700">
                  Mêmes noms : fiches Pennylane en double, à fusionner dans Pennylane (identifiants ci-dessous).
                </p>
              )}

              <ul className="mt-1.5 space-y-1">
                {lead.customers.map((c) => (
                  <li key={c.pennylaneId} className="flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0 text-secondary-600">
                      <span className="text-secondary-800">{c.name || 'Client sans nom'}</span>
                      {c.city ? ` · ${c.city}` : ''} · fiche {c.pennylaneId} ·{' '}
                      {c.quoteCount} devis ({statusSummary(c.quoteStatuses)})
                      {c.lastAssignedAt ? ` · rattaché le ${formatDateShortFR(c.lastAssignedAt)}` : ''}
                    </div>
                    <button
                      type="button"
                      disabled={isEjecting}
                      onClick={() => setPending({ lead, customer: c })}
                      className="shrink-0 rounded border border-gray-200 px-2 py-1 text-xs text-secondary-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Retirer {c.quoteCount > 1 ? `ces ${c.quoteCount} devis` : 'ce devis'}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => { if (!open && !isEjecting) setPending(null); }}
        title="Retirer ces devis du lead ?"
        description={pending
          ? `${pending.customer.quoteCount} devis de « ${pending.customer.name || pending.customer.pennylaneId} » seront détachés du lead ${[pending.lead.lastName, pending.lead.firstName].filter(Boolean).join(' ')}. Ils resteront dans Pennylane et réapparaîtront dans l'explorateur, onglet Non rattachés, pour être rattachés au bon lead.`
          : ''}
        confirmLabel={isEjecting ? 'Retrait en cours…' : 'Retirer'}
        variant="destructive"
        loading={isEjecting}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
