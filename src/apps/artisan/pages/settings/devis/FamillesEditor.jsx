// src/apps/artisan/pages/settings/devis/FamillesEditor.jsx
// Accordéon « Familles et chapitres » : la liste des installations proposées dans « Nouveau devis » et le
// squelette (titres de chapitre) de chacune. Édition pure d'état : la validation est dans devisConfig.js.
import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { CATEGORIES_PRODUIT, TYPES_CHAPITRE, TAUX_TVA, slugFamille, typeChapitreDeduit, nouvelleFamille } from '@/lib/devisConfig.js';

const INPUT = 'w-full px-2.5 py-1.5 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const TYPE_LABELS = { equipement: 'Équipement (catégorie de la famille)', option: 'Options (catégorie de la famille)', stock: 'Matériel stocké (toutes familles)', main_oeuvre: 'Main d’œuvre', libre: 'Libre (tout le catalogue)', fumisterie: 'Fumisterie (métré assisté)' };
const CATEGORIE_LABELS = { poele: 'Poêle', climatisation: 'Climatisation', chauffage: 'Chauffage', fumisterie: 'Fumisterie', batterie: 'Batterie', photovoltaique: 'Photovoltaïque', borne_recharge: 'Borne de recharge' };

function deplacer(arr, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Chapitres d'une famille du formulaire (`chapitres` typés, sinon titres seuls déduits). */
const chapitresDe = (f) => (Array.isArray(f.chapitres) ? f.chapitres : (f.sections || []).map((t) => ({ titre: t, type: typeChapitreDeduit(t) })));

export default function FamillesEditor({ familles, onChange }) {
  const [ouverte, setOuverte] = useState(null);
  const set = (i, patch) => onChange(familles.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setChapitres = (i, chapitres) => set(i, { chapitres, sections: chapitres.map((c) => c.titre) });
  const ajouter = () => {
    const n = familles.length + 1;
    onChange([...familles, nouvelleFamille(n)]);
    setOuverte(familles.length);
  };
  const retirer = (i) => { onChange(familles.filter((_, j) => j !== i)); setOuverte(null); };

  return (
    <div className="space-y-2">
      {familles.map((f, i) => {
        const open = ouverte === i;
        return (
          <div key={f.key} className={`rounded-lg border ${f.actif ? 'border-secondary-200' : 'border-dashed border-secondary-300 opacity-70'}`}>
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" onClick={() => setOuverte(open ? null : i)} className="flex items-center gap-2 flex-1 text-left text-sm font-medium text-secondary-800" aria-expanded={open}>
                {open ? <ChevronDown className="w-4 h-4 text-secondary-400" /> : <ChevronRight className="w-4 h-4 text-secondary-400" />}
                <span>{f.label || <em className="text-secondary-400">sans nom</em>}</span>
                <span className="text-xs text-secondary-400 font-normal">· {chapitresDe(f).length} chapitre{chapitresDe(f).length > 1 ? 's' : ''} · TVA {String(f.tva ?? 10).replace('.', ',')} %{f.categories?.length ? ` · ${f.categories.map((c) => CATEGORIE_LABELS[c] || c).join(' + ')}` : ''}{f.actif ? '' : ' · masquée'}</span>
              </button>
              <button type="button" onClick={() => onChange(deplacer(familles, i, -1))} disabled={i === 0} className="p-1 text-secondary-400 hover:text-secondary-700 disabled:opacity-30" aria-label="Monter"><ArrowUp className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => onChange(deplacer(familles, i, 1))} disabled={i === familles.length - 1} className="p-1 text-secondary-400 hover:text-secondary-700 disabled:opacity-30" aria-label="Descendre"><ArrowDown className="w-3.5 h-3.5" /></button>
            </div>
            {open && (
              <div className="px-3 pb-3 space-y-3 border-t border-secondary-100 pt-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block text-xs text-secondary-600">Libellé
                    <input value={f.label} onChange={(e) => set(i, { label: e.target.value, key: f.key.startsWith('famille_') && /^famille_[a-z0-9]+$/.test(f.key) ? (slugFamille(e.target.value) || f.key) : f.key })} className={`${INPUT} mt-1`} />
                  </label>
                  <div className="block text-xs text-secondary-600">Catégories des chapitres Équipement et Options <span className="text-secondary-400">(aucune = tout le catalogue)</span>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {CATEGORIES_PRODUIT.map((c) => {
                        const coche = (f.categories || []).includes(c);
                        return (
                          <label key={c} className="flex items-center gap-1 text-sm text-secondary-700">
                            <input type="checkbox" checked={coche} onChange={(e) => set(i, { categories: e.target.checked ? [...(f.categories || []), c] : (f.categories || []).filter((x) => x !== c) })} />
                            {CATEGORIE_LABELS[c]}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <label className="block text-xs text-secondary-600 max-w-xs">TVA par défaut des devis de cette famille <span className="text-secondary-400">(modifiable dans chaque devis)</span>
                  <select value={f.tva ?? 10} onChange={(e) => set(i, { tva: Number(e.target.value) })} className={`${INPUT} mt-1`}>
                    {TAUX_TVA.map((t) => <option key={t} value={t}>{String(t).replace('.', ',')} %</option>)}
                  </select>
                </label>
                <div>
                  <div className="text-xs text-secondary-600 mb-1">Chapitres du devis, dans l’ordre — le type décide de ce que propose le catalogue du chapitre</div>
                  <div className="space-y-1.5">
                    {chapitresDe(f).map((c, k, arr) => (
                      <div key={k} className="flex items-center gap-1.5">
                        <input value={c.titre} onChange={(e) => setChapitres(i, arr.map((x, m) => (m === k ? { ...x, titre: e.target.value.toUpperCase() } : x)))} className={INPUT} placeholder="TITRE DU CHAPITRE" />
                        <select value={c.type} onChange={(e) => setChapitres(i, arr.map((x, m) => (m === k ? { ...x, type: e.target.value } : x)))} className={`${INPUT} max-w-[15rem]`} aria-label="Type du chapitre">
                          {TYPES_CHAPITRE.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                        </select>
                        <button type="button" onClick={() => setChapitres(i, deplacer(arr, k, -1))} disabled={k === 0} className="p-1 text-secondary-400 hover:text-secondary-700 disabled:opacity-30" aria-label="Monter"><ArrowUp className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => setChapitres(i, deplacer(arr, k, 1))} disabled={k === arr.length - 1} className="p-1 text-secondary-400 hover:text-secondary-700 disabled:opacity-30" aria-label="Descendre"><ArrowDown className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => setChapitres(i, arr.filter((_, m) => m !== k))} className="p-1 text-secondary-400 hover:text-red-600" aria-label="Retirer le chapitre"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setChapitres(i, [...chapitresDe(f), { titre: '', type: 'equipement' }])} className="mt-1.5 text-xs text-primary-700 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Ajouter un chapitre</button>
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.actif} onChange={(e) => set(i, { actif: e.target.checked })} /> Proposée dans « Nouveau devis »</label>
                  <button type="button" onClick={() => retirer(i)} className="text-xs text-secondary-500 hover:text-red-600 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Supprimer la famille</button>
                </div>
                <p className="text-xs text-secondary-400">Les devis et devis types déjà créés gardent leur famille par son libellé : renommer une famille ne les détache pas, la supprimer les laisse orphelins.</p>
              </div>
            )}
          </div>
        );
      })}
      <button type="button" onClick={ajouter} className="btn-secondary text-sm flex items-center gap-2"><Plus className="w-4 h-4" /> Ajouter une famille</button>
    </div>
  );
}
