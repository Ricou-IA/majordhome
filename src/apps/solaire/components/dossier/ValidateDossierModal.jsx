// src/apps/solaire/components/dossier/ValidateDossierModal.jsx
// Complétion des résidus purement admin à la validation du dossier (spec §3 étape C) :
// état civil du déclarant + coordonnées. Write-once : tout ce qui est déjà connu
// (identité simulation, adresse terrain) est pré-rempli — éditable, jamais redemandé ailleurs.
import { useState, useEffect, useRef } from 'react';
import { X, FileCheck, Loader2 } from 'lucide-react';
import { FormField, inputClass, selectClass } from '@apps/artisan/components/FormFields';

const EMPTY = {
  civilite: 'M.',
  nom: '',
  prenom: '',
  date_naissance: '',
  naissance_commune: '',
  naissance_departement: '',
  naissance_pays: 'France',
  telephone: '',
  email: '',
  notif_electronique: false,
  adresse: { numero: '', voie: '', lieudit: '', code_postal: '', localite: '' },
};

/** « Eric Pudebat » → { prenom: 'Eric', nom: 'Pudebat' } (best effort, éditable). */
function splitClientName(clientName) {
  const tokens = String(clientName ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { prenom: '', nom: tokens[0] ?? '' };
  return { prenom: tokens.slice(0, -1).join(' '), nom: tokens[tokens.length - 1] };
}

export default function ValidateDossierModal({ open, onClose, onSubmit, isSubmitting, initialDeclarant, clientName, terrainAdresse }) {
  const [form, setForm] = useState(EMPTY);

  // Init uniquement à la TRANSITION fermé→ouvert : `terrainAdresse` est un objet recréé
  // à chaque render du parent — le mettre en dépendance réinitialiserait le formulaire
  // à chaque frappe.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      if (initialDeclarant) {
        setForm({ ...EMPTY, ...initialDeclarant, adresse: { ...EMPTY.adresse, ...(initialDeclarant.adresse ?? {}) } });
      } else {
        const { prenom, nom } = splitClientName(clientName);
        setForm({ ...EMPTY, prenom, nom, adresse: { ...EMPTY.adresse, ...(terrainAdresse ?? {}) } });
      }
    }
    wasOpenRef.current = open;
  }, [open, initialDeclarant, clientName, terrainAdresse]);

  if (!open) return null;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setAdr = (patch) => setForm((f) => ({ ...f, adresse: { ...f.adresse, ...patch } }));
  const canSubmit = form.nom.trim() && form.prenom.trim() && form.date_naissance && form.naissance_commune.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-secondary-900">Valider le dossier — déclarant</h3>
          <button onClick={onClose} className="p-1 rounded-md text-secondary-400 hover:bg-secondary-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-secondary-500">
          Ces informations figurent au cadre 1 du CERFA. Le reste du formulaire est déjà rempli
          depuis la simulation (terrain, cadastre, travaux).
        </p>

        <div className="grid grid-cols-3 gap-3">
          <FormField label="Civilité">
            <select className={selectClass} value={form.civilite} onChange={(e) => set({ civilite: e.target.value })}>
              <option value="M.">M.</option>
              <option value="Mme">Mme</option>
            </select>
          </FormField>
          <FormField label="Nom" required>
            <input className={inputClass} value={form.nom} onChange={(e) => set({ nom: e.target.value })} />
          </FormField>
          <FormField label="Prénom" required>
            <input className={inputClass} value={form.prenom} onChange={(e) => set({ prenom: e.target.value })} />
          </FormField>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FormField label="Né(e) le" required>
            <input type="date" className={inputClass} value={form.date_naissance} onChange={(e) => set({ date_naissance: e.target.value })} />
          </FormField>
          <FormField label="À (commune)" required>
            <input className={inputClass} value={form.naissance_commune} onChange={(e) => set({ naissance_commune: e.target.value })} />
          </FormField>
          <FormField label="Dépt">
            <input className={inputClass} value={form.naissance_departement} maxLength={3} placeholder="81" onChange={(e) => set({ naissance_departement: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Pays de naissance">
          <input className={inputClass} value={form.naissance_pays} onChange={(e) => set({ naissance_pays: e.target.value })} />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Téléphone">
            <input className={inputClass} value={form.telephone} placeholder="06 12 34 56 78" onChange={(e) => set({ telephone: e.target.value })} />
          </FormField>
          <FormField label="Email">
            <input type="email" className={inputClass} value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </FormField>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-secondary-700">Adresse du déclarant (pré-remplie : adresse du terrain)</p>
          <div className="grid grid-cols-4 gap-3">
            <FormField label="N°">
              <input className={inputClass} value={form.adresse.numero} onChange={(e) => setAdr({ numero: e.target.value })} />
            </FormField>
            <div className="col-span-3">
              <FormField label="Voie">
                <input className={inputClass} value={form.adresse.voie} onChange={(e) => setAdr({ voie: e.target.value })} />
              </FormField>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Code postal">
              <input className={inputClass} value={form.adresse.code_postal} maxLength={5} onChange={(e) => setAdr({ code_postal: e.target.value })} />
            </FormField>
            <div className="col-span-2">
              <FormField label="Localité">
                <input className={inputClass} value={form.adresse.localite} onChange={(e) => setAdr({ localite: e.target.value })} />
              </FormField>
            </div>
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-secondary-700 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.notif_electronique}
            onChange={(e) => set({ notif_electronique: e.target.checked })}
          />
          <span>
            Le déclarant accepte de recevoir les réponses de l'administration par voie électronique
            <span className="block text-xs text-secondary-500">Coche la case correspondante du CERFA (cadre 2).</span>
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-secondary-200 text-secondary-700 font-medium hover:bg-secondary-50">
            Annuler
          </button>
          <button
            onClick={() => onSubmit(form)}
            disabled={!canSubmit || isSubmitting}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />}
            Valider et générer les documents
          </button>
        </div>
      </div>
    </div>
  );
}
