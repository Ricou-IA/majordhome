// src/apps/artisan/pages/settings/pennylane/TemplatesSection.jsx
// ============================================================================
// Settings → Facturation : gabarits de facture d'entretien PAR CATÉGORIE d'équipement
// (Eric, 2026-09-23 : « pas une usine à gaz, paramétrable facilement pour un tiers » ;
// retour de la même après-midi : les variables sont des chips cliquables ; retour
// suivant : la ligne offerte est TARIFÉE — prix HT, TVA (ou celle de la famille) et
// une remise % réglable, 100 % = offerte — un aperçu en direct montre le rendu sous
// chaque champ). Vide = comportement par défaut. Consommé par buildEntretienInvoice
// dans les deux modes (brouillon PL et hub). Présentationnel : l'état vit dans
// FacturationTab (form.templates_by_category), le seul état local ici est la carte
// de refs des champs (pour insérer une variable au curseur).
// ============================================================================
import { useRef } from 'react';
import { renderInvoiceTemplate, VAT_CODES } from '@/lib/entretienInvoiceModel';

const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
const PREVIEW_CLASS = 'mt-1 text-xs text-secondary-500 italic';
const ERROR_CLASS = 'mt-2 text-xs text-red-600';
const CHIP_CLASS = 'text-[11px] px-2 py-0.5 rounded-full border border-secondary-300 bg-secondary-50 hover:bg-secondary-100 font-mono';

const VARIABLES = ['type', 'marque', 'modele', 'serie', 'contrat'];
const VAT_OPTIONS = Object.keys(VAT_CODES).map(Number).sort((a, b) => b - a);
const FAMILY_VAT_FOR_PREVIEW = 20;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt2 = (n) => n.toFixed(2).replace('.', ',');

export const EMPTY_TEMPLATE = Object.freeze({
  label: '',
  subject: '',
  offered_label: '',
  offered_price_ht: '',
  offered_vat: '',
  offered_discount: '100',
});

/** Aperçu "Aperçu : <libellé> — <prix> € HT · TVA <taux|famille> · remise <r> % → <net> € TTC". */
function buildOfferedPreview(t) {
  if (!t.offered_label) return null;
  const priceRaw = t.offered_price_ht;
  const priceNum = priceRaw === '' ? 0 : Number(priceRaw);
  const price = Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : 0;
  const vatRaw = t.offered_vat;
  const vatNum = vatRaw === '' ? null : Number(vatRaw);
  const vatForCalc = vatNum != null && Number.isFinite(vatNum) ? vatNum : FAMILY_VAT_FOR_PREVIEW;
  const discRaw = t.offered_discount;
  const discNum = discRaw === '' ? 100 : Number(discRaw);
  const disc = Number.isFinite(discNum) ? discNum : 100;
  const vatText = vatNum == null ? `TVA de la famille, ex. ${FAMILY_VAT_FOR_PREVIEW} %` : `TVA ${String(vatNum).replace('.', ',')} %`;
  const discText = String(disc).replace('.', ',');
  const netTtc = round2(price * (1 + vatForCalc / 100) * (1 - disc / 100));
  const outcome = disc === 100 ? `0,00 € · Offert dans le cadre du contrat d’entretien` : `${fmt2(netTtc)} € TTC`;
  return `Aperçu : ${t.offered_label} — ${fmt2(price)} € HT · ${vatText} · remise ${discText} % → ${outcome}`;
}

/** Premier type d'une catégorie (`typesByCategory` = Map ou objet, selon l'appelant). */
function firstType(typesByCategory, catId) {
  const arr = typesByCategory instanceof Map ? typesByCategory.get(catId) : typesByCategory?.[catId];
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
}

/**
 * @param {object} p
 * @param {Array<{ id: string, label: string }>} p.categories
 * @param {Map<string, Array<{label:string}>>|Object<string, Array<{label:string}>>} p.typesByCategory
 * @param {Object<string, typeof EMPTY_TEMPLATE>} p.value  form.templates_by_category
 * @param {(catId: string, patch: object) => void} p.onChange
 * @param {Object<string, string>} [p.errors]  erreur de validation par catégorie (`errors.templates`)
 * @param {{ value: Object<string, string>, options: Array<{ number: string, label: string }>, onChange: (catId: string, number: string) => void, disabled?: boolean }} [p.ledger]
 *   compte de vente Pennylane par famille (Eric, 2026-09-23 : « traiter chaque famille dans sa globalité ») —
 *   état `form.ledger_by_category` de FacturationTab, stockage inchangé (`ledger_accounts.by_category`)
 */
