/**
 * CreateLeadFromQuoteModal.jsx — crée un lead depuis un ou plusieurs devis PL
 * orphelins (même client Pennylane). Le contact vient de Pennylane (canonical
 * post-attache) ; l'admin renseigne ce que Pennylane ne sait pas : commercial,
 * source et équipement. Puis on enchaîne sur l'attache : le lead naît en
 * « Nouveau » et la RPC d'attache le pousse en « Devis envoyé » avec ses devis.
 *
 * Filet anti-doublon (2026-09-16) : AVANT de créer, on cherche un lead actif
 * partageant client Majord'home ponté, téléphone, email ou nom+prénom — même
 * filet que la fiche lead et le planning. S'il en existe, l'humain choisit :
 * « Rattacher à cette carte » (aucune création) ou « Créer quand même ».
 * Vécu : DURAND JULIEN — deux clics « Créer le lead » sur deux devis du même
 * client ont fabriqué deux leads à côté de la carte du commercial.
 *
 * Source et équipement portent ici les MÊMES libellés que dans LeadModal
 * (« Source », « Équipement concerné ») et alimentent les mêmes colonnes
 * (`source_id`, `equipment_type_id`) : sans quoi la carte Kanban issue de cet
 * écran serait plus pauvre que celle d'un lead créé normalement.
 */

import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { X, Plus, ChevronDown } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useLeadCommercials, useLeadSources, useLeadStatuses } from '@hooks/useLeads';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { grouperTypesParCategorie } from '@/lib/equipmentReferential';
import { useAttachQuotesAndSend } from '@hooks/usePennylane';
import { leadsService } from '@services/leads.service';
import { pennylaneService } from '@services/pennylane.service';
import { formatEuro } from '@/lib/utils';
import { toAttachPayload } from '@/lib/quotesExplorer';
import { DuplicateLeadDialog } from '../shared/DuplicateLeadDialog';

const selectClass =
  'w-full px-3 py-2 pr-9 border border-secondary-200 rounded-lg text-sm appearance-none bg-white';

