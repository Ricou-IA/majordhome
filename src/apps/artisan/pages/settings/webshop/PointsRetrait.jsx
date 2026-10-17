// src/apps/artisan/pages/settings/webshop/PointsRetrait.jsx
// Points de retrait de la boutique (`webshop_pickup_points`, écrits par RPC). On ne supprime
// pas un point (des commandes le référencent) : on le désactive. L'identifiant est immuable.
import { useState } from 'react';
import { toast } from 'sonner';
import { MapPin, Pencil, Plus } from 'lucide-react';
import { useWebshopPickupPoints, useWebshopSettingsMutations } from '@hooks/useWebshopSettings';
import { ACCEPTS, messageErreurWebshop, validerPoint } from '@/lib/webshop/settingsForm';
import { CARD, Champ, Chargement, INPUT, SECTION_TITLE } from './common';

const libelleAccepts = (v) => ACCEPTS.find((a) => a.value === v)?.label ?? v;

function FormPoint({ edition, onClose }) {
  const { upsertPickupPoint, isSavingPoint } = useWebshopSettingsMutations();
  const [f, setF] = useState(edition);
  const erreurs = validerPoint(f);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const enregistrer = async () => {
    const commun = { name: f.name.trim(), address: f.address.trim(), opening_hours: f.opening_hours.trim() || null, accepts: f.accepts };
    try {
      await upsertPickupPoint(f.id ? { id: f.id, ...commun } : { slug: f.slug.trim(), ...commun, is_active: true });
      toast.success('Point de retrait enregistré');
      onClose();
    } catch (err) {
      toast.error(messageErreurWebshop(err));
    }
  };

  return (
    <div className="rounded-md border border-primary-200 bg-primary-50/40 p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Champ label="Identifiant" erreur={erreurs.slug} aide={f.id ? 'Non modifiable.' : 'Minuscules et tirets, non modifiable ensuite.'}>
          <input value={f.slug} disabled={!!f.id} onChange={(e) => set('slug', e.target.value)} placeholder="gaillac" className={INPUT} />
        </Champ>
        <Champ label="Nom" erreur={erreurs.name}>
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={INPUT} />
        </Champ>
        <Champ label="Adresse" erreur={erreurs.address} className="sm:col-span-2">
          <input value={f.address} onChange={(e) => set('address', e.target.value)} className={INPUT} />
        </Champ>
        <Champ label="Horaires d’ouverture" aide="Facultatif.">
          <input value={f.opening_hours} onChange={(e) => set('opening_hours', e.target.value)} className={INPUT} />
        </Champ>
        <Champ label="Accepte" erreur={erreurs.accepts}>
          <select value={f.accepts} onChange={(e) => set('accepts', e.target.value)} className={INPUT}>
            {ACCEPTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </Champ>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-secondary-600">Annuler</button>
        <button type="button" onClick={enregistrer} disabled={isSavingPoint || Object.keys(erreurs).length > 0} className="px-3 py-1.5 rounded-md bg-primary-600 text-white text-sm font-medium disabled:opacity-50">
          Enregistrer le point
        </button>
      </div>
    </div>
  );
}

export default function PointsRetrait() {
  const { data: points = [], isLoading, error } = useWebshopPickupPoints();
  const { upsertPickupPoint, isSavingPoint } = useWebshopSettingsMutations();
  const [edition, setEdition] = useState(null);

  const basculer = async (p) => {
    try {
      await upsertPickupPoint({ id: p.id, is_active: !p.is_active });
      toast.success(p.is_active ? 'Point de retrait désactivé' : 'Point de retrait réactivé');
    } catch (err) {
      toast.error(messageErreurWebshop(err));
    }
  };

  return (
    <section className={CARD}>
      <h2 className={SECTION_TITLE}>Points de retrait</h2>
      {isLoading && <Chargement />}
      {error && <p className="text-sm text-red-600">Chargement impossible : {error.message}</p>}
      <div className="divide-y divide-secondary-100">
        {points.map((p) => (edition?.id === p.id ? (
          <FormPoint key={p.id} edition={edition} onClose={() => setEdition(null)} />
        ) : (
          <div key={p.id} className={`flex flex-wrap items-start gap-3 py-2 text-sm ${p.is_active ? '' : 'opacity-50'}`}>
            <MapPin className="w-4 h-4 mt-0.5 text-secondary-400" />
            <div className="flex-1 min-w-[12rem]">
              <div className="text-secondary-900 font-medium">{p.name} <span className="text-xs text-secondary-400">({p.slug})</span></div>
              <div className="text-secondary-600">{p.address}</div>
              {p.opening_hours && <div className="text-xs text-secondary-500">{p.opening_hours}</div>}
            </div>
            <span className="text-xs text-secondary-600 w-36">{libelleAccepts(p.accepts)}</span>
            <label className="flex items-center gap-1 text-xs text-secondary-600">
              <input type="checkbox" checked={p.is_active} disabled={isSavingPoint} onChange={() => basculer(p)} /> Actif
            </label>
            <button type="button" onClick={() => setEdition({ id: p.id, slug: p.slug, name: p.name, address: p.address, opening_hours: p.opening_hours ?? '', accepts: p.accepts })} className="p-1.5 text-secondary-400 hover:text-primary-600" aria-label="Modifier le point de retrait">
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        )))}
      </div>
      {edition && !edition.id && <div className="mt-3"><FormPoint edition={edition} onClose={() => setEdition(null)} /></div>}
      {!edition && (
        <button type="button" onClick={() => setEdition({ id: null, slug: '', name: '', address: '', opening_hours: '', accepts: 'both' })} className="mt-3 inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-800">
          <Plus className="w-4 h-4" /> Ajouter un point de retrait
        </button>
      )}
    </section>
  );
}
