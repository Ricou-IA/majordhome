// src/apps/artisan/pages/settings/pennylane/TemplatesSection.jsx
// ============================================================================
// Settings → Facturation : gabarits de facture d'entretien PAR CATÉGORIE d'équipement
// (Eric, 2026-09-23 : « pas une usine à gaz, paramétrable facilement pour un tiers » ;
// retour de la même après-midi : les variables sont des chips cliquables, la ligne
// offerte n'a ni prix ni TVA, un aperçu en direct montre le rendu sous chaque champ).
// Deux champs par catégorie, tous facultatifs : libellé de la ligne, objet de la
// facture, ligne offerte (libellé seul, toujours à 0 € au taux de la ligne d'équipement
// qu'elle suit). Vide = comportement par défaut. Consommé par buildEntretienInvoice
// dans les deux modes (brouillon PL et hub). Présentationnel : l'état vit dans
// FacturationTab (form.templates_by_category), le seul état local ici est la carte
// de refs des champs (pour insérer une variable au curseur).
// ============================================================================
import { useRef } from 'react';
import { renderInvoiceTemplate } from '@/lib/entretienInvoiceModel';

const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
const PREVIEW_CLASS = 'mt-1 text-xs text-secondary-500 italic';
const CHIP_CLASS = 'text-[11px] px-2 py-0.5 rounded-full border border-secondary-300 bg-secondary-50 hover:bg-secondary-100 font-mono';

const VARIABLES = ['type', 'marque', 'modele', 'serie', 'contrat'];

export const EMPTY_TEMPLATE = Object.freeze({ label: '', subject: '', offered_label: '' });

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
 */
export default function TemplatesSection({ categories, typesByCategory, value, onChange }) {
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
        automatique. La ligne offerte apparaît sous chaque équipement de la famille, à 0 €, avec la mention « Offert dans le cadre du
        contrat d&apos;entretien ».
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
        return (
          <div key={cat.id} className="border border-secondary-200 rounded-md p-4">
            <div className="text-sm font-medium text-secondary-900 mb-3">{cat.label}</div>
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
              <div>
                <label className={LABEL_CLASS}>Ligne offerte (libellé)</label>
                <input
                  type="text"
                  value={t.offered_label}
                  onChange={(e) => onChange(cat.id, { offered_label: e.target.value })}
                  placeholder="Ramonage conduit de fumée"
                  className={INPUT_CLASS}
                />
                {t.offered_label && (
                  <p className={PREVIEW_CLASS}>Aperçu : {t.offered_label} — Offert dans le cadre du contrat d&apos;entretien — 0,00 €</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {categories.length === 0 && <p className={HINT_CLASS}>Aucune catégorie d&apos;équipement active (Paramètres → Équipements).</p>}
    </div>
  );
}
