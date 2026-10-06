// src/apps/artisan/pages/settings/clim/ClimTab.jsx
// Settings → Socle → Climatisation (/settings/clim) : `settings.clim`. Défauts et sources :
// src/lib/clim/config.js (DEFAULTS_CLIM). ⚠ merge JSONB niveau 1 → on renvoie l'objet `clim` COMPLET.
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildClimConfig } from '@/lib/clim/config.js';
import { CLASSES_ISOLATION, EXPOSITIONS } from '@/lib/clim/dimensionnement.js';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';

const pct = (v) => String(Math.round(Number(v) * 1000) / 10); // 0.15 → "15"
const frac = (v) => Number(v) / 100;

function depuisSettings(settings) {
  const c = buildClimConfig(settings);
  return {
    base_w_m2: String(c.base_w_m2), hauteur_reference_m: String(c.hauteur_reference_m),
    isolation: Object.fromEntries(CLASSES_ISOLATION.map((k) => [k.code, String(c.w_m2_par_isolation[k.code] ?? '')])),
    exposition: Object.fromEntries(EXPOSITIONS.map((e) => [e.code, pct(c.exposition_majoration[e.code] ?? 0)])),
    vitrage: Object.fromEntries(EXPOSITIONS.map((e) => [e.code, String(c.vitrage_w_m2_par_exposition[e.code] ?? '')])),
    facteur_protection_solaire: pct(c.facteur_protection_solaire), occupants_inclus: String(c.occupants_inclus),
    w_par_occupant_supplementaire: String(c.w_par_occupant_supplementaire), sous_toiture_majoration: pct(c.sous_toiture_majoration),
    zone_majoration: pct(c.zone_majoration), marge_securite: pct(c.marge_securite), tolerance_sous: pct(c.tolerance_sous), tolerance_sur: pct(c.tolerance_sur),
    btu_par_m3: String(c.btu_par_m3), btu_par_paroi_vitree: String(c.btu_par_paroi_vitree), ratio_max_ui_ge: pct(c.multi.ratio_max_ui_ge),
    paliers: c.liaison_paliers.map((p) => ({ max_kw: String(p.max_kw), liquide: p.liquide, gaz: p.gaz })),
    longueur_liaison_defaut_m: String(c.longueur_liaison_defaut_m), gamme_defaut: c.gamme_defaut,
  };
}

function versSettings(form, existant) {
  return {
    ...(existant || {}),
    base_w_m2: Number(form.base_w_m2), hauteur_reference_m: Number(form.hauteur_reference_m),
    w_m2_par_isolation: Object.fromEntries(Object.entries(form.isolation).map(([k, v]) => [k, Number(v)])),
    exposition_majoration: Object.fromEntries(Object.entries(form.exposition).map(([k, v]) => [k, frac(v)])),
    vitrage_w_m2_par_exposition: Object.fromEntries(Object.entries(form.vitrage).map(([k, v]) => [k, Number(v)])),
    facteur_protection_solaire: frac(form.facteur_protection_solaire), occupants_inclus: Number(form.occupants_inclus),
    w_par_occupant_supplementaire: Number(form.w_par_occupant_supplementaire), sous_toiture_majoration: frac(form.sous_toiture_majoration),
    zone_majoration: frac(form.zone_majoration), marge_securite: frac(form.marge_securite), tolerance_sous: frac(form.tolerance_sous), tolerance_sur: frac(form.tolerance_sur),
    btu_par_m3: Number(form.btu_par_m3), btu_par_paroi_vitree: Number(form.btu_par_paroi_vitree),
    multi: { ...(existant?.multi || {}), ratio_max_ui_ge: frac(form.ratio_max_ui_ge) },
    liaison_paliers: form.paliers.map((p) => ({ max_kw: Number(p.max_kw), liquide: p.liquide.trim(), gaz: p.gaz.trim() })),
    longueur_liaison_defaut_m: Number(form.longueur_liaison_defaut_m), gamme_defaut: form.gamme_defaut.trim(),
  };
}

