/**
 * pricing/CategoriesTab.jsx — Settings → Tarification → onglet « Catégories »
 * ============================================================================
 * Niveau 1 du référentiel équipements de l'org (catégorie → type). Chaque
 * catégorie porte : un code IMMUABLE (certificats et site vitrine désignent par
 * code), un libellé et un ordre libres, le gabarit de certificat (liste fermée
 * niveau app) et la TVA par défaut du certificat.
 *
 * Écriture via usePricingAdmin (vue updatable + RLS org_admin). Supprimer une
 * catégorie référencée par des types ou des équipements est refusé par la base
 * (FK RESTRICT, 23503) : on propose de la désactiver, jamais de forcer.
 * Spec : docs/superpowers/specs/2026-09-12-referentiel-equipements-tarifs-competences-design.md §6.1
 * ============================================================================
 */
import { useState } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { FormField, TextInput } from '@apps/artisan/components/FormFields';
import { CERTIFICATE_PROFILES } from '@/lib/equipmentReferential';
import { ToolbarHeader, ActionButtons, ModalShell, selectClass } from './ui';

const CODE_RE = /^[a-z0-9_]+$/;
const TVA_SUGGESTIONS = [5.5, 10, 20];

const profilLabel = (value) => CERTIFICATE_PROFILES.find((p) => p.value === value)?.label || value || '—';

