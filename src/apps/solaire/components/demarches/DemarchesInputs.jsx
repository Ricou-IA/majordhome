// src/apps/solaire/components/demarches/DemarchesInputs.jsx
// Saisies projet du module Démarches (le reste est dérivé de la simulation et du dossier).
import { FormField, inputClass, selectClass } from '@apps/artisan/components/FormFields';

const PEC_OPTIONS = [
  { value: 'refacture', label: 'Avancés par nous, refacturés' },
  { value: 'inclus', label: 'Inclus dans l’offre' },
];

export default function DemarchesInputs({ value, onChange, prisesEnChargeDefaut, disabled }) {
  const pec = value.prise_en_charge ?? {};
  const setPec = (cle, v) => onChange({ prise_en_charge: { ...pec, [cle]: v } });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <FormField label="Valorisation de la production">
        <select className={selectClass} value={value.mode_valorisation} disabled={disabled} onChange={(e) => onChange({ mode_valorisation: e.target.value })}>
          <option value="autoconso_surplus">Autoconsommation avec vente du surplus</option>
          <option value="autoconso_totale">Autoconsommation totale (sans injection)</option>
        </select>
      </FormField>
      <FormField label="Situation du bien">
        <select className={selectClass} value={value.copropriete_ou_lotissement} disabled={disabled} onChange={(e) => onChange({ copropriete_ou_lotissement: e.target.value })}>
          <option value="aucun">Maison individuelle, hors lotissement</option>
          <option value="lotissement">En lotissement</option>
          <option value="copropriete">En copropriété</option>
        </select>
      </FormField>
      <FormField label="Compteur">
        <select className={selectClass} value={value.compteur_linky ? 'oui' : 'non'} disabled={disabled} onChange={(e) => onChange({ compteur_linky: e.target.value === 'oui' })}>
          <option value="oui">Linky (communicant)</option>
          <option value="non">Ancien compteur</option>
        </select>
      </FormField>
      <FormField label="Point de départ du planning">
        <input type="date" className={inputClass} value={value.date_depart ?? ''} disabled={disabled} onChange={(e) => onChange({ date_depart: e.target.value })} />
      </FormField>
      <FormField label="Devis de référence (n°)">
        <input type="text" className={inputClass} value={value.devis?.numero ?? ''} placeholder="D-2026-042" disabled={disabled} onChange={(e) => onChange({ devis: { ...value.devis, numero: e.target.value } })} />
      </FormField>
      <FormField label="Date du devis">
        <input type="date" className={inputClass} value={value.devis?.date ?? ''} disabled={disabled} onChange={(e) => onChange({ devis: { ...value.devis, date: e.target.value } })} />
      </FormField>
      <FormField label="Frais Enedis">
        <select className={selectClass} value={pec.raccordement_enedis ?? prisesEnChargeDefaut.raccordement_enedis} disabled={disabled} onChange={(e) => setPec('raccordement_enedis', e.target.value)}>
          {PEC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </FormField>
      <FormField label="Frais Consuel">
        <select className={selectClass} value={pec.consuel ?? prisesEnChargeDefaut.consuel} disabled={disabled} onChange={(e) => setPec('consuel', e.target.value)}>
          {PEC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </FormField>
    </div>
  );
}
