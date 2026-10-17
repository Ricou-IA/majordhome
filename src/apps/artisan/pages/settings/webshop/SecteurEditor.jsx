// src/apps/artisan/pages/settings/webshop/SecteurEditor.jsx
// Édition / création d'un secteur de livraison palette : libellé, dépôt, plafonds, prix d'un
// emplacement (saisi en euros, stocké en centimes), jours de passage (grille semaines 1-4 ×
// lun-ven du cycle) et codes postaux. Écritures par RPC (webshop_sector_upsert puis
// webshop_sector_set_postcodes) ; chaque refus est dit, jamais avalé.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import { useWebshopSectorPostcodes, useWebshopSettingsMutations } from '@hooks/useWebshopSettings';
import {
  JOURS, SEMAINES, basculerPassage, formSecteur, messageErreurWebshop, parserPostcodes,
  payloadSecteur, postcodesVersTexte, validerSecteur,
} from '@/lib/webshop/settingsForm';
import { CARD, Champ, INPUT, SECTION_TITLE } from './common';

function GrillePassages({ recurrence, onToggle }) {
  const coche = (w, d) => recurrence.some((r) => r.week === w && r.weekday === d);
  return (
    <table className="text-sm">
      <thead>
        <tr>
          <th className="pr-3 text-left text-xs font-medium text-secondary-500">Semaine</th>
          {JOURS.map((j) => <th key={j.value} className="px-2 text-xs font-medium text-secondary-500">{j.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {SEMAINES.map((w) => (
          <tr key={w}>
            <td className="pr-3 py-1 text-secondary-700">{w}</td>
            {JOURS.map((j) => (
              <td key={j.value} className="px-2 py-1 text-center">
                <input type="checkbox" checked={coche(w, j.value)} onChange={() => onToggle(w, j.value)} aria-label={`Semaine ${w}, ${j.label}`} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * @param {{ secteur: any|null, cfg: import('@/lib/webshop/reglages').WebshopConfig, onClose: () => void }} p
 */
export default function SecteurEditor({ secteur, cfg, onClose }) {
  const { upsertSector, setSectorPostcodes, isSavingSector } = useWebshopSettingsMutations();
  const [form, setForm] = useState(() => formSecteur(secteur, cfg));
  const { data: postcodes, isLoading: pcLoading, error: pcError } = useWebshopSectorPostcodes(secteur?.id);
  const initialTexte = useMemo(() => postcodesVersTexte(postcodes ?? []), [postcodes]);
  const [texte, setTexte] = useState('');
  useEffect(() => setTexte(initialTexte), [initialTexte]);

  const codesDepots = cfg.depots.map((d) => d.code);
  const erreurs = validerSecteur(form, { codesDepots });
  const parse = parserPostcodes(texte);
  const postcodesModifies = texte !== initialTexte;
  const bloque = Object.keys(erreurs).length > 0 || parse.erreurs.length > 0 || !!pcError || (!!secteur && pcLoading);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const enregistrer = async () => {
    let id = form.id;
    try {
      id = await upsertSector(payloadSecteur(form));
    } catch (err) {
      toast.error(messageErreurWebshop(err));
      return;
    }
    // Créé : la suite se fait en mise à jour (un second clic ne recrée pas le secteur).
    if (!form.id) setForm((f) => ({ ...f, id }));
    if (postcodesModifies) {
      try {
        const n = await setSectorPostcodes({ sectorId: id, rows: parse.rows });
        toast.success(`Secteur enregistré — ${n} code${n > 1 ? 's' : ''} postal${n > 1 ? 'aux' : ''}`);
      } catch (err) {
        toast.error(`Secteur enregistré, mais codes postaux refusés : ${messageErreurWebshop(err)}`);
        return;
      }
    } else {
      toast.success('Secteur enregistré');
    }
    onClose();
  };

  const nombre = (k, label, unite) => (
    <Champ label={label} erreur={erreurs[k]}>
      <div className="flex items-center gap-2">
        <input inputMode="numeric" value={form[k]} onChange={(e) => set(k, e.target.value)} className={INPUT} />
        {unite && <span className="text-sm text-secondary-500 shrink-0">{unite}</span>}
      </div>
    </Champ>
  );

  return (
    <section className={`${CARD} space-y-5`}>
      <div className="flex items-center justify-between">
        <h2 className={`${SECTION_TITLE} mb-0`}>{form.id ? `Secteur ${form.code}` : 'Nouveau secteur'}</h2>
        <button type="button" onClick={onClose} className="p-1 text-secondary-400 hover:text-secondary-700" aria-label="Fermer"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Champ label="Code" erreur={erreurs.code} aide={form.id ? 'Non modifiable (utilisé par le site).' : 'Non modifiable ensuite.'}>
          <input value={form.code} disabled={!!form.id} onChange={(e) => set('code', e.target.value)} className={INPUT} />
        </Champ>
        <Champ label="Libellé" erreur={erreurs.label}>
          <input value={form.label} onChange={(e) => set('label', e.target.value)} className={INPUT} />
        </Champ>
        <Champ label="Dépôt de départ" erreur={erreurs.depot} aide="Dépôts enregistrés dans l’onglet Livraison palette.">
          <select value={form.depot} onChange={(e) => set('depot', e.target.value)} className={INPUT}>
            {!codesDepots.includes(form.depot) && <option value={form.depot}>{form.depot || '—'} (inconnu)</option>}
            {cfg.depots.map((d) => <option key={d.code} value={d.code}>{d.libelle} ({d.code})</option>)}
          </select>
        </Champ>
        <Champ label="Prix d’un emplacement (TTC)" erreur={erreurs.prix_euros}>
          <div className="flex items-center gap-2">
            <input inputMode="decimal" value={form.prix_euros} onChange={(e) => set('prix_euros', e.target.value)} className={INPUT} />
            <span className="text-sm text-secondary-500">€</span>
          </div>
        </Champ>
        {nombre('max_stops', 'Arrêts max par tournée')}
        {nombre('max_minutes', 'Durée max d’une tournée', 'min')}
        {nombre('max_km', 'Distance max d’une tournée', 'km')}
        {nombre('slots_per_cycle', 'Passages par cycle de 4 semaines')}
        <label className="flex items-center gap-2 text-sm text-secondary-700">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Secteur actif
        </label>
      </div>

      <div>
        <h3 className="text-sm font-medium text-secondary-700 mb-2">Jours de passage dans le cycle</h3>
        <GrillePassages recurrence={form.recurrence} onToggle={(w, d) => set('recurrence', basculerPassage(form.recurrence, w, d))} />
        <p className="mt-1 text-xs text-secondary-500">Les créneaux déjà générés ne changent pas : régénérez les créneaux à venir après modification.</p>
      </div>

      <Champ
        label="Codes postaux desservis"
        aide="Une commune par ligne : code postal, code INSEE (facultatif), commune. Ex. « 31320 31113 Castanet-Tolosan »."
      >
        {pcLoading && secteur ? (
          <div className="flex items-center gap-2 text-sm text-secondary-500"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>
        ) : (
          <textarea rows={8} value={texte} onChange={(e) => setTexte(e.target.value)} className={`${INPUT} font-mono text-xs`} />
        )}
      </Champ>
      {pcError && <p className="text-xs text-red-600">Codes postaux illisibles : {pcError.message}</p>}
      {parse.erreurs.length > 0 && (
        <ul className="text-xs text-red-600 list-disc pl-5">{parse.erreurs.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      {!parse.erreurs.length && <p className="text-xs text-secondary-500">{parse.rows.length} ligne{parse.rows.length > 1 ? 's' : ''}{postcodesModifies ? ' (modifiées)' : ''}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-secondary-600">Annuler</button>
        <button type="button" onClick={enregistrer} disabled={bloque || isSavingSector} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary-600 text-white text-sm font-medium disabled:opacity-50">
          {isSavingSector && <Loader2 className="w-4 h-4 animate-spin" />}
          Enregistrer le secteur
        </button>
      </div>
    </section>
  );
}
