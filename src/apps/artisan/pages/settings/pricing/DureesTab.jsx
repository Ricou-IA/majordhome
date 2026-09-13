/**
 * pricing/DureesTab.jsx — Settings → Tarification → onglet « Durées d'entretien »
 * ============================================================================
 * Ce qui VALORISE un type d'équipement pour l'entretien : durée d'intervention
 * (base + par unité supplémentaire), tarif unitaire (unités incluses), mois
 * déconseillés. Les types eux-mêmes (code, libellé, catégorie) sont le
 * référentiel du socle : Settings → Équipements (equipements/TypesTab.jsx).
 * Même table `pricing_equipment_types`, mise à jour PARTIELLE : seuls ces
 * champs sont envoyés (cf. pricingService.updateEquipmentType).
 * ============================================================================
 */
import { useMemo, useState } from 'react';
import { Loader2, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { FormField, TextInput } from '@apps/artisan/components/FormFields';
import { indexReferentiel, grouperTypesParCategorie } from '@/lib/equipmentReferential';
import { ModalShell } from './ui';

// Mois déconseillés (tournées) — préférence de planification, jamais un blocage.
const MONTHS_FR = [
  { value: 1, label: 'Jan' }, { value: 2, label: 'Fév' }, { value: 3, label: 'Mar' }, { value: 4, label: 'Avr' },
  { value: 5, label: 'Mai' }, { value: 6, label: 'Jun' }, { value: 7, label: 'Jul' }, { value: 8, label: 'Aoû' },
  { value: 9, label: 'Sep' }, { value: 10, label: 'Oct' }, { value: 11, label: 'Nov' }, { value: 12, label: 'Déc' },
];
const moisLabel = (m) => MONTHS_FR.find((x) => x.value === m)?.label || m;

export function DureesPanel({ admin }) {
  const [editing, setEditing] = useState(null);
  const groupes = useMemo(() => {
    const index = indexReferentiel({ categories: admin.categories, equipmentTypes: admin.equipmentTypes });
    return grouperTypesParCategorie(index, admin.equipmentTypes);
  }, [admin.categories, admin.equipmentTypes]);

  if (admin.equipmentTypes.length === 0) {
    return (
      <div className="text-center py-12 text-secondary-500">
        <Timer className="w-10 h-10 mx-auto mb-2 opacity-40" />
        <p>Aucun type d&apos;équipement — créez-les dans Paramètres → Équipements</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-secondary-600 mb-4">
        Durée d&apos;intervention et saisonnalité de chaque type : c&apos;est ce que le moteur de tournées
        utilise pour remplir une journée. Un type sans durée n&apos;est pas entretenu (travaux, prestations).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-secondary-200 text-left text-secondary-500">
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium text-center">Durée</th>
              <th className="py-2 pr-3 font-medium text-center">Tarif unitaire</th>
              <th className="py-2 pr-3 font-medium">Mois déconseillés</th>
              <th className="py-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {groupes.map((g) => (
              <GroupeRows key={g.category?.id ?? 'sans-categorie'} groupe={g} onEdit={setEditing} />
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <DureeModal
          type={editing}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            try {
              await admin.updateEquipmentType.mutateAsync({ id: editing.id, payload });
              toast.success('Durées enregistrées');
              setEditing(null);
            } catch (err) {
              toast.error(err?.message || 'Erreur');
            }
          }}
          isSaving={admin.updateEquipmentType.isPending}
        />
      )}
    </div>
  );
}

function GroupeRows({ groupe, onEdit }) {
  return (
    <>
      <tr className="bg-secondary-50">
        <td colSpan={5} className="py-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-secondary-500">
          {groupe.label}
        </td>
      </tr>
      {groupe.types.map((type) => (
        <tr key={type.id} className={`border-b border-secondary-100 ${type.is_active ? '' : 'text-secondary-400'}`}>
          <td className="py-2 pr-3 font-medium">
            {type.label}{!type.is_active && <span className="ml-2 text-xs font-normal">(inactif)</span>}
          </td>
          <td className="py-2 pr-3 text-center">
            {type.duration_base_minutes == null ? (
              <span className="text-secondary-400">non entretenu</span>
            ) : (
              <>
                {type.duration_base_minutes} min
                {type.has_unit_pricing && type.duration_per_extra_unit_minutes > 0
                  && ` +${type.duration_per_extra_unit_minutes}/${type.unit_label || 'unité'}`}
              </>
            )}
          </td>
          <td className="py-2 pr-3 text-center">
            {type.has_unit_pricing ? `${type.included_units} ${type.unit_label || 'inclus'}` : '—'}
          </td>
          <td className="py-2 pr-3 text-xs">
            {(type.unfavorable_months || []).length ? type.unfavorable_months.map(moisLabel).join(', ') : '—'}
          </td>
          <td className="py-2 pr-3 text-right">
            <button type="button" onClick={() => onEdit(type)} className="text-xs font-medium text-primary-600 hover:underline">
              Modifier
            </button>
          </td>
        </tr>
      ))}
    </>
  );
}

