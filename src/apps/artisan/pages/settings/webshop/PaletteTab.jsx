// src/apps/artisan/pages/settings/webshop/PaletteTab.jsx
// Settings → Webshop → Livraison palette : transporteur, dépôts, règles des tournées
// (`settings.webshop.palette` + `settings.webshop.depots`). Défauts : src/lib/webshop/reglages.js.
import { useMemo } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import { WEBSHOP_REGLAGES_DEFAUT, BORNES } from '@/lib/webshop/reglages';
import { centsVersEuros } from '@/lib/webshop/settingsForm';
import { useWebshopSettingsSectors } from '@hooks/useWebshopSettings';
import { useWebshopReglagesForm } from './useWebshopReglagesForm';
import { Avertissement, BarreEnregistrer, CARD, Champ, Chargement, INPUT, SECTION_TITLE } from './common';

const D = WEBSHOP_REGLAGES_DEFAUT.palette;
const AUCUNE_LISTE = [];

/** Phrase « à qui part la feuille de route » d'après la configuration ENREGISTRÉE. */
function ResumeEnvoi({ cfg }) {
  const p = cfg.palette;
  if (!p.envoi_auto) return <p className="text-sm text-secondary-700">Envoi automatique désactivé.</p>;
  const dest = p.transporteur.emails.length ? p.transporteur.emails.join(', ') : 'aucun destinataire transporteur saisi';
  return (
    <p className="text-sm text-secondary-700">
      La feuille de route part chaque jour à {p.heure_envoi} h (heure de Paris) vers : <strong>{dest}</strong>
      {cfg.emails.interne.length > 0 && <> — copie interne : {cfg.emails.interne.join(', ')}</>}.
    </p>
  );
}

function NombreChamp({ r, champ, label, aide, unite }) {
  return (
    <Champ label={label} erreur={r.erreurs[champ]} aide={aide}>
      <div className="flex items-center gap-2">
        <input inputMode="numeric" value={r.form[champ]} onChange={(e) => r.set(champ, e.target.value)} className={INPUT} />
        {unite && <span className="text-sm text-secondary-500 shrink-0">{unite}</span>}
      </div>
    </Champ>
  );
}