export default function TemplatesSection({ categories, typesByCategory, value, onChange, errors, ledger }) {
  // Une entrée par champ texte (`${catId}:${field}`) pour retrouver l'input au clic sur une chip.
  const inputRefs = useRef(new Map());

  const insertVariable = (catId, field, varName, currentValue) => {
    const key = `${catId}:${field}`;
    const el = inputRefs.current.get(key);
    const pos = el && typeof el.selectionStart === 'number' ? el.selectionStart : (currentValue || '').length;
    const before = (currentValue || '').slice(0, pos);
    const after = (currentValue || '').slice(pos);
    const token = `{${varName}}`;
    onChange(catId, { [field]: `${before}${token}${after}` });
    requestAnimationFrame(() => {
      const el2 = inputRefs.current.get(key);
      if (el2) {
        const newPos = pos + token.length;
        el2.focus();
        el2.setSelectionRange(newPos, newPos);
      }
    });
  };

  const registerRef = (catId, field) => (el) => {
    const key = `${catId}:${field}`;
    if (el) inputRefs.current.set(key, el);
    else inputRefs.current.delete(key);
  };

  return (
    <div className="space-y-6">
      <p className="text-xs text-secondary-500">
        Chaque famille d&apos;équipement a son gabarit. Cliquez une variable pour l&apos;insérer dans le champ. Champ vide = libellé
        automatique. La ligne offerte apparaît sous chaque équipement de la famille, à son prix, remisée du pourcentage indiqué (100 %
        = offerte, elle ne change pas le total).
      </p>
      {categories.map((cat) => {
        const t = value?.[cat.id] || EMPTY_TEMPLATE;
        const sampleVars = {
          type: firstType(typesByCategory, cat.id)?.label || cat.label,
          marque: 'Cola',
          modele: 'Fire HR acciaio',
          serie: '0160067',
          contrat: 'CTR-00063',
        };
        const labelPreview = t.label ? renderInvoiceTemplate(t.label, sampleVars) : null;
        const subjectPreview = t.subject ? renderInvoiceTemplate(t.subject, sampleVars) : null;
        const offeredPreview = buildOfferedPreview(t);
        const catError = errors?.[cat.id];
        return (
          <div key={cat.id} className="border border-secondary-200 rounded-md p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="text-sm font-medium text-secondary-900">{cat.label}</div>
              {ledger && (
                <div className="w-full sm:w-80">
                  <label className={LABEL_CLASS}>Compte de vente Pennylane</label>
                  <select
                    value={ledger.value?.[cat.id] || ''}
                    onChange={(e) => ledger.onChange(cat.id, e.target.value)}
                    disabled={ledger.disabled}
                    className={INPUT_CLASS}
                  >
                    <option value="">— Compte par défaut Pennylane —</option>
                    {(ledger.options || []).map((a) => (
                      <option key={a.number} value={a.number}>{a.number} · {a.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLASS}>Libellé de la ligne d&apos;entretien</label>
                <input
                  ref={registerRef(cat.id, 'label')}
                  type="text"
                  value={t.label}
                  onChange={(e) => onChange(cat.id, { label: e.target.value })}
                  placeholder="Entretien Performance {type} Multimarque"
                  className={INPUT_CLASS}
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {VARIABLES.map((v) => (
                    <button key={v} type="button" className={CHIP_CLASS} onClick={() => insertVariable(cat.id, 'label', v, t.label)}>
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
                <p className={PREVIEW_CLASS}>Aperçu : {labelPreview || 'libellé automatique (nom du type)'}</p>
              </div>
              <div>
                <label className={LABEL_CLASS}>Objet de la facture</label>
                <input
                  ref={registerRef(cat.id, 'subject')}
                  type="text"
                  value={t.subject}
                  onChange={(e) => onChange(cat.id, { subject: e.target.value })}
                  placeholder="Entretien de votre {type} : {marque} {modele}"
                  className={INPUT_CLASS}
                />
                <p className={HINT_CLASS}>Utilisé quand la facture ne porte qu&apos;un équipement.</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {VARIABLES.map((v) => (
                    <button key={v} type="button" className={CHIP_CLASS} onClick={() => insertVariable(cat.id, 'subject', v, t.subject)}>
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
                <p className={PREVIEW_CLASS}>Aperçu : {subjectPreview || 'Entretien de votre poêle : Cola · Fire HR acciaio'}</p>
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL_CLASS}>Ligne offerte (libellé)</label>
                <input
                  type="text"
                  value={t.offered_label}
                  onChange={(e) => onChange(cat.id, { offered_label: e.target.value })}
                  placeholder="Ramonage conduit de fumée"
                  className={INPUT_CLASS}
                />
                <div className="mt-3 grid grid-cols-3 gap-4">
                  <div>
                    <label className={LABEL_CLASS}>Prix HT (€)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={t.offered_price_ht}
                      onChange={(e) => onChange(cat.id, { offered_price_ht: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>TVA</label>
                    <select
                      value={t.offered_vat}
                      onChange={(e) => onChange(cat.id, { offered_vat: e.target.value })}
                      className={INPUT_CLASS}
                    >
                      <option value="">TVA de la famille</option>
                      {VAT_OPTIONS.map((v) => (
                        <option key={v} value={v}>{String(v).replace('.', ',')} %</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Remise (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={t.offered_discount}
                      onChange={(e) => onChange(cat.id, { offered_discount: e.target.value })}
                      className={INPUT_CLASS}
                    />
                    <p className={HINT_CLASS}>100 % = offert (mention automatique sur la facture)</p>
                  </div>
                </div>
                {offeredPreview && <p className={PREVIEW_CLASS}>{offeredPreview}</p>}
              </div>
            </div>
            {catError && <p className={ERROR_CLASS}>{catError}</p>}
          </div>
        );
      })}
      {categories.length === 0 && <p className={HINT_CLASS}>Aucune catégorie d&apos;équipement active (Paramètres → Équipements).</p>}
    </div>
  );
}
