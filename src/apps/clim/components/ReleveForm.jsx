// src/apps/clim/components/ReleveForm.jsx
// Relevé du dimensionnement : logement (isolation, gamme) puis une carte par pièce.
// Aucune logique de calcul ici : le moteur src/lib/clim/dimensionnement.js fait tout.
import { Plus, Trash2 } from 'lucide-react';
import { FormField, inputClass, selectClass } from '@apps/artisan/components/FormFields';
import { CLASSES_ISOLATION, EXPOSITIONS, classeDepuisAnnee } from '@/lib/clim/dimensionnement.js';
import { nouvellePiece } from '../lib/releveState';

const APPAREILS = [
  { value: '0', label: 'Aucun' },
  { value: '150', label: 'Bureau (ordinateur, écran) · 150 W' },
  { value: '300', label: 'Télévision + box · 300 W' },
  { value: '500', label: 'Cuisine ouverte · 500 W' },
  { value: '1000', label: 'Cuisine avec four / plaques · 1 000 W' },
];

export default function ReleveForm({ releve, gammes, onChange }) {
  const setLogement = (patch) => onChange({ ...releve, logement: { ...releve.logement, ...patch } });
  const setPiece = (id, patch) => onChange({ ...releve, pieces: releve.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const ajouter = () => onChange({ ...releve, pieces: [...releve.pieces, nouvellePiece(`Pièce ${releve.pieces.length + 1}`)] });
  const retirer = (id) => onChange({ ...releve, pieces: releve.pieces.filter((p) => p.id !== id) });

  const onAnnee = (v) => {
    const classe = classeDepuisAnnee(v);
    setLogement(classe ? { annee: v, classe_isolation: classe } : { annee: v });
  };
  const gammesListe = gammes?.length ? gammes : [releve.logement.gamme].filter(Boolean);

  return (
    <div className="space-y-5">
      <section className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary-500">Logement</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <FormField label="Année de construction">
            <input type="number" min={1800} max={2100} value={releve.logement.annee} onChange={(e) => onAnnee(e.target.value)} placeholder="ex. 1985" className={inputClass} />
          </FormField>
          <FormField label="Isolation" required>
            <select value={releve.logement.classe_isolation} onChange={(e) => setLogement({ classe_isolation: e.target.value })} className={selectClass}>
              {CLASSES_ISOLATION.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </FormField>
          <FormField label="Gamme proposée">
            <select value={releve.logement.gamme || ''} onChange={(e) => setLogement({ gamme: e.target.value })} className={selectClass}>
              {gammesListe.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </FormField>
        </div>
        <p className="text-xs text-secondary-500">L’année propose une classe d’isolation ; corrigez-la si le logement a été rénové ou n’est pas isolé.</p>
      </section>

      {releve.pieces.map((p, i) => (
        <section key={p.id} className="card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <input value={p.nom} onChange={(e) => setPiece(p.id, { nom: e.target.value })} placeholder={`Pièce ${i + 1}`} className={`${inputClass} max-w-xs font-medium`} aria-label="Nom de la pièce" />
            {releve.pieces.length > 1 && (
              <button type="button" onClick={() => retirer(p.id)} className="p-2 rounded-lg text-secondary-400 hover:text-red-600 hover:bg-red-50" title="Retirer la pièce" aria-label="Retirer la pièce"><Trash2 className="w-4 h-4" /></button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <FormField label="Surface (m²)" required>
              <input type="number" min={1} max={200} step="0.5" value={p.surface_m2} onChange={(e) => setPiece(p.id, { surface_m2: e.target.value })} className={inputClass} />
            </FormField>
            <FormField label="Hauteur (m)">
              <input type="number" min={2} max={6} step="0.1" value={p.hauteur_m} onChange={(e) => setPiece(p.id, { hauteur_m: e.target.value })} className={inputClass} />
            </FormField>
            <FormField label="Exposition" required>
              <select value={p.exposition} onChange={(e) => setPiece(p.id, { exposition: e.target.value })} className={selectClass}>
                {EXPOSITIONS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
              </select>
            </FormField>
            <FormField label="Vitrage (m²)">
              <input type="number" min={0} max={60} step="0.5" value={p.vitrage_m2} onChange={(e) => setPiece(p.id, { vitrage_m2: e.target.value })} placeholder="0" className={inputClass} />
            </FormField>
            <FormField label="Occupants">
              <input type="number" min={0} max={20} value={p.occupants} onChange={(e) => setPiece(p.id, { occupants: e.target.value })} className={inputClass} />
            </FormField>
            <FormField label="Appareils" className="col-span-2 sm:col-span-2">
              <select value={APPAREILS.some((a) => a.value === p.appareils_w) ? p.appareils_w : 'autre'} onChange={(e) => setPiece(p.id, { appareils_w: e.target.value === 'autre' ? '' : e.target.value })} className={selectClass}>
                {APPAREILS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                <option value="autre">Autre (saisir les watts)</option>
              </select>
              {!APPAREILS.some((a) => a.value === p.appareils_w) && (
                <input type="number" min={0} max={5000} value={p.appareils_w} onChange={(e) => setPiece(p.id, { appareils_w: e.target.value })} placeholder="W" className={`${inputClass} mt-1`} aria-label="Appareils en watts" />
              )}
            </FormField>
            <FormField label="Liaison (m)">
              <input type="number" min={0} max={75} step="0.5" value={p.longueur_liaison_m} onChange={(e) => setPiece(p.id, { longueur_liaison_m: e.target.value })} className={inputClass} />
            </FormField>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={p.protection_solaire} onChange={(e) => setPiece(p.id, { protection_solaire: e.target.checked })} /> Volets ou stores extérieurs</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={p.sous_toiture} onChange={(e) => setPiece(p.id, { sous_toiture: e.target.checked })} /> Sous toiture (dernier étage, combles)</label>
          </div>
        </section>
      ))}

      <button type="button" onClick={ajouter} className="btn-secondary flex items-center gap-2"><Plus className="w-4 h-4" /> Ajouter une pièce</button>
    </div>
  );
}
