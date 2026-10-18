// src/apps/artisan/pages/settings/webshop/PaletteTab.jsx
// Settings → Webshop → Livraison palette : transporteur, dépôts, règles des tournées
// (`settings.webshop.palette` + `settings.webshop.depots`). Défauts : src/lib/webshop/reglages.js.
import { useMemo } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import { WEBSHOP_REGLAGES_DEFAUT, BORNES } from '@/lib/webshop/reglages';
import { centsVersEuros, codeDepotDepuisLibelle, depotsParDefautPourEdition } from '@/lib/webshop/settingsForm';
import AddressSearch from '../organization/components/AddressSearch';
import { useWebshopSettingsSectors } from '@hooks/useWebshopSettings';
import { useWebshopReglagesForm } from './useWebshopReglagesForm';
import { Avertissement, BarreEnregistrer, CARD, Champ, Chargement, INPUT, SECTION_TITLE } from './common';

const D = WEBSHOP_REGLAGES_DEFAUT.palette;

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

/**
 * Dépôts : libellé + adresse cherchée (BAN/Mapbox). Le code technique n'est jamais saisi : il est
 * dérivé du libellé pour un nouveau dépôt (`_nouveau`, retiré à l'enregistrement) et figé ensuite,
 * car les secteurs le référencent. Un dépôt utilisé par un secteur ne peut pas être retiré.
 */
function DepotsEditor({ r, etatSecteurs, depotsUtilises }) {
  const depots = r.form.depots;
  const maj = (i, patch) => r.set('depots', depots.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const majLibelle = (i, d, libelle) => maj(i, d._nouveau ? { libelle, code: codeDepotDepuisLibelle(libelle) } : { libelle });
  const utilises = new Set(depotsUtilises ?? []);
  return (
    <section className={CARD}>
      <h2 className={SECTION_TITLE}>Dépôts</h2>
      {etatSecteurs && <p className="mb-3 text-xs text-red-600">{etatSecteurs}</p>}
      <p className="text-xs text-secondary-500 mb-3">
        Point de départ et de retour des tournées. Un dépôt utilisé par un secteur ne peut pas être retiré.
      </p>
      {depots.length === 0 && (
        <div className="mb-3 space-y-2">
          <Avertissement>Aucun dépôt saisi : le dépôt par défaut (Castanet-Tolosan, adresse approximative) s’applique</Avertissement>
          <button type="button" onClick={() => r.set('depots', depotsParDefautPourEdition())} className="text-sm text-primary-600 hover:text-primary-800">
            Préciser l’adresse du dépôt de Castanet
          </button>
        </div>
      )}
      <div className="space-y-3">
        {depots.map((d, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1.6fr_auto] gap-2 items-start">
            <div>
              <input value={d.libelle} onChange={(e) => majLibelle(i, d, e.target.value)} placeholder="Nom du dépôt" className={INPUT} aria-label="Nom du dépôt" />
              {d.code && <p className="mt-1 text-[11px] text-secondary-400">Code : {d.code}</p>}
            </div>
            <div>
              <AddressSearch
                initialValue={d.adresse}
                onSelect={(res) => maj(i, { adresse: res.label })}
                placeholder="Rechercher l’adresse de départ…"
              />
              {d.adresse && <p className="mt-1 text-[11px] text-secondary-500">Adresse retenue : {d.adresse}</p>}
            </div>
            {utilises.has(d.code) ? (
              <span className="p-2 text-[11px] text-secondary-400" title="Utilisé par un secteur">utilisé</span>
            ) : (
              <button type="button" onClick={() => r.set('depots', depots.filter((_, j) => j !== i))} className="p-2 text-secondary-400 hover:text-red-600" aria-label="Retirer ce dépôt">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {r.erreurs.depots && <p className="mt-2 text-xs text-red-600">{r.erreurs.depots}</p>}
      <button type="button" onClick={() => r.set('depots', [...depots, { code: '', libelle: '', adresse: '', _nouveau: true }])} className="mt-3 inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-800">
        <Plus className="w-4 h-4" /> Ajouter un dépôt
      </button>
    </section>
  );
}

export default function PaletteTab() {
  const { data: secteurs, isSuccess, isLoading: secteursEnCours, error: secteursErreur } = useWebshopSettingsSectors();
  // Secteurs inconnus (chargement ou erreur) = undefined → validerSaisie refuse l'enregistrement.
  const depotsUtilises = useMemo(
    () => (isSuccess && Array.isArray(secteurs) ? secteurs.map((s) => s.depot) : undefined),
    [isSuccess, secteurs],
  );
  const r = useWebshopReglagesForm({ depotsUtilises });
  const etatSecteurs = secteursErreur
    ? `Secteurs illisibles (${secteursErreur.message}) : enregistrement impossible tant que les dépôts utilisés ne sont pas vérifiés.`
    : secteursEnCours ? 'Chargement des secteurs…' : null;
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

      <DepotsEditor r={r} etatSecteurs={etatSecteurs} depotsUtilises={depotsUtilises} />

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
