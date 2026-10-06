/**
 * DevisEntete.jsx — en-tête compact de la modale « Nouveau devis » (un seul écran, décision Eric
 * 2026-09-29) : client en une ligne, installation + devis type sur une rangée, objet.
 * Remplace l'ancienne étape « Client » du wizard.
 */

import { AlertTriangle, User, Phone, Mail, MapPin } from 'lucide-react';
import { QUOTE_TEMPLATE_FAMILIES } from '@services/devis.service';

/** `familles` = labels des familles actives de l'org (famillesActives(devisConfig)) ; défauts si absent. */
import { inputClass } from '../FormFields';

export default function DevisEntete({ lead, form, setField, selectedFamily, onSelectFamily, templates, selectedTemplateId, onSelectTemplate, familles }) {
  const listeFamilles = familles?.length ? familles : QUOTE_TEMPLATE_FAMILIES;
  const clientName = [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || '—';
  const clientAddress = [lead?.address, lead?.postal_code, lead?.city].filter(Boolean).join(', ');
  const familyTemplates = selectedFamily ? templates.filter((t) => t.family === selectedFamily) : [];

  return (
    <div className="space-y-4">
      {/* Client en une ligne (lecture seule) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm bg-secondary-50 rounded-lg px-4 py-2.5">
        <span className="flex items-center gap-1.5 font-medium text-secondary-900"><User className="w-4 h-4 text-secondary-400" />{clientName}</span>
        {clientAddress && <span className="flex items-center gap-1.5 text-secondary-600"><MapPin className="w-4 h-4 text-secondary-400" />{clientAddress}</span>}
        {lead?.phone && <span className="flex items-center gap-1.5 text-secondary-600"><Phone className="w-4 h-4 text-secondary-400" />{lead.phone}</span>}
        {lead?.email && <span className="flex items-center gap-1.5 text-secondary-600"><Mail className="w-4 h-4 text-secondary-400" />{lead.email}</span>}
        {!lead?.client_id && (
          <span className="flex items-center gap-1.5 text-primary-800 ml-auto"><AlertTriangle className="w-4 h-4" />Pas de client lié : l&apos;envoi Pennylane exigera un client</span>
        )}
      </div>

      {/* Installation + devis type sur une rangée */}
      <div className="grid gap-3 md:grid-cols-[1fr_16rem] md:items-end">
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1.5">Installation</label>
          <div className="flex flex-wrap gap-2">
            {listeFamilles.map((f) => (
              <button key={f} type="button" onClick={() => onSelectFamily(f)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${selectedFamily === f ? 'bg-primary-100 border-primary-400 text-primary-800 font-medium' : 'bg-white border-secondary-200 text-secondary-600 hover:border-primary-300 hover:bg-primary-50/50'}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1.5">Devis type</label>
          <select value={selectedTemplateId || ''} disabled={!selectedFamily} onChange={(e) => onSelectTemplate(e.target.value || null)} className={`${inputClass} disabled:bg-secondary-50 disabled:text-secondary-400`}>
            <option value="">{selectedFamily ? '— Aucun (devis vierge) —' : '— Choisir une installation —'}</option>
            {familyTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>)}
          </select>
        </div>
      </div>

      {/* Objet */}
      <div>
        <label className="block text-xs font-medium text-secondary-600 mb-1.5">Objet du devis</label>
        <input type="text" value={form.subject} onChange={(e) => setField('subject', e.target.value)} placeholder="Ex : Poêle à granulés + tubage du conduit existant" className={inputClass} />
      </div>
    </div>
  );
}
