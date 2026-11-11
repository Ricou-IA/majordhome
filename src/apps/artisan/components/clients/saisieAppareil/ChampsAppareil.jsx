/**
 * ChampsAppareil.jsx — marque, modèle et rattachement au référentiel dans « Ajouter / Modifier un équipement ».
 * La marque propose son écriture de référence ; un équipement rattaché montre sa fiche ; sinon « Vérifier
 * l'appareil » (base locale puis web). Présentationnel : l'état vit dans EquipmentFormModal.
 */

import MarqueReference from './MarqueReference';
import AppareilRattache from './AppareilRattache';
import VerifierAppareil from './VerifierAppareil';

const INPUT = 'w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors text-sm disabled:bg-gray-50 disabled:text-gray-400';

/**
 * @param {object} p
 * @param {{ brand: string, model: string, equipmentTypeId: string }} p.form
 * @param {(field: string, value: string) => void} p.onChange
 * @param {(value: string) => void} p.onModelChange
 * @param {(name: string) => void} p.onBrandReference écriture de référence acceptée (sans effacer le modèle)
 * @param {Array<{ id: string, name: string }>} p.suppliers suggestions de marque
 * @param {Array<{ id: string, name: string, reference?: string }>} p.supplierProducts suggestions de modèle
 * @param {boolean} p.suppliersLoading
 * @param {Array<{ name: string, brand_key: string }>} p.marques marques de référence
 * @param {string|null} p.ficheId fiche rattachée
 * @param {object|null} p.fiche
 * @param {boolean} p.ficheLoading
 * @param {(modelId: string) => void} p.onChoisirFiche
 * @param {() => void} p.onRetirerFiche
 * @param {() => void} p.onChangerFiche
 * @param {boolean} p.verification afficher « Vérifier l'appareil »
 * @param {string|null} p.typeLabel
 * @param {object[]} p.champs caractéristiques demandées à la recherche web
 */
export default function ChampsAppareil({
  form, onChange, onModelChange, onBrandReference, suppliers, supplierProducts, suppliersLoading, marques,
  ficheId, fiche, ficheLoading, onChoisirFiche, onRetirerFiche, onChangerFiche, verification, typeLabel, champs,
}) {
  const peutVerifier = verification && !ficheId && form.brand.trim() && form.model.trim();
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Marque</label>
        <input
          type="text" list="brand-suggestions" value={form.brand} onChange={(e) => onChange('brand', e.target.value)}
          disabled={suppliersLoading} placeholder="Saisir ou sélectionner une marque..." autoComplete="off" className={INPUT}
        />
        <datalist id="brand-suggestions">
          {marques.map((m) => <option key={m.brand_key} value={m.name} />)}
          {suppliers.filter((s) => !marques.some((m) => m.name === s.name.toUpperCase())).map((s) => <option key={s.id} value={s.name} />)}
        </datalist>
        <MarqueReference saisie={form.brand} marques={marques} onAccept={onBrandReference} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Modèle</label>
        <input
          type="text" list="model-suggestions" value={form.model} onChange={(e) => onModelChange(e.target.value)}
          placeholder={form.brand ? 'Saisir ou sélectionner un modèle...' : 'Saisir un modèle...'} autoComplete="off" className={INPUT}
        />
        {supplierProducts.length > 0 && (
          <datalist id="model-suggestions">
            {supplierProducts.map((p) => <option key={p.id} value={p.name}>{p.reference ? `Réf: ${p.reference}` : ''}</option>)}
          </datalist>
        )}
      </div>

      {ficheId && <AppareilRattache fiche={fiche} isLoading={ficheLoading} onChanger={onChangerFiche} onRetirer={onRetirerFiche} />}
      {peutVerifier && (
        <VerifierAppareil
          key={`${form.brand}|${form.model}`} brand={form.brand.trim()} model={form.model.trim()}
          equipmentTypeId={form.equipmentTypeId || null} typeLabel={typeLabel} champs={champs} onChoisir={onChoisirFiche}
        />
      )}
    </>
  );
}