export function CategoriesPanel({ admin }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  const typesParCategorie = new Map();
  for (const t of admin.equipmentTypes) {
    typesParCategorie.set(t.category_id, (typesParCategorie.get(t.category_id) || 0) + 1);
  }

  const handleDelete = async (cat) => {
    const nTypes = typesParCategorie.get(cat.id) || 0;
    if (nTypes > 0) {
      toast.error(`« ${cat.label} » est utilisée par ${nTypes} type(s) d'équipement : désactivez-la plutôt.`);
      return;
    }
    if (!window.confirm(`Supprimer la catégorie "${cat.label}" ?`)) return;
    try {
      await admin.deleteCategory.mutateAsync(cat.id);
      toast.success('Catégorie supprimée');
    } catch (err) {
      // 23503 : des équipements (non typés) ou des types y pointent encore.
      const fk = err?.code === '23503' || /foreign key|viol/i.test(err?.message || '');
      toast.error(fk
        ? `Des types ou équipements utilisent « ${cat.label} » : désactivez-la plutôt que la supprimer.`
        : (err?.message || 'Erreur'));
    }
  };

  return (
    <div>
      <ToolbarHeader
        title="Catégories"
        count={admin.categories.length}
        addLabel="Catégorie"
        onAdd={() => { setEditing(null); setShowModal(true); }}
      />
      <p className="text-xs text-secondary-500 -mt-2 mb-4">
        Une catégorie regroupe des types d&apos;équipement (prix, durée) et porte le gabarit du certificat
        d&apos;entretien. Les compétences des techniciens se cochent par type, dans Équipe.
      </p>

      {admin.categories.length === 0 ? (
        <div className="text-center py-12 text-secondary-500">
          <Layers className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>Aucune catégorie — créez-en une avant d&apos;ajouter des types d&apos;équipement</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-left text-secondary-500">
                <th className="py-2 pr-3 font-medium">Ordre</th>
                <th className="py-2 pr-3 font-medium">Code</th>
                <th className="py-2 pr-3 font-medium">Libellé</th>
                <th className="py-2 pr-3 font-medium">Certificat</th>
                <th className="py-2 pr-3 font-medium text-right">TVA</th>
                <th className="py-2 pr-3 font-medium text-center">Types</th>
                <th className="py-2 pr-3 font-medium text-center">Actif</th>
                <th className="py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {admin.categories.map((cat) => (
                <tr key={cat.id} className="border-b border-secondary-100">
                  <td className="py-2 pr-3 text-secondary-500">{cat.sort_order}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{cat.code}</td>
                  <td className="py-2 pr-3 font-medium text-secondary-900">{cat.label}</td>
                  <td className="py-2 pr-3 text-secondary-600 text-xs">{profilLabel(cat.certificate_profile)}</td>
                  <td className="py-2 pr-3 text-right">{String(Number(cat.default_vat_rate)).replace('.', ',')} %</td>
                  <td className="py-2 pr-3 text-center">{typesParCategorie.get(cat.id) || 0}</td>
                  <td className="py-2 pr-3 text-center">{cat.is_active ? '✓' : '—'}</td>
                  <td className="py-2 pr-3">
                    <ActionButtons
                      onEdit={() => { setEditing(cat); setShowModal(true); }}
                      onDelete={() => handleDelete(cat)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <CategoryModal
          category={editing}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSave={async (payload) => {
            try {
              if (editing) await admin.updateCategory.mutateAsync({ id: editing.id, payload });
              else await admin.createCategory.mutateAsync(payload);
              toast.success('Catégorie enregistrée');
              setShowModal(false);
              setEditing(null);
            } catch (err) {
              const doublon = err?.code === '23505' || /duplicate|unique/i.test(err?.message || '');
              toast.error(doublon ? 'Ce code existe déjà dans votre organisation' : (err?.message || 'Erreur'));
            }
          }}
          isSaving={admin.createCategory.isPending || admin.updateCategory.isPending}
        />
      )}
    </div>
  );
}

function CategoryModal({ category, onClose, onSave, isSaving }) {
  const isEdit = !!category;
  const [form, setForm] = useState({
    code: category?.code || '',
    label: category?.label || '',
    sort_order: category?.sort_order ?? 0,
    is_active: category?.is_active ?? true,
    certificate_profile: category?.certificate_profile || 'generique',
    default_vat_rate: category?.default_vat_rate != null ? String(category.default_vat_rate) : '20',
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const code = form.code.trim().toLowerCase();
    if (!isEdit && !CODE_RE.test(code)) {
      toast.error('Code : lettres minuscules, chiffres et _ uniquement (ex. pac_air_air)');
      return;
    }
    if (!form.label.trim()) { toast.error('Libellé requis'); return; }
    const tva = Number(String(form.default_vat_rate).replace(',', '.'));
    if (!Number.isFinite(tva) || tva < 0 || tva >= 100) { toast.error('TVA : entre 0 et 100'); return; }
    const payload = {
      label: form.label.trim(),
      sort_order: parseInt(form.sort_order, 10) || 0,
      is_active: form.is_active,
      certificate_profile: form.certificate_profile,
      default_vat_rate: tva,
    };
    // Le code n'est envoyé qu'à la création : immuable ensuite (la base le refuse aussi).
    onSave(isEdit ? payload : { ...payload, code });
  };

  const profil = CERTIFICATE_PROFILES.find((p) => p.value === form.certificate_profile);

  return (
    <ModalShell title={isEdit ? 'Modifier la catégorie' : 'Nouvelle catégorie'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Code" required>
            <TextInput
              value={form.code}
              onChange={(v) => set('code', v)}
              placeholder="pac_air_air"
              disabled={isEdit}
            />
            {isEdit
              ? <p className="text-xs text-secondary-400 mt-1">Immuable : les certificats le référencent.</p>
              : <p className="text-xs text-secondary-400 mt-1">Minuscules, chiffres, _ — définitif après création.</p>}
          </FormField>
          <FormField label="Libellé" required>
            <TextInput value={form.label} onChange={(v) => set('label', v)} placeholder="PAC Air/Air" />
          </FormField>
        </div>

        <FormField label="Gabarit du certificat d'entretien" required>
          <select
            value={form.certificate_profile}
            onChange={(e) => set('certificate_profile', e.target.value)}
            className={selectClass}
          >
            {CERTIFICATE_PROFILES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          {profil && <p className="text-xs text-secondary-500 mt-1">{profil.label} : {profil.description}.</p>}
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="TVA par défaut (%)">
            <TextInput value={form.default_vat_rate} onChange={(v) => set('default_vat_rate', v)} type="number" min="0" max="99.99" step="0.1" />
            <div className="flex gap-1 mt-1">
              {TVA_SUGGESTIONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set('default_vat_rate', String(t))}
                  className={`px-2 py-0.5 rounded text-xs border ${Number(form.default_vat_rate) === t ? 'bg-primary-600 text-white border-primary-600' : 'border-secondary-300 text-secondary-600 hover:border-primary-400'}`}
                >
                  {String(t).replace('.', ',')} %
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Ordre">
            <TextInput value={form.sort_order} onChange={(v) => set('sort_order', v)} type="number" />
          </FormField>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Active (proposée dans les sélecteurs)
        </label>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="submit" disabled={isSaving} className="btn-primary">
            {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {isEdit ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export default CategoriesPanel;
