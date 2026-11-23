// src/apps/artisan/pages/settings/webshop/ColisTab.jsx
// Settings → Webshop → Colis : prestataire colis, TVA du port, quantité max par ligne
// (`settings.webshop.colis`), puis grille de port et points de retrait (tables, via RPC).
import { Combobox } from '@/components/ui/combobox';
import { WEBSHOP_REGLAGES_DEFAUT, BORNES } from '@/lib/webshop/reglages';
import { useWebshopReglagesForm } from './useWebshopReglagesForm';
import { BarreEnregistrer, CARD, Champ, Chargement, INPUT, SECTION_TITLE } from './common';
import TarifsColis from './TarifsColis';
import PointsRetrait from './PointsRetrait';

const D = WEBSHOP_REGLAGES_DEFAUT.colis;

export default function ColisTab() {
  const r = useWebshopReglagesForm();
  const { form, set, erreurs } = r;
  if (r.isLoading) return <Chargement />;
  const b = BORNES.colis.max_qty_ligne;

  return (
    <div className="space-y-6 max-w-3xl">
      <section className={CARD}>
        <h2 className={SECTION_TITLE}>Prestataire colis</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Champ label="Nom" aide="Par défaut : vide.">
            <input value={form.prestataire_nom} onChange={(e) => set('prestataire_nom', e.target.value)} className={INPUT} />
          </Champ>
          <Champ label="Mode d’envoi des ordres" erreur={erreurs.prestataire_mode} aide={`Par défaut : ${D.prestataire.mode === 'email' ? 'e-mail' : D.prestataire.mode}. L’envoi par API viendra plus tard.`}>
            <Combobox value={form.prestataire_mode} onChange={(v) => set('prestataire_mode', v)} libelle="Mode d’envoi des ordres"
              options={[{ value: 'email', label: 'E-mail' }, ...(form.prestataire_mode !== 'email' ? [{ value: form.prestataire_mode, label: form.prestataire_mode }] : [])]} />
          </Champ>
          <Champ label="E-mail(s) destinataire(s) des ordres" erreur={erreurs.prestataire_emails} aide="Séparées par une virgule. Par défaut : aucune.">
            <input value={form.prestataire_emails} onChange={(e) => set('prestataire_emails', e.target.value)} className={INPUT} />
          </Champ>
          <Champ label="Note (créneau d’enlèvement au dépôt)" aide="Par défaut : vide.">
            <input value={form.prestataire_note} onChange={(e) => set('prestataire_note', e.target.value)} className={INPUT} />
          </Champ>
        </div>
      </section>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}>Panier</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Champ label="TVA du port colis" erreur={erreurs.colis_tva_pct} aide={`Par défaut : ${D.tva_pct} %.`}>
            <Combobox value={form.colis_tva_pct} onChange={(v) => set('colis_tva_pct', v)} libelle="TVA du port colis"
              options={BORNES.tva_pct.map((t) => ({ value: String(t), label: `${String(t).replace('.', ',')} %` }))} />
          </Champ>
          <Champ label="Quantité max de colis par ligne" erreur={erreurs.max_qty_ligne} aide={`De ${b.min} à ${b.max}. Par défaut : ${D.max_qty_ligne}.`}>
            <input inputMode="numeric" value={form.max_qty_ligne} onChange={(e) => set('max_qty_ligne', e.target.value)} className={INPUT} />
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

      <TarifsColis />
      <PointsRetrait />
    </div>
  );
}
