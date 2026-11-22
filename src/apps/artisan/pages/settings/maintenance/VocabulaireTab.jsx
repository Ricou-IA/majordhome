// src/apps/artisan/pages/settings/maintenance/VocabulaireTab.jsx
// Vocabulaire du module de tâches récurrentes (`settings.maintenance.vocabulaire`) :
// une usine parle de « Maintenance » et d'« unités », un dépôt de « Traçabilité » et de
// « zones ». Lu partout via vocabulaire() (src/lib/maintenance/vocabulaire.js) : sidebar,
// titres, borne, registre PDF, e-mail du soir.
// ⚠️ org_update_settings fusionne au niveau 1 : on sauve l'objet `maintenance` COMPLET.
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { FormField, TextInput } from '@apps/artisan/components/FormFields';
import { vocabulaire, VOCABULAIRE_DEFAUT } from '@/lib/maintenance/vocabulaire';

const saisie = (settings) => {
  const v = settings?.maintenance?.vocabulaire || {};
  return { module: v.module || '', unite: v.unite || '', unites: v.unites || '' };
};

export default function VocabulaireTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [f, setF] = useState(() => saisie(settings));
  const [initial, setInitial] = useState(() => saisie(settings));
  const [charge, setCharge] = useState(!isLoading);

  if (!charge && !isLoading) {
    const init = saisie(settings);
    setF(init);
    setInitial(init);
    setCharge(true);
  }

  const apercu = vocabulaire({ maintenance: { vocabulaire: f } });
  const modifie = JSON.stringify(f) !== JSON.stringify(initial);
  const maj = (cle) => (val) => setF((p) => ({ ...p, [cle]: val }));

  const enregistrer = async () => {
    const propre = Object.fromEntries(Object.entries(f).map(([k, val]) => [k, val.trim()]).filter(([, val]) => val));
    try {
      await save({ maintenance: { ...(settings?.maintenance || {}), vocabulaire: propre } });
      setInitial(f);
      toast.success('Vocabulaire enregistré');
    } catch (err) {
      toast.error(`Enregistrement impossible : ${err?.message || 'erreur inconnue'}`);
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>;

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-sm text-secondary-600">
        Adaptez les mots du module à votre activité : une usine parle de « Maintenance » et
        d&apos;« unités », un dépôt de « Traçabilité » et de « zones ». Laissez vide pour garder le mot par défaut.
      </p>
      <div className="grid sm:grid-cols-3 gap-4">
        <FormField label="Nom du module">
          <TextInput value={f.module} onChange={maj('module')} placeholder={VOCABULAIRE_DEFAUT.module} maxLength={40} />
        </FormField>
        <FormField label="Élément suivi (singulier)">
          <TextInput value={f.unite} onChange={maj('unite')} placeholder={VOCABULAIRE_DEFAUT.unite} maxLength={30} />
        </FormField>
        <FormField label="Élément suivi (pluriel)">
          <TextInput value={f.unites} onChange={maj('unites')} placeholder={apercu.unites} maxLength={30} />
        </FormField>
      </div>
      <p className="rounded-lg bg-secondary-50 p-3 text-sm text-secondary-700">
        Aperçu : menu « {apercu.module} », onglet « {apercu.unites} &amp; tâches », bouton « + {apercu.unite} ».
      </p>
      <button type="button" onClick={enregistrer} disabled={!modifie || isSaving}
        className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
        {isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer
      </button>
    </div>
  );
}
