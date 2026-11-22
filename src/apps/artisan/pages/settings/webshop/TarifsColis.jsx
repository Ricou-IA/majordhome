// src/apps/artisan/pages/settings/webshop/TarifsColis.jsx
// Grille de port colis au poids (`webshop_shipping_rates`, écrite par RPC). `price_ttc` en EUROS.
// Tranches [min, max[ ; deux tranches actives qui se chevauchent sont refusées ICI (la base ne
// le contrôle pas).
import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useWebshopSettingsMutations, useWebshopShippingRates } from '@hooks/useWebshopSettings';
import { messageErreurWebshop, trancheEnConflit, validerTarif } from '@/lib/webshop/settingsForm';
import { CARD, Chargement, INPUT, SECTION_TITLE } from './common';

const kg = (v) => (v === null || v === undefined ? '' : String(Number(v)).replace('.', ','));
const euros = (v) => `${Number(v).toFixed(2).replace('.', ',')} €`;
const tranche = (t) => (t.max_weight_kg === null ? `${kg(t.min_weight_kg)} kg et plus` : `${kg(t.min_weight_kg)} à ${kg(t.max_weight_kg)} kg`);

/** Refus local d'un chevauchement : renvoie le message, ou null. */
function conflit(tarifs, candidat) {
  const t = trancheEnConflit(tarifs, candidat);
  return t ? `Chevauche la tranche « ${t.label} » (${tranche(t)})` : null;
}

function FormTarif({ edition, tarifs, onClose }) {
  const { upsertShippingRate, isSavingRate } = useWebshopSettingsMutations();
  const [f, setF] = useState(edition);
  const { erreurs, valeur } = validerTarif(f);
  const chevauche = Object.keys(erreurs).length ? null : conflit(tarifs, { id: f.id, ...valeur, is_active: f.is_active });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const enregistrer = async () => {
    try {
      await upsertShippingRate(f.id ? { id: f.id, ...valeur } : { ...valeur, is_active: f.is_active });
      toast.success('Tranche enregistrée');
      onClose();
    } catch (err) {
      toast.error(messageErreurWebshop(err));
    }
  };

  const champ = (k, label, placeholder) => (
    <div>
      <input value={f[k]} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} aria-label={label} className={INPUT} />
      {erreurs[k] && <p className="mt-1 text-xs text-red-600">{erreurs[k]}</p>}
    </div>
  );

  return (
    <div className="rounded-md border border-primary-200 bg-primary-50/40 p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        {champ('label', 'Libellé', 'Libellé affiché')}
        {champ('min', 'Poids minimum (kg)', 'De (kg, inclus)')}
        {champ('max', 'Poids maximum (kg)', 'À (kg, exclu) — vide = sans plafond')}
        {champ('prix', 'Prix TTC (€)', 'Prix TTC (€)')}
      </div>
      {chevauche && <p className="text-xs text-red-600">{chevauche}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-secondary-600">Annuler</button>
        <button
          type="button"
          onClick={enregistrer}
          disabled={isSavingRate || Object.keys(erreurs).length > 0 || !!chevauche}
          className="px-3 py-1.5 rounded-md bg-primary-600 text-white text-sm font-medium disabled:opacity-50"
        >
          Enregistrer la tranche
        </button>
      </div>
    </div>
  );
}

export default function TarifsColis() {
  const { data: tarifs = [], isLoading, error } = useWebshopShippingRates();
  const { upsertShippingRate, deleteShippingRate, isSavingRate } = useWebshopSettingsMutations();
  const [edition, setEdition] = useState(null);
  const [aSupprimer, setASupprimer] = useState(null);

  const basculer = async (t) => {
    const candidat = { ...t, is_active: !t.is_active };
    const msg = conflit(tarifs, candidat);
    if (msg) { toast.error(`Activation refusée : ${msg}`); return; }
    try {
      await upsertShippingRate({ id: t.id, is_active: !t.is_active });
    } catch (err) {
      toast.error(messageErreurWebshop(err));
    }
  };

  const supprimer = async () => {
    try {
      await deleteShippingRate(aSupprimer.id);
      toast.success('Tranche supprimée');
      setASupprimer(null);
    } catch (err) {
      toast.error(messageErreurWebshop(err));
    }
  };

  return (
    <section className={CARD}>
      <h2 className={SECTION_TITLE}>Grille de port au poids</h2>
      <p className="text-xs text-secondary-500 mb-3">Prix TTC en euros. Une tranche couvre du poids minimum (inclus) au poids maximum (exclu).</p>
      {isLoading && <Chargement />}
      {error && <p className="text-sm text-red-600">Chargement impossible : {error.message}</p>}
      <div className="divide-y divide-secondary-100">
        {tarifs.map((t) => (edition?.id === t.id ? (
          <FormTarif key={t.id} edition={edition} tarifs={tarifs} onClose={() => setEdition(null)} />
        ) : (
          <div key={t.id} className={`flex flex-wrap items-center gap-3 py-2 text-sm ${t.is_active ? '' : 'opacity-50'}`}>
            <span className="flex-1 min-w-[10rem] text-secondary-900">{t.label}</span>
            <span className="text-secondary-600 w-40">{tranche(t)}</span>
            <span className="font-medium w-24 text-right">{euros(t.price_ttc)}</span>
            <label className="flex items-center gap-1 text-xs text-secondary-600">
              <input type="checkbox" checked={t.is_active} disabled={isSavingRate} onChange={() => basculer(t)} /> Active
            </label>
            <button type="button" onClick={() => setEdition({ id: t.id, label: t.label, min: kg(t.min_weight_kg), max: kg(t.max_weight_kg), prix: String(t.price_ttc).replace('.', ','), is_active: t.is_active })} className="p-1.5 text-secondary-400 hover:text-primary-600" aria-label="Modifier la tranche">
              <Pencil className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setASupprimer(t)} className="p-1.5 text-secondary-400 hover:text-red-600" aria-label="Supprimer la tranche">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )))}
      </div>
      {edition && !edition.id && <div className="mt-3"><FormTarif edition={edition} tarifs={tarifs} onClose={() => setEdition(null)} /></div>}
      {!edition && (
        <button type="button" onClick={() => setEdition({ id: null, label: '', min: '', max: '', prix: '', is_active: true })} className="mt-3 inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-800">
          <Plus className="w-4 h-4" /> Ajouter une tranche
        </button>
      )}
      <ConfirmDialog
        open={!!aSupprimer}
        onOpenChange={(o) => !o && setASupprimer(null)}
        title="Supprimer la tranche"
        description={aSupprimer ? `« ${aSupprimer.label} » (${tranche(aSupprimer)}) sera retirée de la grille. Pour la suspendre seulement, décochez « Active ».` : ''}
        confirmLabel="Supprimer"
        onConfirm={supprimer}
        loading={isSavingRate}
      />
    </section>
  );
}
