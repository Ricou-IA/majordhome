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
    flexible_marge_cm: Math.round(c.flexible_marge_m * 100), flexible_arrondi_cm: Math.round(c.flexible_arrondi_m * 100),
    longueurs_prh: c.longueurs_prh_mm.join(', '), longueurs_prh_5_10: c.longueurs_prh_5_10_mm.join(', '),
    supports_muraux_tous_les_m: c.supports_muraux_tous_les_m,
  };
}

const listeLongueurs = (s) => s.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);

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
    flexible_marge_m: Number(form.flexible_marge_cm) / 100, flexible_arrondi_m: Number(form.flexible_arrondi_cm) / 100,
    longueurs_prh_mm: listeLongueurs(form.longueurs_prh), longueurs_prh_5_10_mm: listeLongueurs(form.longueurs_prh_5_10),
    supports_muraux_tous_les_m: Number(form.supports_muraux_tous_les_m),
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
  const rMin = nombre(form.reglable_min); const rMax = nombre(form.reglable_max);
  if (rMin == null || rMax == null) errors.reglable = 'Min et max obligatoires';
  else if (!Number.isInteger(rMin) || !Number.isInteger(rMax)) errors.reglable = 'Valeurs entières en mm';
  else if (rMin < 100 || rMax > 1000 || rMin >= rMax) errors.reglable = 'Plage entre 100 et 1000 mm, min < max';
  const tva = borne(form.tva_fournitures, 0, 30) || borne(form.tva_pose, 0, 30);
  if (tva) errors.tva = tva;
  for (const k of ['longueurs_prh', 'longueurs_prh_5_10']) {
    if (!/^\d+(\s*,\s*\d+)*$/.test(String(form[k]).trim())) errors[k] = 'Liste de longueurs en mm, séparées par des virgules';
    else if (listeLongueurs(form[k]).length !== 3) errors[k] = 'Exactement 3 longueurs (ex. 1000, 500, 330)';
  }
  for (const [k, min, max, entier] of BORNES) {
    const e = borne(form[k], min, max, entier);
    if (e) errors[k] = e;
  }
  return errors;
}

