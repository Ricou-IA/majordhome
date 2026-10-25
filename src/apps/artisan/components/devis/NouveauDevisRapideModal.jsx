// src/apps/artisan/components/devis/NouveauDevisRapideModal.jsx
// « Nouveau devis » depuis le Kanban (demande d'Eric, 2026-10-25 : raccourcir le process). Deux temps :
//   1. fiche courte du client (nom, contact, adresse, commercial, source, équipement — leadRapide.js), puis filet
//      anti-doublon (même filet que la fiche lead : leadsService.findPotentialDuplicates) → faire le devis sur la
//      carte existante, ou créer quand même ; le lead naît en « Nouveau » ;
//   2. la fenêtre de devis habituelle (CreateDevisModal) s'ouvre sur ce lead.
// Rien n'est créé tant que l'utilisateur n'a pas validé la fiche ; le lead créé reste si le devis est abandonné
// (il est dans le pipeline, en « Nouveau »).
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { X, ChevronDown, Loader2, ArrowRight } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useLeadCommercials, useLeadSources, useLeadStatuses } from '@hooks/useLeads';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { grouperTypesParCategorie } from '@/lib/equipmentReferential';
import { FORMULAIRE_LEAD_VIDE, validerLeadRapide, leadDepuisFormulaire } from '@/lib/leadRapide.js';
import { leadsService } from '@services/leads.service';
import { DuplicateLeadDialog } from '../shared/DuplicateLeadDialog';
import CreateDevisModal from './CreateDevisModal';

const inputClass = 'w-full px-3 py-2 border border-secondary-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const selectClass = `${inputClass} pr-9 appearance-none bg-white`;

function Champ({ id, label, requis = false, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-secondary-600 mb-1">{label}{requis && <span className="text-red-500"> *</span>}</label>
      {children}
    </div>
  );
}

function Liste({ id, value, onChange, children }) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>{children}</select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400 pointer-events-none" />
    </div>
  );
}

/**
 * @param {{ onClose: () => void, onDone?: () => void }} p onDone : lead et/ou devis créés (rafraîchir le Kanban)
 */