function DepotsEditor({ r }) {
  const depots = r.form.depots;
  const maj = (i, champ, v) => r.set('depots', depots.map((d, j) => (j === i ? { ...d, [champ]: v } : d)));
  return (
    <section className={CARD}>
      <h2 className={SECTION_TITLE}>Dépôts</h2>
      <p className="text-xs text-secondary-500 mb-3">
        Point de départ des tournées. Un secteur désigne son dépôt par le code ; un code utilisé par un secteur ne peut pas être retiré.
        Par défaut : {WEBSHOP_REGLAGES_DEFAUT.depots.map((d) => `${d.libelle} (${d.code})`).join(', ')}.
      </p>
      {depots.length === 0 && (
        <div className="mb-3"><Avertissement>Aucun dépôt saisi : le dépôt par défaut (Castanet-Tolosan) s’applique</Avertissement></div>
      )}
      <div className="space-y-2">
        {depots.map((d, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[8rem_1fr_1.5fr_auto] gap-2 items-start">
            <input value={d.code} onChange={(e) => maj(i, 'code', e.target.value)} placeholder="code" className={INPUT} aria-label="Code du dépôt" />
            <input value={d.libelle} onChange={(e) => maj(i, 'libelle', e.target.value)} placeholder="Libellé" className={INPUT} aria-label="Libellé du dépôt" />
            <input value={d.adresse} onChange={(e) => maj(i, 'adresse', e.target.value)} placeholder="Adresse de départ" className={INPUT} aria-label="Adresse du dépôt" />
            <button type="button" onClick={() => r.set('depots', depots.filter((_, j) => j !== i))} className="p-2 text-secondary-400 hover:text-red-600" aria-label="Retirer ce dépôt">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      {r.erreurs.depots && <p className="mt-2 text-xs text-red-600">{r.erreurs.depots}</p>}
      <button type="button" onClick={() => r.set('depots', [...depots, { code: '', libelle: '', adresse: '' }])} className="mt-3 inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-800">
        <Plus className="w-4 h-4" /> Ajouter un dépôt
      </button>
    </section>
  );
}

export default function PaletteTab() {
  const { data: secteurs } = useWebshopSettingsSectors();
  const depotsUtilises = useMemo(() => (secteurs ? secteurs.map((s) => s.depot) : AUCUNE_LISTE), [secteurs]);
  const r = useWebshopReglagesForm({ depotsUtilises });
  const { form, set, erreurs } = r;
  if (r.isLoading) return <Chargement />;
  const bp = BORNES.palette;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start gap-3 rounded-lg border border-secondary-200 bg-secondary-50 px-4 py-3">
        <Send className="w-4 h-4 mt-0.5 text-secondary-500 shrink-0" />
        <ResumeEnvoi cfg={r.cfg} />
      </div>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}>Transporteur</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Champ label="Nom" aide="Par défaut : vide.">
            <input value={form.transporteur_nom} onChange={(e) => set('transporteur_nom', e.target.value)} className={INPUT} />
          </Champ>
          <Champ label="E-mail(s) destinataire(s) de la feuille de route" erreur={erreurs.transporteur_emails} aide="Séparées par une virgule. Par défaut : aucune.">
            <input value={form.transporteur_emails} onChange={(e) => set('transporteur_emails', e.target.value)} className={INPUT} />
          </Champ>
          <Champ label="Note (contact, horaires d’enlèvement)" className="sm:col-span-2" aide="Par défaut : vide.">
            <textarea rows={2} value={form.transporteur_note} onChange={(e) => set('transporteur_note', e.target.value)} className={INPUT} />
          </Champ>
        </div>
      </section>

      <DepotsEditor r={r} />

      <section className={CARD}>
        <h2 className={SECTION_TITLE}>Règles des tournées</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Champ label="Envoi automatique de la feuille de route" aide={`Par défaut : ${D.envoi_auto ? 'activé' : 'désactivé'}.`}>
            <label className="flex items-center gap-2 text-sm text-secondary-700 py-2">
              <input type="checkbox" checked={form.envoi_auto} onChange={(e) => set('envoi_auto', e.target.checked)} />
              Envoyer chaque jour au transporteur
            </label>
          </Champ>
          <NombreChamp r={r} champ="heure_envoi" label="Heure d’envoi (heure de Paris)" unite="h" aide={`Les tournées à J-n ferment aussi à cette heure. Par défaut : ${D.heure_envoi} h.`} />
          <NombreChamp r={r} champ="delai_fermeture_jours" label="Fermeture des réservations" unite="jours avant" aide={`De ${bp.delai_fermeture_jours.min} à ${bp.delai_fermeture_jours.max}. Par défaut : J-${D.delai_fermeture_jours}.`} />
          <NombreChamp r={r} champ="horizon_semaines" label="Horizon de génération des créneaux" unite="semaines" aide={`Par défaut : ${D.horizon_semaines} semaines.`} />
          <Champ label="Ancre du cycle de 4 semaines" erreur={erreurs.ancre_cycle} aide={`Lundi de la semaine 1. Par défaut : ${D.ancre_cycle}.`}>
            <input type="date" value={form.ancre_cycle} onChange={(e) => set('ancre_cycle', e.target.value)} className={INPUT} />
          </Champ>
          <NombreChamp r={r} champ="capacite_emplacements" label="Capacité d’un camion" unite="emplacements" aide={`Par défaut : ${D.capacite_emplacements}.`} />
          <NombreChamp r={r} champ="max_emplacements_panier" label="Emplacements max par panier" unite="emplacements" aide={`Au plus la capacité d’un camion. Par défaut : ${D.max_emplacements_panier}.`} />
          <Champ label="Prix d’un emplacement (nouveau secteur)" erreur={erreurs.prix_emplacement_defaut_euros} aide={`TTC. Par défaut : ${centsVersEuros(D.prix_emplacement_defaut_cents)} €.`}>
            <div className="flex items-center gap-2">
              <input inputMode="decimal" value={form.prix_emplacement_defaut_euros} onChange={(e) => set('prix_emplacement_defaut_euros', e.target.value)} className={INPUT} />
              <span className="text-sm text-secondary-500">€</span>
            </div>
          </Champ>
          <Champ label="TVA du transport palette" erreur={erreurs.palette_tva_pct} aide={`Par défaut : ${D.tva_pct} %.`}>
            <select value={form.palette_tva_pct} onChange={(e) => set('palette_tva_pct', e.target.value)} className={INPUT}>
              {BORNES.tva_pct.map((t) => <option key={t} value={String(t)}>{String(t).replace('.', ',')} %</option>)}
            </select>
          </Champ>
        </div>
      </section>

      <BarreEnregistrer
        isDirty={r.isDirty}
        peutEnregistrer={r.peutEnregistrer}
        isSaving={r.isSaving}
        nbErreurs={Object.keys(erreurs).length}
        onSave={r.enregistrer}
        onReset={r.annuler}
      />
    </div>
  );
}
