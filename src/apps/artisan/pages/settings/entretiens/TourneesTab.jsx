// src/apps/artisan/pages/settings/entretiens/TourneesTab.jsx
// ============================================================================
// Settings → Entretiens → Tournées (/settings/tournees) : les réglages du moteur de tournées
// (`core.organizations.settings.tournees`). Défauts et sémantique : source
// unique `src/lib/tournee/reglages.js` (REGLAGES_DEFAUT) — l'onglet n'en
// recopie aucun. Règle du projet : « pas de config sans UI ».
// ⚠️ org_update_settings merge au niveau 1 : on renvoie l'objet `tournees`
// COMPLET (clés existantes + formulaire), jamais un sous-ensemble.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { REGLAGES_DEFAUT } from '@/lib/tournee/reglages.js';
import { SOUPLESSES } from '@/lib/souplesse';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';

/** Champs édités ici ; les autres clés de `settings.tournees` sont conservées telles quelles. */
const CHAMPS = [
  'souplesse_defaut_minutes', 'reste_utile_min_minutes', 'trajet_max_entre_clients_minutes',
  'gain_multi_equipements_pct', 'depassement_journee_minutes', 'tolerance_retour_depot_minutes', 'figer_journee_pleine', 'figer_sms',
  'pause_minutes',
];

function depuisSettings(settings) {
  const t = settings?.tournees || {};
  const out = {};
  CHAMPS.forEach((c) => { out[c] = t[c] ?? REGLAGES_DEFAUT[c] ?? null; });
  if (out.figer_journee_pleine == null) out.figer_journee_pleine = true; // absent = actif
  out.figer_sms = out.figer_sms === true; // absent = OFF
  // Fenêtre de pause (heures décimales, ex. 11.5 = 11 h 30) et prise de RDV par le client (objet imbriqué).
  const fen = Array.isArray(t.pause_fenetre) ? t.pause_fenetre : REGLAGES_DEFAUT.pause_fenetre;
  out.pause_debut = Number(fen[0]);
  out.pause_fin = Number(fen[1]);
  out.auto_rdv = { ...REGLAGES_DEFAUT.auto_rdv, ...(t.auto_rdv || {}) };
  return out;
}

const AUTO_RDV_ENTIERS = [
  ['capacite_cible', 1, 12, 'Contrats visés par journée', 'Dimensionne le nombre de journées vides étiquetées par secteur. La capacité réelle reste calculée par le moteur, trajets compris.'],
  ['marge_pct', 0, 100, 'Marge de journées étiquetées', 'En plus du strict besoin, parce que tout le monde ne clique pas la même semaine.'],
  ['seuil_reouverture_pct', 50, 100, 'Réouverture d’une journée', 'Quand les journées étiquetées d’un secteur sont remplies à ce taux, une journée vide de plus lui est dédiée.'],
  ['delai_min_jours', 0, 14, 'Délai minimal', 'Aucune demi-journée proposée avant ce nombre de jours.'],
  ['max_creneaux', 2, 12, 'Créneaux affichés au client', ''],
  ['relance_sms_jours', 1, 30, 'Relance SMS', 'Jours après le mail sans rendez-vous pris.'],
  ['escalade_appel_jours', 2, 31, 'Passage en liste d’appels', 'Jours après le mail sans rendez-vous pris.'],
  ['duree_moyenne_minutes', 30, 240, 'Durée moyenne d’un entretien', 'Sert à convertir le reste d’une journée déjà amorcée en places.'],
];

function validate(form) {
  const errors = {};
  const entier = (k, min, max) => {
    const v = Number(form[k]);
    if (!Number.isInteger(v) || v < min || v > max) errors[k] = `Entier entre ${min} et ${max}`;
  };
  entier('reste_utile_min_minutes', 0, 240);
  entier('trajet_max_entre_clients_minutes', 5, 180);
  entier('gain_multi_equipements_pct', 0, 50);
  entier('depassement_journee_minutes', 0, 120);
  entier('tolerance_retour_depot_minutes', 0, 60);
  entier('pause_minutes', 0, 120);
  const heure = (k, min, max) => {
    const v = Number(form[k]);
    if (!Number.isFinite(v) || v < min || v > max || Math.round(v * 2) !== v * 2) errors[k] = `Heure entre ${min} et ${max}, par demi-heure`;
  };
  heure('pause_debut', 6, 20);
  heure('pause_fin', 6, 22);
  if (!errors.pause_debut && !errors.pause_fin && Number(form.pause_fin) * 60 - Number(form.pause_debut) * 60 < Number(form.pause_minutes || 0)) {
    errors.pause_fin = 'La fenêtre doit contenir la pause entière';
  }
  for (const [k, min, max] of AUTO_RDV_ENTIERS) {
    const v = Number(form.auto_rdv?.[k]);
    if (!Number.isInteger(v) || v < min || v > max) errors[`auto_rdv.${k}`] = `Entier entre ${min} et ${max}`;
  }
  return errors;
}