function nombre(v) { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function borne(v, min, max, entier = false) {
  const n = nombre(v);
  if (n == null) return 'Champ obligatoire';
  if (entier && !Number.isInteger(n)) return 'Nombre entier attendu';
  if (n < min || n > max) return `Entre ${String(min).replace('.', ',')} et ${String(max).replace('.', ',')}`;
  return null;
}

// [clé, min, max, entier]
const BORNES = [
  ['base_w_m2', 30, 300, true], ['hauteur_reference_m', 2, 4, false], ['facteur_protection_solaire', 0, 100, false],
  ['occupants_inclus', 0, 10, true], ['w_par_occupant_supplementaire', 0, 300, true], ['sous_toiture_majoration', 0, 50, false],
  ['zone_majoration', -20, 50, false], ['marge_securite', 0, 50, false], ['tolerance_sous', 0, 20, false], ['tolerance_sur', 5, 100, false],
  ['btu_par_m3', 50, 200, true], ['btu_par_paroi_vitree', 0, 3000, true], ['ratio_max_ui_ge', 100, 200, false], ['longueur_liaison_defaut_m', 1, 50, false],
];

function validate(form) {
  const errors = {};
  for (const [k, min, max, entier] of BORNES) { const e = borne(form[k], min, max, entier); if (e) errors[k] = e; }
  for (const c of CLASSES_ISOLATION) { const e = borne(form.isolation[c.code], 30, 300, true); if (e) errors[`isolation.${c.code}`] = e; }
  for (const x of EXPOSITIONS) {
    const e1 = borne(form.exposition[x.code], -30, 50, false); if (e1) errors[`exposition.${x.code}`] = e1;
    const e2 = borne(form.vitrage[x.code], 0, 400, true); if (e2) errors[`vitrage.${x.code}`] = e2;
  }
  if (!form.paliers.length) errors.paliers = 'Au moins un palier';
  form.paliers.forEach((p, i) => {
    const e = borne(p.max_kw, 0.5, 99, false); if (e) errors[`paliers.${i}`] = e;
    if (!p.liquide.trim() || !p.gaz.trim()) errors[`paliers.${i}`] = 'Diamètres liquide et gaz obligatoires (ex. 1/4 et 3/8)';
  });
  if (!form.gamme_defaut.trim()) errors.gamme_defaut = 'Nom de la gamme proposée par défaut (ex. airHome 400)';
  return errors;
}

function Champ({ label, hint, error, children }) {
  return (<div><label className={LABEL_CLASS}>{label}</label>{children}{error ? <p className="mt-1 text-xs text-primary-700">⚠ {error}</p> : hint ? <p className={HINT_CLASS}>{hint}</p> : null}</div>);
}

export default function ClimTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => depuisSettings(null));
  const [initial, setInitial] = useState(() => depuisSettings(null));
  useEffect(() => { const p = depuisSettings(settings); setForm(p); setInitial(p); }, [settings]);
  const errors = useMemo(() => validate(form), [form]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isValid = Object.keys(errors).length === 0;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setSous = (groupe, k) => (e) => setForm((f) => ({ ...f, [groupe]: { ...f[groupe], [k]: e.target.value } }));
  const setPalier = (i, k) => (e) => setForm((f) => ({ ...f, paliers: f.paliers.map((p, j) => (j === i ? { ...p, [k]: e.target.value } : p)) }));

  const handleSave = async () => {
    try {
      await save({ clim: versSettings(form, settings?.clim) });
      toast.success('Réglages de climatisation enregistrés');
      setInitial(form);
    } catch (err) { toast.error(err.message || "Erreur lors de l'enregistrement"); }
  };

  if (isLoading) return <div className="card text-sm text-secondary-500">Chargement…</div>;
  const num = (k, props = {}) => <input type="number" value={form[k]} onChange={set(k)} className={INPUT_CLASS} {...props} />;
  return (
    <div className="card space-y-8">
      <section>
        <h3 className={SECTION_TITLE}>Besoin de base</h3>
        <div className="grid sm:grid-cols-3 gap-4">
          <Champ label="Hauteur de référence (m)" hint="Le besoin est au prorata de cette hauteur" error={errors.hauteur_reference_m}>{num('hauteur_reference_m', { step: 0.1, min: 2, max: 4 })}</Champ>
          <Champ label="Zone climatique de l'entreprise (%)" hint="Majoration appliquée à tous les logements (Tarn, été chaud : +5)" error={errors.zone_majoration}>{num('zone_majoration', { step: 1, min: -20, max: 50 })}</Champ>
          <Champ label="Marge de sécurité (%)" hint="0 recommandé : le surdimensionnement est l'erreur type" error={errors.marge_securite}>{num('marge_securite', { step: 1, min: 0, max: 50 })}</Champ>
        </div>
      </section>
      <section>
        <h3 className={SECTION_TITLE}>W/m² par isolation (à 2,50 m sous plafond)</h3>
        <div className="grid sm:grid-cols-5 gap-4">
          {CLASSES_ISOLATION.map((c) => (
            <Champ key={c.code} label={c.label} error={errors[`isolation.${c.code}`]}><input type="number" min={30} max={300} value={form.isolation[c.code]} onChange={setSous('isolation', c.code)} className={INPUT_CLASS} /></Champ>
          ))}
        </div>
      </section>
      <section>
        <h3 className={SECTION_TITLE}>Exposition et vitrage</h3>
        <div className="grid sm:grid-cols-4 gap-4">
          {EXPOSITIONS.map((x) => (
            <Champ key={x.code} label={`${x.label} : majoration (%)`} error={errors[`exposition.${x.code}`]}><input type="number" min={-30} max={50} value={form.exposition[x.code]} onChange={setSous('exposition', x.code)} className={INPUT_CLASS} /></Champ>
          ))}
          {EXPOSITIONS.map((x) => (
            <Champ key={`v-${x.code}`} label={`${x.label} : vitrage non protégé (W/m²)`} error={errors[`vitrage.${x.code}`]}><input type="number" min={0} max={400} value={form.vitrage[x.code]} onChange={setSous('vitrage', x.code)} className={INPUT_CLASS} /></Champ>
          ))}
          <Champ label="Vitrage protégé : part conservée (%)" hint="Volets ou stores extérieurs" error={errors.facteur_protection_solaire}>{num('facteur_protection_solaire', { min: 0, max: 100 })}</Champ>
          <Champ label="Sous toiture : majoration (%)" error={errors.sous_toiture_majoration}>{num('sous_toiture_majoration', { min: 0, max: 50 })}</Champ>
          <Champ label="Occupants inclus dans la base" error={errors.occupants_inclus}>{num('occupants_inclus', { min: 0, max: 10 })}</Champ>
          <Champ label="W par occupant supplémentaire" error={errors.w_par_occupant_supplementaire}>{num('w_par_occupant_supplementaire', { min: 0, max: 300 })}</Champ>
        </div>
      </section>
      <section>
        <h3 className={SECTION_TITLE}>Choix des unités</h3>
        <div className="grid sm:grid-cols-4 gap-4">
          <Champ label="Gamme proposée par défaut" hint="Telle qu'elle est nommée dans le catalogue" error={errors.gamme_defaut}><input value={form.gamme_defaut} onChange={set('gamme_defaut')} className={INPUT_CLASS} /></Champ>
          <Champ label="Tolérance sous le besoin (%)" hint="Une unité à 95 % du besoin reste proposée" error={errors.tolerance_sous}>{num('tolerance_sous', { min: 0, max: 20 })}</Champ>
          <Champ label="Alerte surdimensionnement au-delà de (%)" error={errors.tolerance_sur}>{num('tolerance_sur', { min: 5, max: 100 })}</Champ>
          <Champ label="Multi-split : Σ unités ≤ (%) du groupe" hint="130 % = ratio courant des constructeurs" error={errors.ratio_max_ui_ge}>{num('ratio_max_ui_ge', { min: 100, max: 200 })}</Champ>
          <Champ label="Contrôle volume : BTU par m³" error={errors.btu_par_m3}>{num('btu_par_m3', { min: 50, max: 200 })}</Champ>
          <Champ label="Contrôle volume : BTU par paroi vitrée" error={errors.btu_par_paroi_vitree}>{num('btu_par_paroi_vitree', { min: 0, max: 3000 })}</Champ>
        </div>
      </section>
      <section>
        <h3 className={SECTION_TITLE}>Liaisons cuivre</h3>
        <div className="space-y-2">
          {form.paliers.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
              <Champ label={i === 0 ? 'Jusqu\'à (kW)' : ''} error={errors[`paliers.${i}`]}><input type="number" step="0.1" min={0.5} max={99} value={p.max_kw} onChange={setPalier(i, 'max_kw')} className={INPUT_CLASS} /></Champ>
              <Champ label={i === 0 ? 'Liquide' : ''}><input value={p.liquide} onChange={setPalier(i, 'liquide')} className={INPUT_CLASS} placeholder="1/4" /></Champ>
              <Champ label={i === 0 ? 'Gaz' : ''}><input value={p.gaz} onChange={setPalier(i, 'gaz')} className={INPUT_CLASS} placeholder="3/8" /></Champ>
              <button type="button" onClick={() => setForm((f) => ({ ...f, paliers: f.paliers.filter((_, j) => j !== i) }))} className="text-xs text-secondary-500 hover:text-red-600 pb-2">retirer</button>
            </div>
          ))}
          {errors.paliers && <p className="text-xs text-primary-700">⚠ {errors.paliers}</p>}
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => setForm((f) => ({ ...f, paliers: [...f.paliers, { max_kw: '', liquide: '', gaz: '' }] }))} className="text-sm text-primary-700 hover:underline">+ Ajouter un palier</button>
            <div className="max-w-xs flex-1"><Champ label="Longueur de liaison par défaut (m)" error={errors.longueur_liaison_defaut_m}>{num('longueur_liaison_defaut_m', { step: 0.5, min: 1, max: 50 })}</Champ></div>
          </div>
        </div>
      </section>
      <div className="flex justify-end">
        <button type="button" onClick={handleSave} disabled={!isDirty || !isValid || isSaving} className="btn-primary">{isSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </div>
  );
}
