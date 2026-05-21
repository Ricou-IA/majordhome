/**
 * PricingSettings.jsx — Gestion de la grille tarifaire (per-org)
 * ============================================================================
 * Onglets : Zones / Types d'équipement / Tarifs / Remises / Extras
 * Toutes les écritures passent par `pricingService` + RLS policies org_id.
 * ============================================================================
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePricingAdmin } from '@hooks/usePricing';
import { FormField, TextInput, TextArea } from '../../components/FormFields';
import { formatEuro } from '@/lib/utils';
import { Plus, Pencil, Trash2, Loader2, MapPin, Wrench, Grid3x3, Percent, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

const TABS = [
  { key: 'zones', label: 'Zones', icon: MapPin },
  { key: 'equipmentTypes', label: 'Types d\'équipement', icon: Wrench },
  { key: 'rates', label: 'Grille tarifaire', icon: Grid3x3 },
  { key: 'discounts', label: 'Remises volume', icon: Percent },
  { key: 'extras', label: 'Options', icon: Sparkles },
];

// =============================================================================
// Page principale
// =============================================================================

export default function PricingSettings() {
  const [tab, setTab] = useState('zones');
  const admin = usePricingAdmin();

  if (!admin.orgId) {
    return (
      <div className="card text-center py-12 text-secondary-500">
        Chargement de l'organisation...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-secondary-500">
        <Link to="/settings" className="hover:text-secondary-700">Paramètres</Link>
        <span>/</span>
        <span className="text-secondary-900">Tarification</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-secondary-900">Tarification</h1>
        <p className="text-secondary-600">Gérez la grille tarifaire de votre organisation : zones, types d'équipement, tarifs, remises et options.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-secondary-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 whitespace-nowrap ${
              tab === t.key
                ? 'border-primary-500 text-primary-700'
                : 'border-transparent text-secondary-500 hover:text-secondary-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenu */}
      {admin.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
        </div>
      ) : (
        <div className="card">
          {tab === 'zones' && <ZonesPanel admin={admin} />}
          {tab === 'equipmentTypes' && <EquipmentTypesPanel admin={admin} />}
          {tab === 'rates' && <RatesPanel admin={admin} />}
          {tab === 'discounts' && <DiscountsPanel admin={admin} />}
          {tab === 'extras' && <ExtrasPanel admin={admin} />}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Helpers UI
// =============================================================================

function ToolbarHeader({ title, count, onAdd, addLabel }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <p className="text-sm text-secondary-500">{count} {title.toLowerCase()}</p>
      <button onClick={onAdd} className="btn-primary btn-sm">
        <Plus className="w-4 h-4 mr-1" /> {addLabel}
      </button>
    </div>
  );
}

