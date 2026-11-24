/**
 * DevisEntete.jsx — en-tête compact de la modale « Nouveau devis » (un seul écran, décision Eric
 * 2026-09-29) : client en une ligne, familles sur toute la largeur, puis objet + devis type + import. « Famille » et non
 * « installation » : le devis est transversal (SAV, pièces, fumisterie…), pas seulement une pose (Eric, 2026-11-09).
 * Remplace l'ancienne étape « Client » du wizard.
 */

import { ListeChoix } from '@/components/ui/liste-choix';
import { AlertTriangle, User, Phone, Mail, MapPin, FileUp } from 'lucide-react';
import { QUOTE_TEMPLATE_FAMILIES } from '@services/devis.service';

/** `familles` = labels des familles actives de l'org (famillesActives(devisConfig)) ; défauts si absent. */
import { inputClass } from '../FormFields';
import { cn } from '@/lib/utils';

export default function DevisEntete({ lead, form, setField, selectedFamily, onSelectFamily, templates, selectedTemplateId, onSelectTemplate, familles, onImportOffre, erreurObjet = null, onObjetQuitte }) {
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

      {/* Famille sur toute la largeur (13 tuiles, Eric 2026-11-11 : « on a de l'espace vide ») */}
      <div>
        <label className="block text-xs font-medium text-secondary-600 mb-1.5">Famille</label>
        <div className="flex flex-wrap gap-2">
          {listeFamilles.map((f) => (
            <button key={f} type="button" onClick={() => onSelectFamily(f)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${selectedFamily === f ? 'bg-primary-100 border-primary-400 text-primary-800 font-medium' : 'bg-white border-secondary-200 text-secondary-600 hover:border-primary-300 hover:bg-primary-50/50'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Objet + devis type + import d'une offre fournisseur sur une rangée (l'import est une autre façon de
          partir d'un contenu tout fait, au même niveau que le devis type — Eric 2026-10-25) */}
      <div className={`grid gap-3 md:items-end ${onImportOffre ? 'md:grid-cols-[1fr_16rem_auto]' : 'md:grid-cols-[1fr_16rem]'}`}>
        <div>
          <label htmlFor="devis-objet" className="block text-xs font-medium text-secondary-600 mb-1.5">Objet du devis <span className="text-st-alerte" aria-hidden="true">*</span></label>
          <input
            id="devis-objet" type="text" value={form.subject}
            onChange={(e) => setField('subject', e.target.value)} onBlur={onObjetQuitte}
            placeholder="Ex : Poêle à granulés + tubage du conduit existant"
            aria-invalid={erreurObjet ? true : undefined} aria-describedby={erreurObjet ? 'devis-objet-erreur' : undefined}
            className={cn(inputClass, erreurObjet && 'border-st-alerte focus:ring-st-alerte')}
          />
          {erreurObjet && <p id="devis-objet-erreur" className="mt-1 text-xs text-st-alerte">{erreurObjet}</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1.5">Devis type</label>
          <ListeChoix
            libelle="Devis type"
            value={selectedTemplateId || ''}
            disabled={!selectedFamily}
            onChange={(v) => onSelectTemplate(v || null)}
            options={[
              { value: '', label: selectedFamily ? '— Aucun (devis vierge) —' : '— Choisir une famille —' },
              ...familyTemplates.map((t) => ({ value: t.id, label: `${t.name}${t.description ? ` — ${t.description}` : ''}` })),
            ]}
          />
        </div>
        {onImportOffre && (
          <button type="button" onClick={onImportOffre} className="btn-secondary whitespace-nowrap" title="Reprendre les lignes d'une offre de prix fournisseur (PDF)">
            <FileUp className="w-4 h-4 mr-1.5" /> Importer une offre fournisseur
          </button>
        )}
      </div>
    </div>
  );
}