/** Valeur numérique d'un champ, ou null si vide / non numérique (jamais un 0 implicite). */
function nombre(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Message d'erreur si hors bornes (ou vide), sinon null. */
function borne(v, min, max, entier = false) {
  const n = nombre(v);
  if (n == null) return 'Champ obligatoire';
  if (entier && !Number.isInteger(n)) return 'Nombre entier attendu';
  if (n < min || n > max) return `Entre ${String(min).replace('.', ',')} et ${String(max).replace('.', ',')}`;
  return null;
}

// [clé du formulaire, min, max, entier]
const BORNES = [
  ['colliers_par_emboitement', 1, 3, true],
  ['marge_combles_cm', 0, 50, true],
  ['haubanage_m', 1, 6, false],
  ['zone1_pente_cm', 10, 200, true],
  ['zone1_plat_cm', 50, 300, true],
  ['zone1_pente_plat_deg', 0, 30, false],
  ['flexible_marge_cm', 0, 200, true],
  ['flexible_arrondi_cm', 10, 100, true],
  ['supports_muraux_tous_les_m', 1, 4, false],
];

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
          <Champ label="TVA fournitures / pose (%)" hint="Entre 0 et 30" error={errors.tva}><div className="flex gap-2"><input type="number" min={0} max={30} value={form.tva_fournitures} onChange={set('tva_fournitures')} className={INPUT_CLASS} /><input type="number" min={0} max={30} value={form.tva_pose} onChange={set('tva_pose')} className={INPUT_CLASS} /></div></Champ>
        </div>
      </section>
      <section>
        <h3 className={SECTION_TITLE}>Éléments et fixations (règles provisoires)</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <Champ label="Longueurs d'éléments droits (mm)" hint="Du plus long au plus court, ex. 1000, 500, 250" error={errors.longueurs}><input value={form.longueurs} onChange={set('longueurs')} className={INPUT_CLASS} /></Champ>
          <Champ label="Élément réglable (mm)" hint="Min / max, entre 100 et 1000" error={errors.reglable}><div className="flex gap-2"><input type="number" min={100} max={1000} value={form.reglable_min} onChange={set('reglable_min')} className={INPUT_CLASS} /><input type="number" min={100} max={1000} value={form.reglable_max} onChange={set('reglable_max')} className={INPUT_CLASS} /></div></Champ>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.reglable_interieur} onChange={set('reglable_interieur')} /> Réglable sur la partie intérieure</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.reglable_exterieur} onChange={set('reglable_exterieur')} /> Réglable au-dessus du toit</label>
          <Champ label="Colliers de jonction par emboîtement extérieur" hint="De 1 à 3" error={errors.colliers_par_emboitement}><input type="number" min={1} max={3} value={form.colliers_par_emboitement} onChange={set('colliers_par_emboitement')} className={INPUT_CLASS} /></Champ>
          <Champ label="Marge sous toiture pour le dévoiement (cm)" hint="De 0 à 50" error={errors.marge_combles_cm}><input type="number" min={0} max={50} value={form.marge_combles_cm} onChange={set('marge_combles_cm')} className={INPUT_CLASS} /></Champ>
          <Champ label="Conduit libre au-dessus du toit avant haubanage (m)" hint="Catalogue p.33 — de 1 à 6 m" error={errors.haubanage_m}><input type="number" step="0.5" min={1} max={6} value={form.haubanage_m} onChange={set('haubanage_m')} className={INPUT_CLASS} /></Champ>
        </div>
      </section>
      <section>
        <h3 className={SECTION_TITLE}>Zone 1 (catalogue p.23)</h3>
        <div className="grid sm:grid-cols-3 gap-4">
          <Champ label="Au-dessus du faîtage (cm)" hint="De 10 à 200" error={errors.zone1_pente_cm}><input type="number" min={10} max={200} value={form.zone1_pente_cm} onChange={set('zone1_pente_cm')} className={INPUT_CLASS} /></Champ>
          <Champ label="Au-dessus d'un toit plat (cm)" hint="De 50 à 300" error={errors.zone1_plat_cm}><input type="number" min={50} max={300} value={form.zone1_plat_cm} onChange={set('zone1_plat_cm')} className={INPUT_CLASS} /></Champ>
          <Champ label="Pente traitée comme toit plat (≤ °)" hint="De 0 à 30" error={errors.zone1_pente_plat_deg}><input type="number" min={0} max={30} value={form.zone1_pente_plat_deg} onChange={set('zone1_pente_plat_deg')} className={INPUT_CLASS} /></Champ>
        </div>
      </section>
      <section>
        <h3 className={SECTION_TITLE}>{'Tubage d\'un conduit existant (règles provisoires)'}</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <Champ label="Débord du flexible ajouté à la hauteur du conduit (cm)" hint="Haut de souche + raccord bas — de 0 à 200" error={errors.flexible_marge_cm}><input type="number" min={0} max={200} value={form.flexible_marge_cm} onChange={set('flexible_marge_cm')} className={INPUT_CLASS} /></Champ>
          <Champ label="Arrondi de commande du flexible (cm)" hint="Vendu au mètre, commandé au multiple supérieur — de 10 à 100" error={errors.flexible_arrondi_cm}><input type="number" min={10} max={100} value={form.flexible_arrondi_cm} onChange={set('flexible_arrondi_cm')} className={INPUT_CLASS} /></Champ>
          <Champ label="Longueurs des tuyaux rigides PRH 6/10 (mm)" hint="Ø 130 et plus — ex. 1000, 500, 330" error={errors.longueurs_prh}><input value={form.longueurs_prh} onChange={set('longueurs_prh')} className={INPUT_CLASS} /></Champ>
          <Champ label="Longueurs des tuyaux rigides PRH 5/10 (mm)" hint="Ø 80 et 100 (pellets) — ex. 1000, 500, 250" error={errors.longueurs_prh_5_10}><input value={form.longueurs_prh_5_10} onChange={set('longueurs_prh_5_10')} className={INPUT_CLASS} /></Champ>
        </div>
      </section>
      <section>
        <h3 className={SECTION_TITLE}>{'Conduit extérieur en façade (règles provisoires)'}</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <Champ label="Un support mural tous les (m)" hint="De 1 à 4 m de conduit en façade" error={errors.supports_muraux_tous_les_m}><input type="number" step="0.5" min={1} max={4} value={form.supports_muraux_tous_les_m} onChange={set('supports_muraux_tous_les_m')} className={INPUT_CLASS} /></Champ>
        </div>
      </section>
      <div className="flex justify-end">
        <button type="button" onClick={handleSave} disabled={!isDirty || !isValid || isSaving} className="btn-primary">{isSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </div>
  );
}
