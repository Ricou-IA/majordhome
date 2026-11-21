// src/apps/artisan/pages/settings/TypesProjetSettings.jsx
// Mon activité → onglet « Types de projet » : le détail de la liste « Projet » des leads et « Famille » des devis
// (`settings.devis.familles`) — ordre, types libres ajoutés par l'entreprise. L'activation des types proposés se fait
// dans la grille des métiers. Les chapitres, la TVA et les catégories de produits de chaque type restent dans Devis.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildDevisConfig, validerDevisConfig } from '@/lib/devisConfig.js';
import FamillesEditor from './devis/FamillesEditor';
import { depuisConfig, patchFamilles, versSettings } from './devis/famillesSettings';

export function TypesProjetPanel() {
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
      await save(patchFamilles(settings, familles));
      toast.success('Types de projet enregistrés');
      setInitial(familles);
    } catch (err) { toast.error(err.message || "Erreur lors de l'enregistrement"); }
  };

  if (isLoading) return <div className="card text-sm text-secondary-500">Chargement…</div>;
  return (
    <div className="card max-w-3xl space-y-4">
      <FamillesEditor mode="types" familles={familles} onChange={setFamilles} />
      {!validation.ok && (
        <ul className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 list-disc pl-6">{validation.erreurs.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={handleSave} disabled={!isDirty || !validation.ok || isSaving} className="btn-primary">{isSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </div>
  );
}
