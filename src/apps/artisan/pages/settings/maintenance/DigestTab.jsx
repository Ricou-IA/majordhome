// src/apps/artisan/pages/settings/maintenance/DigestTab.jsx
// E-mail du soir au responsable (`settings.maintenance.digest`) : activé, destinataires,
// heure d'envoi (Paris). Envoyé par l'edge maintenance-digest (cron horaire), MÊME si tout
// est à jour. Expéditeur : from_email de l'org, sinon expéditeur de la plateforme
// (MDH_PLATFORM_FROM_EMAIL côté serveur) — sinon rien ne part, et on le dit ici.
// ⚠️ org_update_settings fusionne au niveau 1 : on sauve l'objet `maintenance` COMPLET.
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { FormField, TextInput, SelectInput } from '@apps/artisan/components/FormFields';

const HEURES = Array.from({ length: 17 }, (_, i) => i + 6).map((h) => ({ value: String(h), label: `${h} h` }));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function digestInitial(settings) {
  const d = settings?.maintenance?.digest || {};
  return { enabled: d.enabled === true, recipients: (d.recipients || []).join(', '), hour: String(d.hour ?? 18) };
}

export default function DigestTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [f, setF] = useState(() => digestInitial(settings));
  const [initial, setInitial] = useState(() => digestInitial(settings));
  const [charge, setCharge] = useState(!isLoading);

  // Les réglages arrivent après le premier rendu : on (ré)initialise une seule fois.
  if (!charge && !isLoading) {
    const init = digestInitial(settings);
    setF(init);
    setInitial(init);
    setCharge(true);
  }

  const destinataires = f.recipients.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const invalides = destinataires.filter((e) => !EMAIL.test(e));
  const valide = invalides.length === 0 && (!f.enabled || destinataires.length > 0);
  const modifie = JSON.stringify(f) !== JSON.stringify(initial);
  const expediteurOrg = settings?.from_email || settings?.reply_to;

  const enregistrer = async () => {
    try {
      await save({
        maintenance: {
          ...(settings?.maintenance || {}),
          digest: { enabled: f.enabled, recipients: destinataires, hour: Number(f.hour) },
        },
      });
      setInitial(f);
      toast.success('E-mail du soir enregistré');
    } catch (err) {
      toast.error(`Enregistrement impossible : ${err?.message || 'erreur inconnue'}`);
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>;

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-sm text-secondary-600">
        Chaque soir, un récapitulatif : tâches réalisées, retards, « pas pu faire » avec leurs commentaires,
        opérateurs bloqués. Il part même quand tout est à jour : un soir sans e-mail signale une panne.
      </p>

      {!expediteurOrg && (
        <div className="flex gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <p>
            Aucune adresse d&apos;expédition n&apos;est configurée pour l&apos;organisation (Paramètres → Emails).
            L&apos;e-mail ne partira que si l&apos;expéditeur de la plateforme Majord&apos;home est configuré ;
            sinon il est ignoré et signalé côté serveur.
          </p>
        </div>
      )}

      <label className="inline-flex items-center gap-2 text-sm font-medium text-secondary-800">
        <input type="checkbox" checked={f.enabled} onChange={(e) => setF((p) => ({ ...p, enabled: e.target.checked }))} />
        Envoyer l&apos;e-mail du soir
      </label>

      <FormField label="Destinataires (séparés par des virgules)" error={invalides.length ? `Adresse invalide : ${invalides.join(', ')}` : null}>
        <TextInput value={f.recipients} onChange={(v) => setF((p) => ({ ...p, recipients: v }))} placeholder="responsable@entreprise.fr" />
      </FormField>

      <FormField label="Heure d'envoi (heure de Paris)">
        <div className="w-32">
          <SelectInput value={f.hour} onChange={(v) => setF((p) => ({ ...p, hour: v || '18' }))} options={HEURES} />
        </div>
      </FormField>

      <button type="button" onClick={enregistrer} disabled={!modifie || !valide || isSaving}
        className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
        {isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer
      </button>
    </div>
  );
}
