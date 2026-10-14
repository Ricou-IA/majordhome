/**
 * ProductFormSections — blocs du drawer produit (formulaire contrôlé, `form` + `set(field, value)`).
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FormField, TextInput, SelectInput, TextArea } from '@apps/artisan/components/FormFields';
import { VAT_RATES, SHIPPING_KINDS, computeMargin, parseDecimal } from '@/lib/webshop/catalog';

const VAT_OPTIONS = VAT_RATES.map((r) => ({ value: String(r), label: `${String(r).replace('.', ',')} %` }));

export function Block({ title, defaultOpen = true, hint, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-secondary-100 last:border-b-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between py-3 text-left">
        <span className="text-sm font-semibold text-secondary-800">{title}</span>
        <span className="flex items-center gap-2 text-xs text-secondary-400">
          {!open && hint}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="pb-4 space-y-3">{children}</div>}
    </section>
  );
}

function NumberInput({ value, onChange, disabled, suffix, placeholder }) {
  return (
    <div className="relative">
      <TextInput value={value} onChange={onChange} disabled={disabled} inputMode="decimal" placeholder={placeholder} />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-secondary-400 pointer-events-none">{suffix}</span>}
    </div>
  );
}

function categoryOptions(categories) {
  const out = [];
  for (const root of categories.filter((c) => !c.parent_id)) {
    out.push({ value: root.id, label: root.name });
    for (const c of categories.filter((x) => x.parent_id === root.id)) out.push({ value: c.id, label: `\u00a0\u00a0\u00a0└ ${c.name}` });
  }
  return out;
}

export function EssentialFields({ form, set, errors, categories, disabled }) {
  return (
    <>
      <FormField label="Nom" required error={errors.name}>
        <TextInput value={form.name} onChange={(v) => set('name', v)} disabled={disabled} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Marque">
          <TextInput value={form.brand} onChange={(v) => set('brand', v)} disabled={disabled} />
        </FormField>
        <FormField label="Catégorie">
          <SelectInput value={form.category_id} onChange={(v) => set('category_id', v ?? '')} options={categoryOptions(categories)} placeholder="— Aucune —" disabled={disabled} />
        </FormField>
      </div>
      <FormField label="Description courte">
        <TextArea value={form.short_description} onChange={(v) => set('short_description', v)} rows={2} disabled={disabled} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Prix TTC" required error={errors.price_ttc}>
          <NumberInput value={form.price_ttc} onChange={(v) => set('price_ttc', v)} disabled={disabled} suffix="€" />
        </FormField>
        <FormField label="TVA" required error={errors.vat_rate}>
          <SelectInput value={form.vat_rate} onChange={(v) => set('vat_rate', v ?? '20')} options={VAT_OPTIONS} disabled={disabled} />
        </FormField>
      </div>
    </>
  );
}

export function StockFields({ form, set, errors, disabled }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Expédition" error={errors.shipping_kind}>
          <SelectInput value={form.shipping_kind} onChange={(v) => set('shipping_kind', v ?? '')} options={SHIPPING_KINDS} disabled={disabled} />
        </FormField>
        {form.shipping_kind === 'pallet' ? (
          <FormField label="Emplacements palette" required error={errors.pallet_slots}>
            <NumberInput value={form.pallet_slots} onChange={(v) => set('pallet_slots', v)} disabled={disabled} />
          </FormField>
        ) : (
          <FormField label="Poids" error={errors.weight_kg}>
            <NumberInput value={form.weight_kg} onChange={(v) => set('weight_kg', v)} disabled={disabled} suffix="kg" />
          </FormField>
        )}
      </div>
      {form.shipping_kind === '' && (
        <p className="text-xs text-secondary-500">Hors boutique : le produit n’apparaît pas dans /boutique (vendu par une page dédiée, ex. la borne).</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Stock" error={errors.stock_qty}>
          <NumberInput value={form.stock_qty} onChange={(v) => set('stock_qty', v)} disabled={disabled} />
        </FormField>
        <FormField label="Délai" error={errors.lead_time_days}>
          <NumberInput value={form.lead_time_days} onChange={(v) => set('lead_time_days', v)} disabled={disabled} suffix="jours" />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm text-secondary-700">
        <input type="checkbox" checked={form.allow_backorder} onChange={(e) => set('allow_backorder', e.target.checked)} disabled={disabled} className="rounded border-secondary-300" />
        Continuer à vendre en rupture de stock
      </label>
    </>
  );
}

export function PoseFields({ form, set, errors, disabled }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <FormField label="Posé particulier TTC" error={errors.install_price_ttc}>
        <NumberInput value={form.install_price_ttc} onChange={(v) => set('install_price_ttc', v)} disabled={disabled} suffix="€" />
      </FormField>
      <FormField label="Posé pro TTC" error={errors.pro_install_price_ttc}>
        <NumberInput value={form.pro_install_price_ttc} onChange={(v) => set('pro_install_price_ttc', v)} disabled={disabled} suffix="€" />
      </FormField>
      <FormField label="TVA pose">
        <SelectInput value={form.install_vat_rate} onChange={(v) => set('install_vat_rate', v ?? '5.5')} options={VAT_OPTIONS} disabled={disabled} />
      </FormField>
    </div>
  );
}

export function PurchaseFields({ form, set, errors, disabled }) {
  const margin = computeMargin({
    priceTtc: parseDecimal(form.price_ttc),
    vatRate: Number(form.vat_rate),
    purchaseHt: parseDecimal(form.purchase_price_ht),
  });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Fournisseur">
          <TextInput value={form.supplier} onChange={(v) => set('supplier', v)} disabled={disabled} />
        </FormField>
        <FormField label="Référence fournisseur">
          <TextInput value={form.supplier_ref} onChange={(v) => set('supplier_ref', v)} disabled={disabled} />
        </FormField>
        <FormField label="EAN">
          <TextInput value={form.ean} onChange={(v) => set('ean', v)} disabled={disabled} />
        </FormField>
        <FormField label="Prix d'achat HT" error={errors.purchase_price_ht}>
          <NumberInput value={form.purchase_price_ht} onChange={(v) => set('purchase_price_ht', v)} disabled={disabled} suffix="€" />
        </FormField>
      </div>
      {margin && (
        <p className={`text-sm ${margin.amount < 0 ? 'text-amber-700' : 'text-secondary-600'}`}>
          Marge : <strong>{margin.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT</strong> ({String(margin.percent).replace('.', ',')} % du prix HT)
        </p>
      )}
    </>
  );
}

export function AdvancedFields({ form, set, disabled, slug, isNew }) {
  return (
    <>
      <FormField label="Description longue">
        <TextArea value={form.long_description} onChange={(v) => set('long_description', v)} rows={6} disabled={disabled} />
      </FormField>
      <FormField label={`Titre SEO (${form.seo_title.length}/60)`}>
        <TextInput value={form.seo_title} onChange={(v) => set('seo_title', v)} disabled={disabled} />
      </FormField>
      <FormField label={`Description SEO (${form.seo_description.length}/160)`}>
        <TextArea value={form.seo_description} onChange={(v) => set('seo_description', v)} rows={2} disabled={disabled} />
      </FormField>
      <FormField label="Adresse de la page">
        <p className="text-sm text-secondary-600 font-mono">
          /boutique/p/{slug || (isNew ? '… (calculée depuis le nom à l’enregistrement)' : '—')}
        </p>
        <p className="text-xs text-secondary-400">Fixée à la création pour ne pas casser les liens et le référencement.</p>
      </FormField>
    </>
  );
}