function ActionButtons({ onEdit, onDelete }) {
  return (
    <div className="flex gap-1 justify-end">
      <button onClick={onEdit} className="p-1.5 hover:bg-primary-50 rounded" title="Modifier">
        <Pencil className="w-3.5 h-3.5 text-primary-500" />
      </button>
      <button onClick={onDelete} className="p-1.5 hover:bg-red-50 rounded" title="Supprimer">
        <Trash2 className="w-3.5 h-3.5 text-red-400" />
      </button>
    </div>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-lg font-semibold text-secondary-900">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-secondary-100 rounded">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

// =============================================================================
// ONGLET ZONES
// =============================================================================

function ZonesPanel({ admin }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleDelete = async (zone) => {
    if (!window.confirm(`Supprimer la zone "${zone.label}" ?`)) return;
    try {
      await admin.deleteZone.mutateAsync(zone.id);
      toast.success('Zone supprimée');
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    }
  };

  return (
    <div>
      <ToolbarHeader
        title="Zones"
        count={admin.zones.length}
        addLabel="Zone"
        onAdd={() => { setEditing(null); setShowModal(true); }}
      />

      {admin.zones.length === 0 ? (
        <div className="text-center py-12 text-secondary-500">
          <MapPin className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>Aucune zone tarifaire — créez-en une pour démarrer</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-left text-secondary-500">
                <th className="py-2 pr-3 font-medium">Code</th>
                <th className="py-2 pr-3 font-medium">Libellé</th>
                <th className="py-2 pr-3 font-medium">Départements</th>
                <th className="py-2 pr-3 font-medium text-right">Supplément</th>
                <th className="py-2 pr-3 font-medium text-center">Défaut</th>
                <th className="py-2 pr-3 font-medium text-center">Actif</th>
                <th className="py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {admin.zones.map((zone) => (
                <tr key={zone.id} className="border-b border-secondary-100">
                  <td className="py-2 pr-3 font-mono text-xs">{zone.code}</td>
                  <td className="py-2 pr-3 font-medium text-secondary-900">{zone.label}</td>
                  <td className="py-2 pr-3 text-secondary-500 text-xs">{(zone.departments || []).join(', ') || '—'}</td>
                  <td className="py-2 pr-3 text-right">{formatEuro(zone.supplement || 0)}</td>
                  <td className="py-2 pr-3 text-center">{zone.is_default ? '✓' : ''}</td>
                  <td className="py-2 pr-3 text-center">{zone.is_active ? '✓' : '—'}</td>
                  <td className="py-2 pr-3">
                    <ActionButtons
                      onEdit={() => { setEditing(zone); setShowModal(true); }}
                      onDelete={() => handleDelete(zone)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ZoneModal
          zone={editing}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSave={async (payload) => {
            try {
              if (editing) await admin.updateZone.mutateAsync({ id: editing.id, payload });
              else await admin.createZone.mutateAsync(payload);
              toast.success('Zone enregistrée');
              setShowModal(false);
              setEditing(null);
            } catch (err) {
              toast.error(err?.message || 'Erreur');
            }
          }}
          isSaving={admin.createZone.isPending || admin.updateZone.isPending}
        />
      )}
    </div>
  );
}

function ZoneModal({ zone, onClose, onSave, isSaving }) {
  const [form, setForm] = useState({
    code: zone?.code || '',
    label: zone?.label || '',
    description: zone?.description || '',
    departments: (zone?.departments || []).join(', '),
    supplement: zone?.supplement?.toString() || '0',
    is_default: zone?.is_default || false,
    is_active: zone?.is_active ?? true,
    sort_order: zone?.sort_order || 0,
    min_driving_minutes: zone?.min_driving_minutes ?? '',
    max_driving_minutes: zone?.max_driving_minutes ?? '',
  });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.code.trim() || !form.label.trim()) {
      toast.error('Code et libellé requis');
      return;
    }
    onSave({
      code: form.code.trim().toUpperCase(),
      label: form.label.trim(),
      description: form.description.trim() || null,
      departments: form.departments.split(',').map((d) => d.trim()).filter(Boolean),
      supplement: parseFloat(form.supplement) || 0,
      is_default: form.is_default,
      is_active: form.is_active,
      sort_order: parseInt(form.sort_order, 10) || 0,
      min_driving_minutes: form.min_driving_minutes === '' ? null : parseInt(form.min_driving_minutes, 10),
      max_driving_minutes: form.max_driving_minutes === '' ? null : parseInt(form.max_driving_minutes, 10),
    });
  };

  return (
    <ModalShell title={zone ? 'Modifier la zone' : 'Nouvelle zone'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Code" required>
            <TextInput value={form.code} onChange={(v) => set('code', v)} placeholder="HZ, Z1, ..." />
          </FormField>
          <FormField label="Libellé" required>
            <TextInput value={form.label} onChange={(v) => set('label', v)} placeholder="Hors zone" />
          </FormField>
        </div>
        <FormField label="Description">
          <TextArea value={form.description} onChange={(v) => set('description', v)} rows={2} />
        </FormField>
        <FormField label="Départements (codes 2 chiffres, séparés par virgules)">
          <TextInput value={form.departments} onChange={(v) => set('departments', v)} placeholder="81, 82, 31" />
        </FormField>
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Supplément €">
            <TextInput value={form.supplement} onChange={(v) => set('supplement', v)} type="number" step="0.01" min="0" />
          </FormField>
          <FormField label="Trajet min">
            <TextInput value={form.min_driving_minutes} onChange={(v) => set('min_driving_minutes', v)} type="number" min="0" />
          </FormField>
          <FormField label="Trajet max">
            <TextInput value={form.max_driving_minutes} onChange={(v) => set('max_driving_minutes', v)} type="number" min="0" />
          </FormField>
        </div>
        <FormField label="Ordre">
          <TextInput value={form.sort_order} onChange={(v) => set('sort_order', v)} type="number" />
        </FormField>
        <div className="flex gap-4 pt-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_default} onChange={(e) => set('is_default', e.target.checked)} />
            Zone par défaut
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            Active
          </label>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="submit" disabled={isSaving} className="btn-primary">
            {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {zone ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// =============================================================================
// ONGLET TYPES D'ÉQUIPEMENT
// =============================================================================

const EQUIPMENT_CATEGORIES = [
  { value: 'poeles', label: 'Poêles & Inserts' },
  { value: 'chaudieres', label: 'Chaudières' },
  { value: 'climatisation', label: 'Climatisation & PAC' },
  { value: 'eau_chaude', label: 'Eau chaude & Solaire' },
  { value: 'energie', label: 'Énergie' },
];

function EquipmentTypesPanel({ admin }) {
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
          <p>Aucun type d'équipement</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-left text-secondary-500">
                <th className="py-2 pr-3 font-medium">Code</th>
                <th className="py-2 pr-3 font-medium">Libellé</th>
                <th className="py-2 pr-3 font-medium">Catégorie</th>
                <th className="py-2 pr-3 font-medium text-center">Tarif unitaire</th>
                <th className="py-2 pr-3 font-medium text-center">Actif</th>
                <th className="py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {admin.equipmentTypes.map((type) => (
                <tr key={type.id} className="border-b border-secondary-100">
                  <td className="py-2 pr-3 font-mono text-xs">{type.code}</td>
                  <td className="py-2 pr-3 font-medium text-secondary-900">{type.label}</td>
                  <td className="py-2 pr-3 text-secondary-500 text-xs">
                    {EQUIPMENT_CATEGORIES.find((c) => c.value === type.category)?.label || type.category || '—'}
                  </td>
                  <td className="py-2 pr-3 text-center">
                    {type.has_unit_pricing ? `${type.included_units} ${type.unit_label || 'inclus'}` : '—'}
                  </td>
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
        <EquipmentTypeModal
          type={editing}
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

function EquipmentTypeModal({ type, onClose, onSave, isSaving }) {
  const [form, setForm] = useState({
    code: type?.code || '',
    label: type?.label || '',
    category: type?.category || '',
    has_unit_pricing: type?.has_unit_pricing || false,
    unit_label: type?.unit_label || '',
    included_units: type?.included_units ?? 0,
    sort_order: type?.sort_order || 0,
    is_active: type?.is_active ?? true,
  });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.code.trim() || !form.label.trim()) {
      toast.error('Code et libellé requis');
      return;
    }
    onSave({
      code: form.code.trim().toUpperCase(),
      label: form.label.trim(),
      category: form.category || null,
      has_unit_pricing: form.has_unit_pricing,
      unit_label: form.has_unit_pricing ? (form.unit_label.trim() || null) : null,
      included_units: form.has_unit_pricing ? (parseInt(form.included_units, 10) || 0) : 0,
      sort_order: parseInt(form.sort_order, 10) || 0,
      is_active: form.is_active,
    });
  };

  return (
    <ModalShell title={type ? 'Modifier le type' : 'Nouveau type'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Code" required>
            <TextInput value={form.code} onChange={(v) => set('code', v)} placeholder="POELE, PAC, ..." />
          </FormField>
          <FormField label="Libellé" required>
            <TextInput value={form.label} onChange={(v) => set('label', v)} />
          </FormField>
        </div>
        <FormField label="Catégorie">
          <select
            value={form.category}
            onChange={(e) => set('category', e.target.value)}
            className="block w-full rounded-lg border border-secondary-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">— Aucune —</option>
            {EQUIPMENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </FormField>
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
          <FormField label="Ordre">
            <TextInput value={form.sort_order} onChange={(v) => set('sort_order', v)} type="number" />
          </FormField>
          <FormField label="">
            <label className="flex items-center gap-2 text-sm pt-2">
              <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
              Actif
            </label>
          </FormField>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="submit" disabled={isSaving} className="btn-primary">
            {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {type ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// =============================================================================
// ONGLET TARIFS (matrice zone × type)
// =============================================================================

function RatesPanel({ admin }) {
  // Map (zone_id, equipment_type_id) → rate row
  const rateMap = {};
  for (const r of admin.rates) {
    rateMap[`${r.zone_id}_${r.equipment_type_id}`] = r;
  }

  const activeZones = admin.zones.filter((z) => z.is_active);
  const activeTypes = admin.equipmentTypes.filter((t) => t.is_active);

  const [editing, setEditing] = useState(null);

  if (activeZones.length === 0 || activeTypes.length === 0) {
    return (
      <div className="text-center py-12 text-secondary-500">
        <Grid3x3 className="w-10 h-10 mx-auto mb-2 opacity-40" />
        <p>Créez d'abord au moins une zone et un type d'équipement pour saisir des tarifs.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-secondary-500 mb-4">
        Cliquez sur une cellule pour saisir ou modifier le tarif (zone × type d'équipement).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-secondary-200 text-left text-secondary-500">
              <th className="py-2 pr-3 font-medium sticky left-0 bg-white">Type</th>
              {activeZones.map((z) => (
                <th key={z.id} className="py-2 pr-3 font-medium text-right whitespace-nowrap">
                  {z.label}
                  <span className="block text-xs text-secondary-400 font-normal">{z.code}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeTypes.map((type) => (
              <tr key={type.id} className="border-b border-secondary-100">
                <td className="py-2 pr-3 sticky left-0 bg-white">
                  <div className="font-medium text-secondary-900">{type.label}</div>
                  <div className="text-xs text-secondary-400 font-mono">{type.code}</div>
                </td>
                {activeZones.map((zone) => {
                  const rate = rateMap[`${zone.id}_${type.id}`];
                  return (
                    <td key={zone.id} className="py-2 pr-3 text-right">
                      <button
                        onClick={() => setEditing({ zone, type, rate })}
                        className="px-3 py-1 rounded hover:bg-secondary-100 min-w-[80px]"
                      >
                        {rate ? (
                          <span className="font-medium text-secondary-900">{formatEuro(rate.price)}</span>
                        ) : (
                          <span className="text-secondary-300">—</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <RateModal
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            try {
              await admin.upsertRate.mutateAsync({
                zone_id: editing.zone.id,
                equipment_type_id: editing.type.id,
                ...payload,
              });
              toast.success('Tarif enregistré');
              setEditing(null);
            } catch (err) {
              toast.error(err?.message || 'Erreur');
            }
          }}
          onDelete={editing.rate ? async () => {
            if (!window.confirm('Supprimer ce tarif ?')) return;
            try {
              await admin.deleteRate.mutateAsync(editing.rate.id);
              toast.success('Tarif supprimé');
              setEditing(null);
            } catch (err) {
              toast.error(err?.message || 'Erreur');
            }
          } : null}
          isSaving={admin.upsertRate.isPending || admin.deleteRate.isPending}
        />
      )}
    </div>
  );
}

function RateModal({ editing, onClose, onSave, onDelete, isSaving }) {
  const [price, setPrice] = useState(editing.rate?.price?.toString() || '');
  const [unitPrice, setUnitPrice] = useState(editing.rate?.unit_price?.toString() || '0');

  const handleSubmit = (e) => {
    e.preventDefault();
    const p = parseFloat(price);
    if (isNaN(p) || p < 0) {
      toast.error('Prix invalide');
      return;
    }
    onSave({ price: p, unit_price: parseFloat(unitPrice) || 0 });
  };

  return (
    <ModalShell title="Tarif" onClose={onClose}>
      <p className="text-sm text-secondary-500 mb-4">
        <span className="font-medium">{editing.zone.label}</span> × <span className="font-medium">{editing.type.label}</span>
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Prix de base HT (€)" required>
          <TextInput value={price} onChange={setPrice} type="number" step="0.01" min="0" placeholder="0,00" />
        </FormField>
        {editing.type.has_unit_pricing && (
          <FormField label={`Prix par ${editing.type.unit_label || 'unité'} supplémentaire (€)`}>
            <TextInput value={unitPrice} onChange={setUnitPrice} type="number" step="0.01" min="0" />
          </FormField>
        )}
        <div className="flex justify-between gap-3 pt-4 border-t">
          {onDelete ? (
            <button type="button" onClick={onDelete} disabled={isSaving} className="btn-secondary text-red-600 hover:bg-red-50">
              Supprimer
            </button>
          ) : <span />}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={isSaving} className="btn-primary">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Enregistrer
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

// =============================================================================
// ONGLET REMISES VOLUME
// =============================================================================

function DiscountsPanel({ admin }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleDelete = async (discount) => {
    if (!window.confirm(`Supprimer la remise "${discount.label}" ?`)) return;
    try {
      await admin.deleteDiscount.mutateAsync(discount.id);
      toast.success('Remise supprimée');
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    }
  };

  return (
    <div>
      <ToolbarHeader
        title="Remises"
        count={admin.discounts.length}
        addLabel="Remise"
        onAdd={() => { setEditing(null); setShowModal(true); }}
      />
      <p className="text-xs text-secondary-400 mb-4">La remise applicable est celle dont le seuil "min équipements" est le plus élevé (et atteint).</p>

      {admin.discounts.length === 0 ? (
        <div className="text-center py-12 text-secondary-500">
          <Percent className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>Aucune remise volume</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-left text-secondary-500">
                <th className="py-2 pr-3 font-medium">Libellé</th>
                <th className="py-2 pr-3 font-medium text-right">Seuil équipements</th>
                <th className="py-2 pr-3 font-medium text-right">Remise %</th>
                <th className="py-2 pr-3 font-medium text-center">Actif</th>
                <th className="py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {admin.discounts.map((discount) => (
                <tr key={discount.id} className="border-b border-secondary-100">
                  <td className="py-2 pr-3 font-medium text-secondary-900">{discount.label}</td>
                  <td className="py-2 pr-3 text-right">≥ {discount.min_equipments}</td>
                  <td className="py-2 pr-3 text-right font-medium">{discount.discount_percent}%</td>
                  <td className="py-2 pr-3 text-center">{discount.is_active ? '✓' : '—'}</td>
                  <td className="py-2 pr-3">
                    <ActionButtons
                      onEdit={() => { setEditing(discount); setShowModal(true); }}
                      onDelete={() => handleDelete(discount)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <DiscountModal
          discount={editing}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSave={async (payload) => {
            try {
              if (editing) await admin.updateDiscount.mutateAsync({ id: editing.id, payload });
              else await admin.createDiscount.mutateAsync(payload);
              toast.success('Remise enregistrée');
              setShowModal(false);
              setEditing(null);
            } catch (err) {
              toast.error(err?.message || 'Erreur');
            }
          }}
          isSaving={admin.createDiscount.isPending || admin.updateDiscount.isPending}
        />
      )}
    </div>
  );
}

function DiscountModal({ discount, onClose, onSave, isSaving }) {
  const [form, setForm] = useState({
    label: discount?.label || '',
    min_equipments: discount?.min_equipments ?? 2,
    discount_percent: discount?.discount_percent ?? 5,
    is_active: discount?.is_active ?? true,
  });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.label.trim()) {
      toast.error('Libellé requis');
      return;
    }
    onSave({
      label: form.label.trim(),
      min_equipments: parseInt(form.min_equipments, 10),
      discount_percent: parseFloat(form.discount_percent),
      is_active: form.is_active,
    });
  };

  return (
    <ModalShell title={discount ? 'Modifier la remise' : 'Nouvelle remise'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Libellé" required>
          <TextInput value={form.label} onChange={(v) => set('label', v)} placeholder="Pack multi-équipements" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Seuil équipements" required>
            <TextInput value={form.min_equipments} onChange={(v) => set('min_equipments', v)} type="number" min="1" />
          </FormField>
          <FormField label="Remise %" required>
            <TextInput value={form.discount_percent} onChange={(v) => set('discount_percent', v)} type="number" step="0.5" min="0" max="100" />
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Active
        </label>
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="submit" disabled={isSaving} className="btn-primary">
            {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {discount ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// =============================================================================
// ONGLET EXTRAS
// =============================================================================

function ExtrasPanel({ admin }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleDelete = async (extra) => {
    if (!window.confirm(`Supprimer "${extra.label}" ?`)) return;
    try {
      await admin.deleteExtra.mutateAsync(extra.id);
      toast.success('Option supprimée');
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    }
  };

  return (
    <div>
      <ToolbarHeader
        title="Options"
        count={admin.extras.length}
        addLabel="Option"
        onAdd={() => { setEditing(null); setShowModal(true); }}
      />

      {admin.extras.length === 0 ? (
        <div className="text-center py-12 text-secondary-500">
          <Sparkles className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>Aucune option supplémentaire</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-left text-secondary-500">
                <th className="py-2 pr-3 font-medium">Code</th>
                <th className="py-2 pr-3 font-medium">Libellé</th>
                <th className="py-2 pr-3 font-medium text-right">Prix unitaire</th>
                <th className="py-2 pr-3 font-medium">Unité</th>
                <th className="py-2 pr-3 font-medium text-center">Actif</th>
                <th className="py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {admin.extras.map((extra) => (
                <tr key={extra.id} className="border-b border-secondary-100">
                  <td className="py-2 pr-3 font-mono text-xs">{extra.code}</td>
                  <td className="py-2 pr-3 font-medium text-secondary-900">{extra.label}</td>
                  <td className="py-2 pr-3 text-right">{formatEuro(extra.price_per_unit)}</td>
                  <td className="py-2 pr-3 text-secondary-500 text-xs">{extra.unit_label || '—'}</td>
                  <td className="py-2 pr-3 text-center">{extra.is_active ? '✓' : '—'}</td>
                  <td className="py-2 pr-3">
                    <ActionButtons
                      onEdit={() => { setEditing(extra); setShowModal(true); }}
                      onDelete={() => handleDelete(extra)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ExtraModal
          extra={editing}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSave={async (payload) => {
            try {
              if (editing) await admin.updateExtra.mutateAsync({ id: editing.id, payload });
              else await admin.createExtra.mutateAsync(payload);
              toast.success('Option enregistrée');
              setShowModal(false);
              setEditing(null);
            } catch (err) {
              toast.error(err?.message || 'Erreur');
            }
          }}
          isSaving={admin.createExtra.isPending || admin.updateExtra.isPending}
        />
      )}
    </div>
  );
}

function ExtraModal({ extra, onClose, onSave, isSaving }) {
  const [form, setForm] = useState({
    code: extra?.code || '',
    label: extra?.label || '',
    price_per_unit: extra?.price_per_unit?.toString() || '0',
    unit_label: extra?.unit_label || '',
    sort_order: extra?.sort_order || 0,
    is_active: extra?.is_active ?? true,
  });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.code.trim() || !form.label.trim()) {
      toast.error('Code et libellé requis');
      return;
    }
    onSave({
      code: form.code.trim().toUpperCase(),
      label: form.label.trim(),
      price_per_unit: parseFloat(form.price_per_unit) || 0,
      unit_label: form.unit_label.trim() || null,
      sort_order: parseInt(form.sort_order, 10) || 0,
      is_active: form.is_active,
    });
  };

  return (
    <ModalShell title={extra ? 'Modifier l\'option' : 'Nouvelle option'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Code" required>
            <TextInput value={form.code} onChange={(v) => set('code', v)} placeholder="GAINE, ..." />
          </FormField>
          <FormField label="Libellé" required>
            <TextInput value={form.label} onChange={(v) => set('label', v)} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Prix unitaire HT (€)" required>
            <TextInput value={form.price_per_unit} onChange={(v) => set('price_per_unit', v)} type="number" step="0.01" min="0" />
          </FormField>
          <FormField label="Libellé unité">
            <TextInput value={form.unit_label} onChange={(v) => set('unit_label', v)} placeholder="mètre, pièce, ..." />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Ordre">
            <TextInput value={form.sort_order} onChange={(v) => set('sort_order', v)} type="number" />
          </FormField>
          <FormField label="">
            <label className="flex items-center gap-2 text-sm pt-2">
              <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
              Active
            </label>
          </FormField>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="submit" disabled={isSaving} className="btn-primary">
            {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {extra ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
