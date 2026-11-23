// src/apps/solaire/components/demarches/DemarchesInputs.jsx
// Saisies projet du module Démarches (le reste est dérivé de la simulation et du dossier).
import { ListeChoix } from '@/components/ui/liste-choix';
import { DateInput } from '@/components/ui/date-input';
import { FormField, inputClass } from '@apps/artisan/components/FormFields';

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
        <ListeChoix
          libelle="Valorisation de la production"
          value={value.mode_valorisation}
          disabled={disabled}
          onChange={(v) => onChange({ mode_valorisation: v })}
          options={[
            { value: 'autoconso_surplus', label: 'Autoconsommation avec vente du surplus' },
            { value: 'autoconso_totale', label: 'Autoconsommation totale (sans injection)' },
          ]}
        />
      </FormField>
      <FormField label="Situation du bien">
        <ListeChoix
          libelle="Situation du bien"
          value={value.copropriete_ou_lotissement}
          disabled={disabled}
          onChange={(v) => onChange({ copropriete_ou_lotissement: v })}
          options={[
            { value: 'aucun', label: 'Maison individuelle, hors lotissement' },
            { value: 'lotissement', label: 'En lotissement' },
            { value: 'copropriete', label: 'En copropriété' },
          ]}
        />
      </FormField>
      <FormField label="Compteur">
        <ListeChoix
          libelle="Compteur"
          value={value.compteur_linky ? 'oui' : 'non'}
          disabled={disabled}
          onChange={(v) => onChange({ compteur_linky: v === 'oui' })}
          options={[
            { value: 'oui', label: 'Linky (communicant)' },
            { value: 'non', label: 'Ancien compteur' },
          ]}
        />
      </FormField>
      <FormField label="Point de départ du planning">
        <DateInput libelle="Point de départ du planning" value={value.date_depart ?? ''} disabled={disabled} onChange={(v) => onChange({ date_depart: v })} />
      </FormField>
      <FormField label="Devis de référence (n°)">
        <input type="text" className={inputClass} value={value.devis?.numero ?? ''} placeholder="D-2026-042" disabled={disabled} onChange={(e) => onChange({ devis: { ...value.devis, numero: e.target.value } })} />
      </FormField>
      <FormField label="Date du devis">
        <DateInput libelle="Date du devis" value={value.devis?.date ?? ''} disabled={disabled} onChange={(v) => onChange({ devis: { ...value.devis, date: v } })} />
      </FormField>
      <FormField label="Frais Enedis">
        <ListeChoix
          libelle="Frais Enedis"
          value={pec.raccordement_enedis ?? prisesEnChargeDefaut.raccordement_enedis}
          disabled={disabled}
          onChange={(v) => setPec('raccordement_enedis', v)}
          options={PEC_OPTIONS}
        />
      </FormField>
      <FormField label="Frais Consuel">
        <ListeChoix
          libelle="Frais Consuel"
          value={pec.consuel ?? prisesEnChargeDefaut.consuel}
          disabled={disabled}
          onChange={(v) => setPec('consuel', v)}
          options={PEC_OPTIONS}
        />
      </FormField>
    </div>
  );
}
