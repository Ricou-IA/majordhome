// src/apps/artisan/pages/settings/pennylane/TemplatesSection.jsx
// ============================================================================
// Settings → Facturation : gabarits de facture d'entretien PAR CATÉGORIE d'équipement
// (Eric, 2026-09-23 : « pas une usine à gaz, paramétrable facilement pour un tiers »).
// Trois champs par catégorie, tous facultatifs : libellé de la ligne, objet de la facture,
// ligne offerte (libellé + prix HT + TVA, toujours remisée à 100 %). Vide = comportement par
// défaut. Consommé par buildEntretienInvoice dans les deux modes (brouillon PL et hub).
// Présentationnel : l'état vit dans FacturationTab (form.templates_by_category).
// ============================================================================
import { VAT_CODES } from '@/lib/entretienInvoiceModel';

const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
const VAT_OPTIONS = Object.keys(VAT_CODES).map(Number).sort((a, b) => b - a);

export const EMPTY_TEMPLATE = Object.freeze({ label: '', subject: '', offered_label: '', offered_price_ht: '', offered_vat: '10' });

/**
 * @param {object} p
 * @param {Array<{ id: string, label: string }>} p.categories
 * @param {Object<string, typeof EMPTY_TEMPLATE>} p.value  form.templates_by_category
 * @param {(catId: string, patch: object) => void} p.onChange
 * @param {Object<string, string>} p.errors  `{ [catId]: message }`
 */
export default function TemplatesSection({ categories, value, onChange, errors }) {
  return (
    <div className="space-y-6">
      <p className="text-xs text-secondary-500">
        Variables disponibles : <code>{'{type}'}</code> (type d&apos;équipement), <code>{'{marque}'}</code>, <code>{'{modele}'}</code>,{' '}
        <code>{'{serie}'}</code>, <code>{'{contrat}'}</code>. Champ vide = libellé automatique. La ligne offerte apparaît sous chaque
        équipement de la catégorie, au prix indiqué et remisée à 100 % : elle ne change pas le total.
      </p>
      {categories.map((cat) => {
        const t = value?.[cat.id] || EMPTY_TEMPLATE;
        return (
          <div key={cat.id} className="border border-secondary-200 rounded-md p-4">
            <div className="text-sm font-medium text-secondary-900 mb-3">{cat.label}</div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLASS}>Libellé de la ligne d&apos;entretien</label>
                <input type="text" value={t.label} onChange={(e) => onChange(cat.id, { label: e.target.value })} placeholder="Entretien Performance {type} Multimarque" className={INPUT_CLASS} />
              </div>
              <div>
                <label className={LABEL_CLASS}>Objet de la facture</label>
                <input type="text" value={t.subject} onChange={(e) => onChange(cat.id, { subject: e.target.value })} placeholder="Entretien de votre {type} : {marque} {modele}" className={INPUT_CLASS} />
                <p className={HINT_CLASS}>Utilisé quand la facture ne porte qu&apos;un équipement.</p>
              </div>
              <div>
                <label className={LABEL_CLASS}>Ligne offerte — libellé</label>
                <input type="text" value={t.offered_label} onChange={(e) => onChange(cat.id, { offered_label: e.target.value })} placeholder="Ramonage conduit de fumée" className={INPUT_CLASS} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLASS}>Prix HT (€)</label>
                  <input type="number" min="0" step="0.01" value={t.offered_price_ht} onChange={(e) => onChange(cat.id, { offered_price_ht: e.target.value })} className={INPUT_CLASS} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>TVA</label>
                  <select value={t.offered_vat} onChange={(e) => onChange(cat.id, { offered_vat: e.target.value })} className={INPUT_CLASS}>
                    {VAT_OPTIONS.map((v) => <option key={v} value={String(v)}>{String(v).replace('.', ',')} %</option>)}
                  </select>
                </div>
              </div>
            </div>
            {errors?.[cat.id] && <p className="mt-2 text-xs text-red-600">{errors[cat.id]}</p>}
          </div>
        );
      })}
      {categories.length === 0 && <p className={HINT_CLASS}>Aucune catégorie d&apos;équipement active (Paramètres → Équipements).</p>}
    </div>
  );
}