function DureeModal({ type, onClose, onSave, isSaving }) {
  const [form, setForm] = useState({
    has_unit_pricing: type.has_unit_pricing || false,
    unit_label: type.unit_label || '',
    included_units: type.included_units ?? 0,
    duration_base_minutes: type.duration_base_minutes ?? '',
    duration_per_extra_unit_minutes: type.duration_per_extra_unit_minutes ?? 0,
    unfavorable_months: type.unfavorable_months ?? [],
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const toggleMonth = (m) => setForm((p) => ({
    ...p,
    unfavorable_months: p.unfavorable_months.includes(m)
      ? p.unfavorable_months.filter((x) => x !== m)
      : [...p.unfavorable_months, m],
  }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (form.duration_base_minutes !== '') {
      const parsed = parseInt(form.duration_base_minutes, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast.error("Durée d'entretien : laissez le champ vide si ce type n'est pas entretenu, ou saisissez une durée supérieure à 0 minute.");
        return;
      }
    }
    onSave({
      has_unit_pricing: form.has_unit_pricing,
      unit_label: form.has_unit_pricing ? (form.unit_label.trim() || null) : null,
      included_units: form.has_unit_pricing ? (parseInt(form.included_units, 10) || 0) : 0,
      duration_base_minutes: form.duration_base_minutes === '' ? null : parseInt(form.duration_base_minutes, 10),
      duration_per_extra_unit_minutes: form.has_unit_pricing ? (parseInt(form.duration_per_extra_unit_minutes, 10) || 0) : 0,
      unfavorable_months: form.unfavorable_months,
    });
  };

  return (
    <ModalShell title={`Entretien — ${type.label}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.has_unit_pricing} onChange={(e) => set('has_unit_pricing', e.target.checked)} />
          Tarif unitaire (ex: par radiateur)
        </label>
        {form.has_unit_pricing && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Libellé unité">
              <TextInput value={form.unit_label} onChange={(v) => set('unit_label', v)} placeholder="radiateur(s)" />
            </FormField>
            <FormField label="Inclus dans tarif de base">
              <TextInput value={form.included_units} onChange={(v) => set('included_units', v)} type="number" min="0" />
            </FormField>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Durée d'entretien (min)">
            <TextInput
              value={form.duration_base_minutes}
              onChange={(v) => set('duration_base_minutes', v)}
              type="number"
              min="1"
              placeholder="Non entretenu"
            />
          </FormField>
          {form.has_unit_pricing && (
            <FormField label={`+ par ${form.unit_label || 'unité'} suppl. (min)`}>
              <TextInput
                value={form.duration_per_extra_unit_minutes}
                onChange={(v) => set('duration_per_extra_unit_minutes', v)}
                type="number"
                min="0"
              />
            </FormField>
          )}
        </div>
        <p className="text-xs text-secondary-400 -mt-2">
          Laisser vide si ce type n&apos;est pas entretenu (travaux, prestations).
        </p>

        <div>
          <p className="text-sm font-medium text-secondary-700 mb-1">Mois déconseillés</p>
          <p className="text-xs text-secondary-500 mb-2">
            Mois où l&apos;appareil doit être froid. <strong>Préférence, pas interdiction</strong> : ces mois
            ne sont jamais proposés spontanément, mais restent réservables par le client et forçables en
            interne.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {MONTHS_FR.map((m) => (
              <label key={m.value} className="flex items-center gap-1.5 text-sm text-secondary-700">
                <input
                  type="checkbox"
                  checked={form.unfavorable_months.includes(m.value)}
                  onChange={() => toggleMonth(m.value)}
                />
                {m.label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="submit" disabled={isSaving} className="btn-primary">
            {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Enregistrer
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
