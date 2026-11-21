// src/apps/artisan/pages/settings/TypesProjetSettings.jsx
// Settings → Socle → Types de projet (/settings/projets) : la liste « Projet » des leads et « Famille » des
// devis (`settings.devis.familles`). Types proposés (catalogue) à activer, types libres à ajouter. Les chapitres,
// la TVA et les catégories de produits de chaque type restent dans Devis. ⚠ merge JSONB niveau 1 : on sauve
// l'objet `devis` COMPLET (réglages existants conservés, seules les familles changent).
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildDevisConfig, validerDevisConfig, typeChapitreDeduit } from '@/lib/devisConfig.js';
import SettingsPage from './SettingsPage';
import FamillesEditor from './devis/FamillesEditor';

const depuisConfig = (c) => c.familles.map((f) => ({ ...f, chapitres: f.chapitres.map((ch) => ({ ...ch })), sections: [...f.sections] }));

/** Même normalisation que l'enregistrement du modèle de devis (DevisSettings.versSettings). */
const versSettings = (familles) => familles.map((f) => {
  const source = f.chapitres || (f.sections || []).map((t) => ({ titre: t, type: typeChapitreDeduit(t) }));
  const chapitres = source.map((c) => ({ titre: String(c.titre || '').trim(), type: c.type })).filter((c) => c.titre);
  return { ...f, label: f.label.trim(), tva: Number(f.tva ?? 10), chapitres, sections: chapitres.map((c) => c.titre) };
});

export default function TypesProjetSettings() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [familles, setFamilles] = useState(() => depuisConfig(buildDevisConfig(null)));
  const [initial, setInitial] = useState(familles);
  useEffect(() => { const f = depuisConfig(buildDevisConfig(settings)); setFamilles(f); setInitial(f); }, [settings]);

  const config = useMemo(() => buildDevisConfig(settings), [settings]);
  const validation = useMemo(
    () => validerDevisConfig({ familles: versSettings(familles), document: config.document }),
    [familles, config],
  );
  const isDirty = useMemo(() => JSON.stringify(familles) !== JSON.stringify(initial), [familles, initial]);

  const handleSave = async () => {
    if (!validation.ok) { toast.error(validation.erreurs[0]); return; }
    try {
      await save({ devis: { ...(settings?.devis || {}), familles: versSettings(familles) } });
      toast.success('Types de projet enregistrés');
      setInitial(familles);
    } catch (err) { toast.error(err.message || "Erreur lors de l'enregistrement"); }
  };

  return (
    <SettingsPage title="Types de projet" description="Les types proposés dans la fiche d'un lead et dans « Nouveau devis ». Les types masqués restent lisibles sur les anciens leads et devis.">
      {isLoading ? <div className="card text-sm text-secondary-500">Chargement…</div> : (
        <div className="card max-w-3xl space-y-4">
          <FamillesEditor mode="types" familles={familles} onChange={setFamilles} />
          {!validation.ok && (
            <ul className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 list-disc pl-6">{validation.erreurs.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={handleSave} disabled={!isDirty || !validation.ok || isSaving} className="btn-primary">{isSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </div>
      )}
    </SettingsPage>
  );
}
