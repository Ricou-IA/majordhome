/**
 * CompleterClientPennylaneModal.jsx — Compléter la fiche client avant l'envoi d'un devis dans Pennylane
 * ============================================================================
 * Pennylane refuse un customer sans adresse complète (et sans nom / raison sociale). Plutôt
 * qu'un toast « fiche incomplète » (Eric, 2026-10-27), la fenêtre demande les seuls champs
 * manquants (source unique : champsClientManquantsPourPennylane), les enregistre sur la fiche
 * client, puis rend la fiche à jour à l'appelant qui relance l'envoi.
 * Superposée à la fiche devis (z-60).
 * ============================================================================
 */

import { useState } from 'react';
import { X, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useClient } from '@hooks/useClients';
import { FormField, TextInput } from '../FormFields';
import { LIBELLES_CHAMPS_CLIENT_PENNYLANE } from '@/lib/pennylaneCustomerRequirements.js';

// clé de la fiche → clé attendue par clientsService.updateClient
const CLE_UPDATE = { company_name: 'companyName', first_name: 'firstName', last_name: 'lastName', address: 'address', postal_code: 'postalCode', city: 'city' };
const PLACEHOLDERS = { company_name: 'Raison sociale', first_name: 'Prénom', last_name: 'Nom', address: 'N° et rue', postal_code: '81000', city: 'Ville' };

/**
 * @param {object} p
 * @param {object} p.client fiche client (ligne majordhome_clients)
 * @param {Array<{ key: string, label: string }>} p.champs champs manquants
 * @param {() => void} p.onClose
 * @param {(client: object) => void} p.onComplete fiche enregistrée, à jour
 */
export default function CompleterClientPennylaneModal({ client, champs, onClose, onComplete }) {
  const { updateClient, isUpdating } = useClient(client?.id);
  const [form, setForm] = useState(() => Object.fromEntries(champs.map((c) => [c.key, client?.[c.key] || ''])));

  const incomplet = champs.some((c) => !String(form[c.key] || '').trim());

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (incomplet) return;
    try {
      const updates = Object.fromEntries(champs.map((c) => [CLE_UPDATE[c.key], String(form[c.key]).trim()]));
      const saved = await updateClient(updates);
      onComplete({ ...client, ...(saved || {}) });
    } catch (err) {
      toast.error(err?.message || 'Enregistrement de la fiche client impossible');
    }
  };

  const libelle = (c) => { const l = c.label || LIBELLES_CHAMPS_CLIENT_PENNYLANE[c.key] || c.key; return l.charAt(0).toUpperCase() + l.slice(1); };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col m-4">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-base font-semibold text-secondary-900">Compléter la fiche client</h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-secondary-100 rounded" aria-label="Fermer"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-secondary-600">
            Pennylane a besoin de ces renseignements pour créer le client <span className="font-medium text-secondary-900">{client?.display_name || ''}</span>. Ils seront enregistrés sur sa fiche.
          </p>
          {champs.map((c) => (
            <FormField key={c.key} label={libelle(c)} required>
              <TextInput
                value={form[c.key]}
                onChange={(v) => setForm((prev) => ({ ...prev, [c.key]: v }))}
                placeholder={PLACEHOLDERS[c.key]}
                autoComplete={c.key === 'postal_code' ? 'postal-code' : c.key === 'city' ? 'address-level2' : c.key === 'address' ? 'street-address' : 'off'}
                inputMode={c.key === 'postal_code' ? 'numeric' : undefined}
                autoFocus={c.key === champs[0].key}
              />
            </FormField>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-secondary-50 rounded-b-xl">
          <button type="button" onClick={onClose} className="btn-secondary btn-sm">Annuler</button>
          <button type="submit" disabled={incomplet || isUpdating} className="btn-primary btn-sm">
            {isUpdating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
            Enregistrer et envoyer
          </button>
        </div>
      </form>
    </div>
  );
}
