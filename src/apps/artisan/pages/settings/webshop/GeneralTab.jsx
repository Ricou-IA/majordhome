// src/apps/artisan/pages/settings/webshop/GeneralTab.jsx
// Settings → Webshop → Général : adresse du site boutique (ex-`SiteUrlSetting` de l'onglet
// Produits) et e-mails internes de la boutique.
import { Globe } from 'lucide-react';
import { useWebshopReglagesForm } from './useWebshopReglagesForm';
import { BarreEnregistrer, CARD, Champ, Chargement, INPUT, SECTION_TITLE } from './common';

export default function GeneralTab() {
  const r = useWebshopReglagesForm();
  const { form, set, erreurs } = r;
  if (r.isLoading) return <Chargement />;

  return (
    <div className="space-y-6 max-w-3xl">
      <section className={CARD}>
        <h2 className={SECTION_TITLE}>Site boutique</h2>
        <Champ
          label="Adresse du site"
          erreur={erreurs.site_url}
          aide="Sert au lien « Voir sur le site », à l’aperçu des photos et à l’envoi des feuilles de route. Sans adresse, l’envoi automatique échoue (site_url_missing). Par défaut : vide."
        >
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
            <input
              value={form.site_url}
              onChange={(e) => set('site_url', e.target.value)}
              placeholder="https://www.exemple.fr"
              className={`${INPUT} pl-9`}
            />
          </div>
        </Champ>
      </section>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}>E-mails internes</h2>
        <Champ
          label="Adresses en copie interne"
          erreur={erreurs.emails_interne}
          aide="Reçoivent la copie des feuilles de route et les alertes de la boutique. Séparez les adresses par une virgule. Par défaut : aucune."
        >
          <textarea
            rows={2}
            value={form.emails_interne}
            onChange={(e) => set('emails_interne', e.target.value)}
            placeholder="logistique@exemple.fr, direction@exemple.fr"
            className={INPUT}
          />
        </Champ>
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
