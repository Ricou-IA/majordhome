// src/apps/artisan/pages/settings/solaire/DemarchesTab.jsx
// Onglet Démarches administratives : délais réglementaires + tarifs datés + prise en charge
// des frais par défaut. Édite form.demarches (settings.pv.demarches) ; la page parente
// sauve l'objet pv COMPLET (merge JSONB niveau 1). Aucune règle métier ici : les
// libellés/unités viennent de parametres.js.
import { Plus, Trash2 } from 'lucide-react';
import { DELAIS_META, TARIFS_META } from '@apps/solaire/lib/demarches/parametres';
import { FormField, SectionTitle, inputClass, selectClass } from '../../../components/FormFields';

const PRISE_EN_CHARGE_OPTIONS = [
  { value: 'refacture', label: 'Avancés par nous, refacturés au client' },
  { value: 'inclus', label: 'Inclus dans l’offre' },
];

function DelaiField({ cle, delai, onChange }) {
  const meta = DELAIS_META[cle];
  const champ = meta.unite; // 'jours' | 'mois'
  return (
    <FormField label={meta.libelle}>
      <div className="flex items-center gap-2">
        <input
          type="number" className={inputClass} min={0} step={1} inputMode="numeric"
          value={delai?.[champ] ?? ''}
          onChange={(e) => {
            const n = e.target.value === '' ? '' : Number(e.target.value);
            onChange({ [champ]: Number.isNaN(n) ? '' : n });
          }}
        />
        <span className="text-sm text-secondary-500 flex-shrink-0">{champ}</span>
      </div>
    </FormField>
  );
}

function TarifTable({ cle, liste, onChange }) {
  const meta = TARIFS_META[cle];
  const rows = [...liste].sort((a, b) => (a.date_effet || '').localeCompare(b.date_effet || ''));
  const update = (idx, p) => onChange(rows.map((r, i) => (i === idx ? { ...r, ...p } : r)));
  const remove = (idx) => onChange(rows.filter((_, i) => i !== idx));
  const add = () => onChange([...rows, { date_effet: '', valeur: '' }]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-secondary-800">{meta.libelle} <span className="text-secondary-500">({meta.unite})</span></p>
        <button type="button" onClick={add} className="btn-secondary text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" /> Ajouter une période
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[#B45309]">Aucune valeur renseignée : le moteur affichera « à renseigner » et une alerte.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-secondary-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Date d’effet</th>
                <th className="py-1 pr-2 font-medium">Valeur</th>
                <th className="py-1 pr-2 font-medium">Valide jusqu’au</th>
                <th className="py-1 pr-2 font-medium">Note</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={`${cle}-${idx}`}>
                  <td className="py-1 pr-2"><input type="date" className={inputClass} value={r.date_effet ?? ''} onChange={(e) => update(idx, { date_effet: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input type="number" step="any" min={0} inputMode="decimal" className={inputClass} value={r.valeur ?? ''}
                    onChange={(e) => { const n = e.target.value === '' ? '' : Number(e.target.value); update(idx, { valeur: Number.isNaN(n) ? '' : n }); }} /></td>
                  <td className="py-1 pr-2"><input type="date" className={inputClass} value={r.valide_jusqu_au ?? ''} onChange={(e) => update(idx, { valide_jusqu_au: e.target.value || undefined })} /></td>
                  <td className="py-1 pr-2"><input type="text" className={inputClass} value={r.note ?? ''} placeholder="source, remarque" onChange={(e) => update(idx, { note: e.target.value || undefined })} /></td>
                  <td className="py-1">
                    <button type="button" onClick={() => remove(idx)} className="p-1 text-secondary-400 hover:text-secondary-700" aria-label="Supprimer cette période">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DemarchesTab({ form, patch }) {
  const d = form.demarches ?? { delais: {}, tarifs: {}, prise_en_charge_defaut: {} };
  const patchD = (p) => patch({ demarches: { ...d, ...p } });
  const setDelai = (cle, v) => patchD({ delais: { ...d.delais, [cle]: v } });
  const setTarif = (cle, liste) => patchD({ tarifs: { ...d.tarifs, [cle]: liste } });
  const setPec = (cle, v) => patchD({ prise_en_charge_defaut: { ...d.prise_en_charge_defaut, [cle]: v } });

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div>
          <SectionTitle>Délais réglementaires et internes</SectionTitle>
          <p className="text-xs text-secondary-500 mt-1">Utilisés pour le planning prévisionnel (délais indicatifs). Mois calendaires.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {Object.keys(DELAIS_META).map((cle) => (
            <DelaiField key={cle} cle={cle} delai={d.delais?.[cle]} onChange={(v) => setDelai(cle, v)} />
          ))}
        </div>
      </div>

      <div className="card space-y-6">
        <div>
          <SectionTitle>Tarifs datés</SectionTitle>
          <p className="text-xs text-secondary-500 mt-1">
            La valeur retenue est la dernière dont la date d’effet précède la date de la démarche. Une période échue (« valide jusqu’au » dépassé) reste utilisée mais déclenche une alerte.
          </p>
        </div>
        {Object.keys(TARIFS_META).map((cle) => (
          <TarifTable key={cle} cle={cle} liste={d.tarifs?.[cle] ?? []} onChange={(liste) => setTarif(cle, liste)} />
        ))}
      </div>

      <div className="card space-y-4">
        <SectionTitle>Prise en charge des frais par défaut</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Raccordement Enedis">
            <select className={selectClass} value={d.prise_en_charge_defaut?.raccordement_enedis ?? 'refacture'} onChange={(e) => setPec('raccordement_enedis', e.target.value)}>
              {PRISE_EN_CHARGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FormField>
          <FormField label="Attestation Consuel">
            <select className={selectClass} value={d.prise_en_charge_defaut?.consuel ?? 'refacture'} onChange={(e) => setPec('consuel', e.target.value)}>
              {PRISE_EN_CHARGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FormField>
        </div>
        <p className="text-xs text-secondary-500">Réglable projet par projet dans la section Démarches de l’étude.</p>
      </div>
    </div>
  );
}
