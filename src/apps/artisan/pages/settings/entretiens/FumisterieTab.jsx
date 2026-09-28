// src/apps/artisan/pages/settings/entretiens/FumisterieTab.jsx
// Settings → Entretiens & Contrats → Fumisterie (/settings/fumisterie) : `settings.fumisterie`.
// Défauts et sémantique : src/lib/fumisterie/config.js (DEFAULTS_FUMISTERIE). ⚠ merge JSONB
// niveau 1 → on renvoie l'objet `fumisterie` COMPLET (clés existantes + formulaire).
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildFumisterieConfig } from '@/lib/fumisterie/config.js';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';

function depuisSettings(settings) {
  const c = buildFumisterieConfig(settings);
  return {
    finition_defaut: c.finition_defaut,
    longueurs: c.longueurs_elements_mm.join(', '),
    reglable_min: c.reglable.min, reglable_max: c.reglable.max,
    reglable_interieur: c.reglable_interieur, reglable_exterieur: c.reglable_exterieur,
    colliers_par_emboitement: c.colliers_par_emboitement, marge_combles_cm: Math.round(c.marge_combles_m * 100),
    haubanage_m: c.haubanage_m, zone1_pente_cm: Math.round(c.zone1.pente_m * 100), zone1_plat_cm: Math.round(c.zone1.plat_m * 100),
    zone1_pente_plat_deg: c.zone1.pente_plat_deg, tva_fournitures: c.tva_fournitures, tva_pose: c.tva_pose,
  };
}

function versSettings(form, existant) {
  const longueurs = form.longueurs.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  return {
    ...(existant || {}),
    finition_defaut: form.finition_defaut,
    longueurs_elements_mm: longueurs,
    reglable: { min: Number(form.reglable_min), max: Number(form.reglable_max) },
    reglable_interieur: !!form.reglable_interieur, reglable_exterieur: !!form.reglable_exterieur,
    colliers_par_emboitement: Number(form.colliers_par_emboitement), marge_combles_m: Number(form.marge_combles_cm) / 100,
    haubanage_m: Number(form.haubanage_m),
    zone1: { pente_m: Number(form.zone1_pente_cm) / 100, plat_m: Number(form.zone1_plat_cm) / 100, pente_plat_deg: Number(form.zone1_pente_plat_deg) },
    tva_fournitures: Number(form.tva_fournitures), tva_pose: Number(form.tva_pose),
  };
}

function validate(form) {
  const errors = {};
  if (!/^\d+(\s*,\s*\d+)*$/.test(form.longueurs.trim())) {
    errors.longueurs = 'Liste de longueurs en mm, séparées par des virgules';
  } else {
    const n = form.longueurs.split(',').filter((s) => s.trim() !== '').length;
    if (n !== 3) errors.longueurs = 'Exactement 3 longueurs (ex. 1000, 500, 250)';
  }
  if (!(Number(form.reglable_min) > 0 && Number(form.reglable_max) > Number(form.reglable_min))) errors.reglable = 'Plage min < max';
  return errors;
}

function Champ({ label, hint, error, children }) {
  return (<div><label className={LABEL_CLASS}>{label}</label>{children}{error ? <p className="mt-1 text-xs text-primary-700">⚠ {error}</p> : hint ? <p className={HINT_CLASS}>{hint}</p> : null}</div>);
}

export default function FumisterieTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => depuisSettings(null));
  const [initial, setInitial] = useState(() => depuisSettings(null));
  useEffect(() => { const p = depuisSettings(settings); setForm(p); setInitial(p); }, [settings]);
  const errors = useMemo(() => validate(form), [form]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isValid = Object.keys(errors).length === 0;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  const handleSave = async () => {
    try {
      await save({ fumisterie: versSettings(form, settings?.fumisterie) });
      toast.success('Réglages de fumisterie enregistrés');
      setInitial(form);
    } catch (err) { toast.error(err.message || 'Erreur lors de l\'enregistrement'); }
  };

  if (isLoading) return <div className="card text-sm text-secondary-500">Chargement…</div>;
  return (
    <div className="card space-y-8">
      <section>
        <h3 className={SECTION_TITLE}>Choix par défaut</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <Champ label="Finition extérieure proposée">
            <select value={form.finition_defaut} onChange={set('finition_defaut')} className={INPUT_CLASS}><option value="noir">Laqué noir</option><option value="inox">Inox</option></select>
          </Champ>
          <Champ label="TVA fournitures / pose (%)"><div className="flex gap-2"><input type="number" value={form.tva_fournitures} onChange={set('tva_fournitures')} className={INPUT_CLASS} /><input type="number" value={form.tva_pose} onChange={set('tva_pose')} className={INPUT_CLASS} /></div></Champ>
        </div>
      </section>
      <section>
        <h3 className={SECTION_TITLE}>Éléments et fixations (règles provisoires)</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <Champ label="Longueurs d'éléments droits (mm)" hint="Du plus long au plus court, ex. 1000, 500, 250" error={errors.longueurs}><input value={form.longueurs} onChange={set('longueurs')} className={INPUT_CLASS} /></Champ>
          <Champ label="Élément réglable (mm)" error={errors.reglable}><div className="flex gap-2"><input type="number" value={form.reglable_min} onChange={set('reglable_min')} className={INPUT_CLASS} /><input type="number" value={form.reglable_max} onChange={set('reglable_max')} className={INPUT_CLASS} /></div></Champ>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.reglable_interieur} onChange={set('reglable_interieur')} /> Réglable sur la partie intérieure</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.reglable_exterieur} onChange={set('reglable_exterieur')} /> Réglable au-dessus du toit</label>
          <Champ label="Colliers de jonction par emboîtement extérieur"><input type="number" min={0} max={3} value={form.colliers_par_emboitement} onChange={set('colliers_par_emboitement')} className={INPUT_CLASS} /></Champ>
          <Champ label="Marge sous toiture pour le dévoiement (cm)"><input type="number" min={0} max={50} value={form.marge_combles_cm} onChange={set('marge_combles_cm')} className={INPUT_CLASS} /></Champ>
          <Champ label="Conduit libre au-dessus du toit avant haubanage (m)" hint="Catalogue p.33"><input type="number" step="0.5" min={1} max={6} value={form.haubanage_m} onChange={set('haubanage_m')} className={INPUT_CLASS} /></Champ>
        </div>
      </section>
      <section>
        <h3 className={SECTION_TITLE}>Zone 1 (catalogue p.23)</h3>
        <div className="grid sm:grid-cols-3 gap-4">
          <Champ label="Au-dessus du faîtage (cm)"><input type="number" value={form.zone1_pente_cm} onChange={set('zone1_pente_cm')} className={INPUT_CLASS} /></Champ>
          <Champ label="Au-dessus d'un toit plat (cm)"><input type="number" value={form.zone1_plat_cm} onChange={set('zone1_plat_cm')} className={INPUT_CLASS} /></Champ>
          <Champ label="Pente traitée comme toit plat (≤ °)"><input type="number" value={form.zone1_pente_plat_deg} onChange={set('zone1_pente_plat_deg')} className={INPUT_CLASS} /></Champ>
        </div>
      </section>
      <div className="flex justify-end">
        <button type="button" onClick={handleSave} disabled={!isDirty || !isValid || isSaving} className="btn-primary">{isSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </div>
  );
}
