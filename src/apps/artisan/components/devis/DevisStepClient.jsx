/**
 * DevisStepClient.jsx — Étape 1 du wizard : infos client + objet
 */

import { FormField, TextInput, TextArea } from '../../components/FormFields';
import { User, MapPin, Phone, Mail } from 'lucide-react';

export default function DevisStepClient({ lead, form, setField }) {
  // Client info pré-remplie depuis le lead
  const clientName = [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || '—';
  const clientAddress = [lead?.address, lead?.postal_code, lead?.city].filter(Boolean).join(', ') || '—';

  return (
    <div className="space-y-6">
      {/* Client info (lecture seule) */}
      <div className="bg-secondary-50 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider">Client</h3>
        <div className="grid gap-2 text-sm">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-secondary-400" />
            <span className="font-medium text-secondary-900">{clientName}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-secondary-400" />
            <span className="text-secondary-600">{clientAddress}</span>
          </div>
          {lead?.phone && (
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-secondary-400" />
              <span className="text-secondary-600">{lead.phone}</span>
            </div>
          )}
          {lead?.email && (
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-secondary-400" />
              <span className="text-secondary-600">{lead.email}</span>
            </div>
          )}
        </div>
      </div>

      {/* Objet du devis */}
      <FormField label="Objet du devis">
        <TextInput
          value={form.subject}
          onChange={(v) => setField('subject', v)}
          placeholder="Ex: Installation PAC Air-Eau + plancher chauffant"
        />
      </FormField>
    </div>
  );
}
