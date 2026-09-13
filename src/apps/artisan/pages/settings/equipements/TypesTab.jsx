/**
 * equipements/TypesTab.jsx — Settings → Équipements → onglet « Types »
 * ============================================================================
 * Le RÉFÉRENTIEL des types d'équipement (socle) : code, libellé, catégorie,
 * actif. Ce qui VALORISE un type pour l'entretien (durée, unités, mois
 * déconseillés) vit dans Settings → Tarification → « Durées d'entretien »
 * (pricing/DureesTab.jsx) — même table `pricing_equipment_types`, deux natures,
 * séparées à l'écran pour le découpage par module (Eric, 2026-09-13).
 * Le code n'est envoyé qu'à la création : le site vitrine et les icônes
 * désignent les types par code, un renommage à l'édition les casserait en silence.
 * ============================================================================
 */
import { useState } from 'react';
import { Loader2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { FormField, TextInput } from '@apps/artisan/components/FormFields';
import { ToolbarHeader, ActionButtons, ModalShell, selectClass } from '../pricing/ui';
import { prochainOrdre } from '../pricing/ordre';

export function TypesPanel({ admin }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleDelete = async (type) => {
    if (!window.confirm(`Supprimer le type "${type.label}" ?`)) return;
    try {
      await admin.deleteEquipmentType.mutateAsync(type.id);
      toast.success('Type supprimé');
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const libelleCategorie = (id) => admin.categories.find((c) => c.id === id)?.label || '—';

  return (
    <div>
      <ToolbarHeader
        title="Types"
        count={admin.equipmentTypes.length}
        addLabel="Type"
        onAdd={() => { setEditing(null); setShowModal(true); }}
      />

      {admin.equipmentTypes.length === 0 ? (
        <div className="text-center py-12 text-secondary-500">
          <Wrench className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>Aucun type d&apos;équipement — chaque type appartient à une catégorie</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-left text-secondary-500">
                <th className="py-2 pr-3 font-medium">Code</th>
                <th className="py-2 pr-3 font-medium">Libellé</th>
                <th className="py-2 pr-3 font-medium">Catégorie</th>
                <th className="py-2 pr-3 font-medium text-center">Actif</th>
                <th className="py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {admin.equipmentTypes.map((type) => (
                <tr key={type.id} className="border-b border-secondary-100">
                  <td className="py-2 pr-3 font-mono text-xs">{type.code}</td>
                  <td className="py-2 pr-3 font-medium text-secondary-900">{type.label}</td>
                  <td className="py-2 pr-3 text-secondary-500 text-xs">{libelleCategorie(type.category_id)}</td>
                  <td className="py-2 pr-3 text-center">{type.is_active ? '✓' : '—'}</td>
                  <td className="py-2 pr-3">
                    <ActionButtons
                      onEdit={() => { setEditing(type); setShowModal(true); }}
                      onDelete={() => handleDelete(type)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <TypeModal
          type={editing}
          nextSortOrder={prochainOrdre(admin.equipmentTypes)}
          categories={admin.categories.filter((c) => c.is_active || c.id === editing?.category_id)}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSave={async (payload) => {
            try {
              if (editing) await admin.updateEquipmentType.mutateAsync({ id: editing.id, payload });
              else await admin.createEquipmentType.mutateAsync(payload);
              toast.success('Type enregistré');
              setShowModal(false);
              setEditing(null);
            } catch (err) {
              toast.error(err?.message || 'Erreur');
            }
          }}
          isSaving={admin.createEquipmentType.isPending || admin.updateEquipmentType.isPending}
        />
      )}
    </div>
  );
}

function TypeModal({ type, categories = [], nextSortOrder, onClose, onSave, isSaving }) {
  const isEdit = !!type;
  const [form, setForm] = useState({
    code: type?.code || '',
    label: type?.label || '',
    category_id: type?.category_id || '',
    is_active: type?.is_active ?? true,
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.code.trim() || !form.label.trim()) {
      toast.error('Code et libellé requis');
      return;
    }
    if (!form.category_id) {
      toast.error('Catégorie requise — créez-la dans l\'onglet Catégories si elle n\'existe pas');
      return;
    }
    // Mise à jour PARTIELLE : les champs d'entretien (durée, unités, mois) ne
    // sont pas envoyés, donc jamais écrasés (cf. pricingService.updateEquipmentType).
    onSave({
      ...(isEdit ? {} : { code: form.code.trim(), sort_order: nextSortOrder }),
      label: form.label.trim(),
      category_id: form.category_id,
      is_active: form.is_active,
    });
  };

  return (
    <ModalShell title={isEdit ? 'Modifier le type' : 'Nouveau type'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Code" required>
            <TextInput value={form.code} onChange={(v) => set('code', v)} placeholder="poele_granules_elec" disabled={isEdit} />
            {isEdit && <p className="text-xs text-secondary-400 mt-1">Immuable : site vitrine et icônes le référencent.</p>}
          </FormField>
          <FormField label="Libellé" required>
            <TextInput value={form.label} onChange={(v) => set('label', v)} />
          </FormField>
        </div>
        <FormField label="Catégorie" required>
          <select
            value={form.category_id}
            onChange={(e) => set('category_id', e.target.value)}
            className={selectClass}
            required
          >
            <option value="">— Choisir —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}{c.is_active ? '' : ' (inactive)'}</option>
            ))}
          </select>
          {categories.length === 0 && (
            <p className="text-xs text-amber-700 mt-1">Aucune catégorie active : créez-en une dans l&apos;onglet Catégories.</p>
          )}
          <p className="text-xs text-secondary-400 mt-1">Porte la compétence requise (Équipe) et le gabarit du certificat.</p>
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Actif
        </label>
        <p className="text-xs text-secondary-400">
          Durée d&apos;entretien, tarif unitaire et mois déconseillés se règlent dans Tarification → « Durées d&apos;entretien ».
        </p>
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