function ChampMinutes({ label, valeur, onChange, hint, error, min, max, unite = 'min' }) {
  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
      <div className="flex items-center gap-2">
        <input type="number" min={min} max={max} value={valeur ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} className={INPUT_CLASS} />
        <span className="text-sm text-secondary-500 shrink-0">{unite}</span>
      </div>
      {error ? <p className={ERROR_CLASS}>{error}</p> : hint ? <p className={HINT_CLASS}>{hint}</p> : null}
    </div>
  );
}

export default function TourneesTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => depuisSettings({}));
  const [initial, setInitial] = useState(() => depuisSettings({}));

  useEffect(() => {
    const picked = depuisSettings(settings);
    setForm(picked);
    setInitial(picked);
  }, [settings]);

  const errors = useMemo(() => validate(form), [form]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isValid = Object.keys(errors).length === 0;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const setAuto = (k) => (v) => setForm((f) => ({ ...f, auto_rdv: { ...(f.auto_rdv || {}), [k]: v } }));

  const handleSave = async () => {
    if (!isValid) {
      toast.error('Corrige les erreurs avant d\'enregistrer.');
      return;
    }
    try {
      // `pause_debut` / `pause_fin` sont des champs d'écran : en base, c'est `pause_fenetre: [debut, fin]`.
      const { pause_debut: pd, pause_fin: pf, ...reste } = form;
      const complet = { ...(settings?.tournees || {}), ...reste, pause_fenetre: [Number(pd), Number(pf)] };
      await save({ tournees: complet });
      toast.success('Réglages des tournées enregistrés');
      setInitial(form);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    }
  };

  if (isLoading) return <div className="card text-sm text-secondary-500">Chargement…</div>;

  return (
    <div className="card space-y-8">
      <section>
        <h3 className={SECTION_TITLE}>Rendez-vous adaptables</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLASS}>Souplesse par défaut d’un rendez-vous</label>
            <select value={form.souplesse_defaut_minutes ?? 30} onChange={(e) => set('souplesse_defaut_minutes')(Number(e.target.value))} className={INPUT_CLASS}>
              {SOUPLESSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <p className={HINT_CLASS}>Appliquée aux entretiens et SAV sans souplesse renseignée. Figer reste un geste sur le rendez-vous.</p>
          </div>
          <ChampMinutes
            label="Reste utile minimum" valeur={form.reste_utile_min_minutes} onChange={set('reste_utile_min_minutes')} min={0} max={240}
            error={errors.reste_utile_min_minutes}
            hint="En dessous, le temps qui reste dans une journée est perdu (plus petite visite + un trajet). C’est aussi le seuil « journée pleine »."
          />
        </div>
      </section>

      <section>
        <h3 className={SECTION_TITLE}>Temps et trajets</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <ChampMinutes
            label="Gain quand un client a plusieurs équipements" valeur={form.gain_multi_equipements_pct} onChange={set('gain_multi_equipements_pct')} min={0} max={50} unite="%"
            error={errors.gain_multi_equipements_pct}
            hint="Les durées du barème valent pour des interventions isolées ; dès 2 équipements chez le même client, la somme est réduite d’autant."
          />
          <ChampMinutes
            label="Trajet maximum entre deux clients" valeur={form.trajet_max_entre_clients_minutes} onChange={set('trajet_max_entre_clients_minutes')} min={5} max={180}
            error={errors.trajet_max_entre_clients_minutes}
            hint="Au-delà, une insertion n’est pas raisonnable : on propose d’ouvrir une nouvelle journée. Les trajets depuis le dépôt ne comptent pas."
          />
          <ChampMinutes
            label="Dépassement toléré de la journée" valeur={form.depassement_journee_minutes} onChange={set('depassement_journee_minutes')} min={0} max={120}
            error={errors.depassement_journee_minutes}
            hint="Le budget journalier (Settings → Équipe) reste ce qu’on affiche ; le moteur accepte de le dépasser d’autant. Certains jours sont « fini-parti », d’autres finissent plus tard."
          />
          <ChampMinutes
            label="Tolérance du retour au dépôt" valeur={form.tolerance_retour_depot_minutes} onChange={set('tolerance_retour_depot_minutes')} min={0} max={60}
            error={errors.tolerance_retour_depot_minutes}
            hint="Le dernier client finit toujours dans l’amplitude de la journée (Settings → Équipe) ; seul le trajet de retour au dépôt peut la déborder d’autant."
          />
          <ChampMinutes
            label="Pause déjeuner" valeur={form.pause_minutes} onChange={set('pause_minutes')} min={0} max={120}
            error={errors.pause_minutes}
            hint="Prise entre deux arrêts, à la première occasion dans sa fenêtre, sur la route. La pause entière doit tenir dans la fenêtre."
          />
          <ChampMinutes
            label="Fenêtre de pause : au plus tôt" valeur={form.pause_debut} onChange={set('pause_debut')} min={6} max={20} unite="h"
            error={errors.pause_debut} hint="Heure décimale : 11.5 = 11 h 30."
          />
          <ChampMinutes
            label="Fenêtre de pause : au plus tard" valeur={form.pause_fin} onChange={set('pause_fin')} min={6} max={22} unite="h"
            error={errors.pause_fin} hint="La pause doit être finie à cette heure."
          />
        </div>
      </section>

      <section>
        <h3 className={SECTION_TITLE}>Prise de rendez-vous par le client</h3>
        <label className="flex items-start gap-3 text-sm text-secondary-700 mb-4">
          <input type="checkbox" checked={!!form.auto_rdv?.enabled} onChange={(e) => setAuto('enabled')(e.target.checked)} className="mt-0.5" />
          <span>
            <span className="font-medium">Chaque 1ᵉʳ du mois, inviter par e-mail les clients dont l’entretien est dû.</span>
            <br />
            La machine dédie des journées vides du mois à chaque secteur selon les contrats dus, envoie à chaque client un lien
            vers la page où il choisit sa demi-journée (gabarit « auto_rdv » dans Communication → Emails), relance par SMS puis
            passe en liste d’appels. Désactivé : rien n’est envoyé ; la page et « Copier le lien » restent utilisables à la main.
          </span>
        </label>
        <div className="grid sm:grid-cols-2 gap-4">
          {AUTO_RDV_ENTIERS.map(([k, min, max, label, hint]) => (
            <ChampMinutes
              key={k} label={label} valeur={form.auto_rdv?.[k]} onChange={setAuto(k)} min={min} max={max}
              unite={k.endsWith('_pct') ? '%' : k.endsWith('_jours') ? 'j' : k.endsWith('_minutes') ? 'min' : ''}
              error={errors[`auto_rdv.${k}`]} hint={hint}
            />
          ))}
        </div>
        <label className="flex items-start gap-3 text-sm text-secondary-700 mt-4">
          <input type="checkbox" checked={form.auto_rdv?.inclure_retardataires !== false} onChange={(e) => setAuto('inclure_retardataires')(e.target.checked)} className="mt-0.5" />
          <span>
            <span className="font-medium">Inviter aussi les retardataires.</span>
            <br />
            Contrats dont l’anniversaire est passé sans visite cette année. Sinon un contrat de septembre non fait ne serait jamais invité.
          </span>
        </label>
      </section>

      <section>
        <h3 className={SECTION_TITLE}>Journée pleine</h3>
        <label className="flex items-start gap-3 text-sm text-secondary-700">
          <input type="checkbox" checked={!!form.figer_journee_pleine} onChange={(e) => set('figer_journee_pleine')(e.target.checked)} className="mt-0.5" />
          <span>
            <span className="font-medium">Figer automatiquement une journée dès qu’elle est pleine.</span>
            <br />
            Toutes les heures : une journée où il ne rentre plus rien (reste utile sous le minimum) est ordonnancée dans les
            tolérances et ses heures deviennent définitives. Une journée pleine qui ne tient pas remonte « à arbitrer »
            sur le tableau de bord de l’administrateur. Figer à la main reste possible.
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-secondary-700 mt-3">
          <input type="checkbox" checked={!!form.figer_sms} onChange={(e) => set('figer_sms')(e.target.checked)} className="mt-0.5" />
          <span>
            <span className="font-medium">Envoyer le SMS « Heure de passage » au figeage.</span>
            <br />
            Automatique ou par le bouton « Figer la journée » : chaque client dont l’heure vient d’être figée reçoit son
            heure définitive (gabarit à créer dans l’onglet SMS, mobile FR uniquement). Désactivé : les heures se figent,
            personne n’est prévenu par SMS.
          </span>
        </label>
      </section>

      <div className="flex justify-end gap-2 pt-4 border-t border-secondary-200">
        <button type="button" onClick={() => setForm(initial)} disabled={!isDirty || isSaving} className="px-4 py-2 text-sm text-secondary-600 hover:bg-secondary-50 rounded-md disabled:opacity-50">
          Annuler
        </button>
        <button type="button" onClick={handleSave} disabled={!isDirty || !isValid || isSaving} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50">
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