function Field({ id, label, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-secondary-700 mb-1">
        {label}
      </label>
      <div className="relative">
        {children}
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}

/**
 * Monté une fois la cible connue (lead créé OU carte existante choisie dans le
 * dialogue de doublon) → leadId stable pour le hook d'attache.
 */
function AttachToLead({ orgId, leadId, quotes, created, onDone }) {
  const { attachQuotes } = useAttachQuotesAndSend(orgId, leadId);
  const n = quotes.length;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await attachQuotes(quotes.map(toAttachPayload));
        if (!cancelled) {
          const devis = n > 1 ? `${n} devis rattachés` : 'devis rattaché';
          toast.success(created ? `Lead créé et ${devis}` : `${devis[0].toUpperCase()}${devis.slice(1)} à la carte existante`);
          onDone();
        }
      } catch (e) {
        if (!cancelled) {
          // La cible EXISTE déjà à ce stade : ne pas laisser croire à un échec total.
          toast.error(`${created ? 'Lead créé, mais r' : 'R'}attachement échoué : ${e?.message || e}`);
          onDone();
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <p className="text-sm text-secondary-500 p-4">Rattachement {n > 1 ? 'des devis' : 'du devis'}...</p>;
}

export function CreateLeadFromQuoteModal({ quote = null, quotes = null, onClose, onCreated }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;

  const list = useMemo(() => (quotes?.length ? quotes : (quote ? [quote] : [])), [quote, quotes]);
  const first = list[0] || {};
  const n = list.length;
  const totalHt = list.reduce((s, q) => s + (Number(q.amount_ht) || 0), 0);

  const { commercials } = useLeadCommercials(orgId);
  const { sources } = useLeadSources();
  const { statuses } = useLeadStatuses();
  const { equipmentTypes, index: referentiel } = useEquipmentReferential();

  const [commercialId, setCommercialId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [equipmentTypeId, setEquipmentTypeId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  // Contact Pennylane résolu une fois (réutilisé après « Créer quand même »).
  const [contact, setContact] = useState(null);
  // Filet anti-doublon : candidats trouvés au moment de créer.
  const [duplicateCandidates, setDuplicateCandidates] = useState(null);
  // Cible de l'attache : { leadId, created } — lead créé ou carte existante choisie.
  const [attachTarget, setAttachTarget] = useState(null);

  // Même regroupement par catégorie (référentiel de l'org) que LeadModal.
  const groupedEquipmentTypes = useMemo(
    () => grouperTypesParCategorie(referentiel, equipmentTypes),
    [referentiel, equipmentTypes],
  );

  // Intitulé des devis : c'est ce qui permet de choisir le bon équipement sans
  // aller ouvrir le PDF. L'information est déjà dans la ligne, autant la montrer.
  const quoteHint = list
    .map((q) => [q.quote_number, q.subject || q.label].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('\n');

  if (n === 0) return null;

  /** Contact canonique = Pennylane (cf. règle « PL fait foi post-attache »). */
  const resolveContact = async () => {
    if (contact) return contact;
    const { data: customer } = first.customer_id
      ? await pennylaneService.fetchCustomerById(first.customer_id, orgId)
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

    // Client Majord'home déjà ponté à ce customer (axe le plus fiable du filet).
    const { data: clientId } = first.customer_id
      ? await pennylaneService.getClientIdForCustomer(orgId, first.customer_id)
      : { data: null };

    const resolved = {
      first_name: firstName || '',
      last_name: lastName || fullName || first.customer_name || 'CLIENT PENNYLANE',
      email: customer ? pennylaneService.extractCustomerEmail(customer) : null,
      phone: customer ? pennylaneService.extractCustomerPhone(customer) : null,
      address: address || null,
      postal_code: postalCode || null,
      city: city || null,
      client_id: clientId || null,
    };
    setContact(resolved);
    return resolved;
  };

  const handleCreate = async ({ force = false } = {}) => {
    setIsCreating(true);
    try {
      const c = await resolveContact();

      // Filet anti-doublon : jamais de création silencieuse si une carte active
      // partage client / téléphone / email / nom+prénom. Best-effort : une erreur
      // de la recherche ne bloque pas la création.
      if (!force) {
        const dup = await leadsService.findPotentialDuplicates({
          orgId,
          phone: c.phone,
          email: c.email,
          firstName: c.first_name,
          lastName: c.last_name,
          clientId: c.client_id,
        });
        if (dup.data?.length) {
          setDuplicateCandidates(dup.data);
          setIsCreating(false);
          return;
        }
      }

      // Statut « Nouveau » (display_order 1) : la RPC d'attache ne promeut en
      // « Devis envoyé » qu'un lead qui A un statut — sans statut, la carte
      // restait sans colonne classique (vécu DURAND).
      const defaultStatus = statuses.find((s) => s.display_order === 1);

      const { data: lead, error } = await leadsService.createLead({
        orgId,
        userId: user?.id,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        phone: c.phone,
        address: c.address,
        postal_code: c.postal_code,
        city: c.city,
        client_id: c.client_id,
        status_id: defaultStatus?.id || null,
        // assigned_user_id porte l'ID de la table commercials (dual-ID bridge,
        // cf. Dashboard.jsx) — donc bien `commercial.id`, pas `profile_id`.
        assigned_user_id: commercialId || null,
        source_id: sourceId || null,
        equipment_type_id: equipmentTypeId || null,
      });
      if (error) throw error;

      setAttachTarget({ leadId: lead?.id, created: true });
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
            <h2 className="font-semibold text-secondary-900">
              {n > 1 ? `Créer le lead avec ${n} devis` : 'Créer le lead'}
            </h2>
            <p className="text-sm text-secondary-500">
              {first.customer_name || 'Client inconnu'} · {formatEuro(totalHt)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-secondary-100">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        {attachTarget ? (
          <AttachToLead
            orgId={orgId}
            leadId={attachTarget.leadId}
            quotes={list}
            created={attachTarget.created}
            onDone={onCreated}
          />
        ) : (
          <>
            <div className="p-4 space-y-3">
              <p className="text-sm text-secondary-600">
                Le contact sera repris depuis Pennylane. Renseigne ce que Pennylane
                ne sait pas — ces trois champs alimentent la carte du pipeline.
              </p>

              {quoteHint && (
                <p className="text-xs text-secondary-500 bg-secondary-50 rounded-lg px-3 py-2 whitespace-pre-line">
                  {quoteHint}
                </p>
              )}

              <Field id="commercial" label="Commercial">
                <select
                  id="commercial"
                  value={commercialId}
                  onChange={(e) => setCommercialId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Non assigné</option>
                  {(commercials || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name || c.email || c.id}</option>
                  ))}
                </select>
              </Field>

              <Field id="source" label="Source">
                <select
                  id="source"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">— Source —</option>
                  {(sources || []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>

              <Field id="equipment" label="Équipement concerné">
                <select
                  id="equipment"
                  value={equipmentTypeId}
                  onChange={(e) => setEquipmentTypeId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">—</option>
                  {groupedEquipmentTypes.map((groupe) => (
                    <optgroup key={groupe.category?.id ?? 'sans-categorie'} label={groupe.label}>
                      {groupe.types.map((type) => (
                        <option key={type.id} value={type.id}>{type.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-secondary-200">
              <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
              <button
                type="button"
                onClick={() => handleCreate()}
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

      {/* Filet anti-doublon : rattacher à la carte existante (aucune création) ou créer quand même */}
      <DuplicateLeadDialog
        open={!!duplicateCandidates}
        candidates={duplicateCandidates || []}
        primaryActionLabel={n > 1 ? `Rattacher les ${n} devis à cette carte` : 'Rattacher le devis à cette carte'}
        onPrimaryAction={(c) => {
          setDuplicateCandidates(null);
          setAttachTarget({ leadId: c.id, created: false });
        }}
        onCreateAnyway={() => {
          setDuplicateCandidates(null);
          handleCreate({ force: true });
        }}
        onCancel={() => setDuplicateCandidates(null)}
      />
    </div>
  );
}

export default CreateLeadFromQuoteModal;
