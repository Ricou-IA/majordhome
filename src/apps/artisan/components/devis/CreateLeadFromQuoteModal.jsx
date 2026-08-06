/**
 * CreateLeadFromQuoteModal.jsx — crée un lead depuis un devis PL orphelin.
 * Le contact vient de Pennylane (canonical post-attache) ; l'admin ne choisit
 * QUE le commercial. Puis on enchaîne sur l'attache : le lead naît directement
 * en « Devis envoyé » avec son devis rattaché.
 */

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { X, Plus } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useLeadCommercials } from '@hooks/useLeads';
import { useAttachQuotesAndSend } from '@hooks/usePennylane';
import { leadsService } from '@services/leads.service';
import { pennylaneService } from '@services/pennylane.service';
import { formatEuro } from '@/lib/utils';

/** Monté une fois le lead créé → leadId stable pour le hook d'attache. */
function AttachAfterCreate({ orgId, leadId, quote, onDone }) {
  const { attachQuotes } = useAttachQuotesAndSend(orgId, leadId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await attachQuotes([{
          quote_pl_id: quote.id,
          customer_id: quote.customer_id ?? null,
          amount_ht: quote.amount_ht ?? null,
          label: quote.quote_number || quote.label || null,
          date: quote.date || null,
          status: quote.status || null,
          pdf_url: quote.pdf_url || null,
        }]);
        if (!cancelled) {
          toast.success('Lead créé et devis rattaché');
          onDone();
        }
      } catch (e) {
        if (!cancelled) {
          // Le lead EXISTE déjà à ce stade : ne pas laisser croire à un échec total.
          toast.error(`Lead créé, mais rattachement échoué : ${e?.message || e}`);
          onDone();
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <p className="text-sm text-secondary-500 p-4">Rattachement du devis...</p>;
}

export function CreateLeadFromQuoteModal({ quote, onClose, onCreated }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;

  const { commercials } = useLeadCommercials(orgId);
  const [commercialId, setCommercialId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createdLeadId, setCreatedLeadId] = useState(null);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      // Contact canonique = Pennylane (cf. règle « PL fait foi post-attache »).
      const { data: customer } = quote.customer_id
        ? await pennylaneService.fetchCustomerById(quote.customer_id, orgId)
        : { data: null };

      // API RÉELLE du service : extractCustomerName renvoie un OBJET
      // { firstName, lastName, fullName }, extractCustomerAddress renvoie
      // { address, postalCode, city }. Ce ne sont pas des extracteurs par champ.
      const { firstName, lastName, fullName } = customer
        ? pennylaneService.extractCustomerName(customer)
        : { firstName: '', lastName: '', fullName: '' };
      const { address, postalCode, city } = customer
        ? pennylaneService.extractCustomerAddress(customer)
        : { address: null, postalCode: null, city: null };

      const leadData = {
        orgId,
        userId: user?.id,
        first_name: firstName || '',
        last_name: lastName || fullName || quote.customer_name || 'CLIENT PENNYLANE',
        email: customer ? pennylaneService.extractCustomerEmail(customer) : null,
        phone: customer ? pennylaneService.extractCustomerPhone(customer) : null,
        address: address || null,
        postal_code: postalCode || null,
        city: city || null,
        // assigned_user_id porte l'ID de la table commercials (dual-ID bridge,
        // cf. Dashboard.jsx) — donc bien `commercial.id`, pas `profile_id`.
        assigned_user_id: commercialId || null,
      };

      const { data: lead, error } = await leadsService.createLead(leadData);
      if (error) throw error;

      setCreatedLeadId(lead?.id);
    } catch (e) {
      toast.error(`Création impossible : ${e?.message || e}`);
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-secondary-200">
          <div>
            <h2 className="font-semibold text-secondary-900">Créer le lead</h2>
            <p className="text-sm text-secondary-500">
              {quote.customer_name || 'Client inconnu'} · {formatEuro(quote.amount_ht)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-secondary-100">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        {createdLeadId ? (
          <AttachAfterCreate orgId={orgId} leadId={createdLeadId} quote={quote} onDone={onCreated} />
        ) : (
          <>
            <div className="p-4 space-y-3">
              <p className="text-sm text-secondary-600">
                Le contact sera repris depuis Pennylane. Choisis le commercial à qui
                affecter ce lead.
              </p>
              <div>
                <label htmlFor="commercial" className="block text-sm font-medium text-secondary-700 mb-1">
                  Commercial
                </label>
                <select
                  id="commercial"
                  value={commercialId}
                  onChange={(e) => setCommercialId(e.target.value)}
                  className="w-full px-3 py-2 border border-secondary-200 rounded-lg text-sm"
                >
                  <option value="">Non assigné</option>
                  {(commercials || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name || c.email || c.id}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-secondary-200">
              <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating}
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                {isCreating ? 'Création...' : 'Créer et rattacher'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default CreateLeadFromQuoteModal;