export default function NouveauDevisRapideModal({ onClose, onDone }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const { commercials } = useLeadCommercials(orgId);
  const { sources } = useLeadSources();
  const { statuses } = useLeadStatuses();
  const { equipmentTypes, index: referentiel } = useEquipmentReferential();
  const groupes = useMemo(() => grouperTypesParCategorie(referentiel, equipmentTypes), [referentiel, equipmentTypes]);

  // commercial par défaut : la personne connectée si elle est commerciale
  const moi = useMemo(() => (commercials || []).find((c) => c.profile_id === user?.id)?.id || '', [commercials, user?.id]);
  const [form, setForm] = useState(FORMULAIRE_LEAD_VIDE);
  const commercialId = form.commercial_id || moi;
  const [enCours, setEnCours] = useState(false);
  const [doublons, setDoublons] = useState(null);
  const [lead, setLead] = useState(null); // lead du devis (créé ou carte existante) ⇒ étape devis

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const erreurs = validerLeadRapide(form);

  const creerLead = async ({ force = false } = {}) => {
    if (erreurs.length) { toast.error(erreurs[0]); return; }
    setEnCours(true);
    try {
      if (!force) {
        const dup = await leadsService.findPotentialDuplicates({
          orgId, phone: form.phone, email: form.email, firstName: form.first_name, lastName: form.last_name, clientId: null,
        });
        if (dup.data?.length) { setDoublons(dup.data); return; }
      }
      // statut « Nouveau » (display_order 1) : un lead sans statut n'a pas de colonne dans le Kanban
      const nouveau = statuses.find((s) => s.display_order === 1);
      const { data: cree, error } = await leadsService.createLead({
        orgId, userId: user?.id, ...leadDepuisFormulaire({ ...form, commercial_id: commercialId }, { statusId: nouveau?.id || null }),
      });
      if (error) throw error;
      if (!cree?.id) throw new Error('Le lead n\'a pas été créé');
      toast.success('Lead créé en « Nouveau »');
      onDone?.();
      setLead(cree);
    } catch (e) {
      toast.error(`Création du lead impossible : ${e?.message || e}`);
    } finally { setEnCours(false); }
  };

  const utiliserCarte = async (candidat) => {
    setDoublons(null);
    setEnCours(true);
    try {
      const { data, error } = await leadsService.getLeadById(candidat.id);
      if (error || !data) throw error || new Error('Carte introuvable');
      setLead(data);
    } catch (e) { toast.error(`Ouverture de la carte impossible : ${e?.message || e}`); }
    finally { setEnCours(false); }
  };

  // Étape 2 : la fenêtre de devis habituelle, sur le lead
  if (lead) {
    return (
      <CreateDevisModal
        lead={lead}
        onClose={onClose}
        onCreated={() => onDone?.()}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">Nouveau devis</h2>
            <p className="text-xs text-secondary-500">Le client d&apos;abord : le lead est créé en « Nouveau », puis le devis s&apos;ouvre.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-secondary-100 rounded" aria-label="Fermer"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Champ id="ndr-nom" label="Nom" requis><input id="ndr-nom" autoFocus value={form.last_name} onChange={(e) => set('last_name')(e.target.value)} className={inputClass} /></Champ>
            <Champ id="ndr-prenom" label="Prénom"><input id="ndr-prenom" value={form.first_name} onChange={(e) => set('first_name')(e.target.value)} className={inputClass} /></Champ>
            <Champ id="ndr-tel" label="Téléphone"><input id="ndr-tel" type="tel" value={form.phone} onChange={(e) => set('phone')(e.target.value)} className={inputClass} /></Champ>
            <Champ id="ndr-email" label="E-mail"><input id="ndr-email" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} className={inputClass} /></Champ>
            <div className="sm:col-span-2">
              <Champ id="ndr-adresse" label="Adresse"><input id="ndr-adresse" value={form.address} onChange={(e) => set('address')(e.target.value)} className={inputClass} /></Champ>
            </div>
            <Champ id="ndr-cp" label="Code postal"><input id="ndr-cp" value={form.postal_code} onChange={(e) => set('postal_code')(e.target.value)} className={inputClass} /></Champ>
            <Champ id="ndr-ville" label="Ville"><input id="ndr-ville" value={form.city} onChange={(e) => set('city')(e.target.value)} className={inputClass} /></Champ>
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-secondary-100">
            <Champ id="ndr-commercial" label="Commercial">
              <Liste id="ndr-commercial" value={commercialId} onChange={set('commercial_id')}>
                <option value="">Non assigné</option>
                {(commercials || []).map((c) => <option key={c.id} value={c.id}>{c.full_name || c.email || c.id}</option>)}
              </Liste>
            </Champ>
            <Champ id="ndr-source" label="Source">
              <Liste id="ndr-source" value={form.source_id} onChange={set('source_id')}>
                <option value="">— Source —</option>
                {(sources || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Liste>
            </Champ>
            <Champ id="ndr-equipement" label="Équipement concerné">
              <Liste id="ndr-equipement" value={form.equipment_type_id} onChange={set('equipment_type_id')}>
                <option value="">—</option>
                {groupes.map((g) => (
                  <optgroup key={g.category?.id ?? 'sans-categorie'} label={g.label}>
                    {g.types.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                  </optgroup>
                ))}
              </Liste>
            </Champ>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t">
          <span className="text-xs text-amber-700">{erreurs[0] && (form.last_name || form.phone || form.email) ? erreurs[0] : ''}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
            <button type="button" onClick={() => creerLead()} disabled={enCours || erreurs.length > 0} className="btn-primary inline-flex items-center gap-2">
              {enCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Continuer vers le devis
            </button>
          </div>
        </div>
      </div>

      {/* Filet anti-doublon : devis sur la carte existante, ou créer quand même (homonymes légitimes) */}
      <DuplicateLeadDialog
        open={!!doublons}
        candidates={doublons || []}
        primaryActionLabel="Faire le devis sur cette carte"
        onPrimaryAction={utiliserCarte}
        onCreateAnyway={() => { setDoublons(null); creerLead({ force: true }); }}
        onCancel={() => setDoublons(null)}
      />
    </div>
  );
}
