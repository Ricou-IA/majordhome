// src/apps/maintenance/components/UnitesTab.jsx
// Paramétrage (org_admin) : unités et leurs tâches. Archivage au lieu de suppression — le
// journal doit rester lisible des années plus tard (spec § 3).
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Pencil, Archive, ArchiveRestore, Check, X } from 'lucide-react';
import {
  useMaintenanceReferentiel, useMaintenanceDerniersLogs, useMaintenanceMutations,
} from '@hooks/useMaintenance';
import { decrireFrequence, dernierLogParTache } from '@/lib/maintenance/echeances';
import TacheForm from './TacheForm';

function NomEditable({ valeur, onValider, onAnnuler, placeholder }) {
  const [nom, setNom] = useState(valeur || '');
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); if (nom.trim()) onValider(nom.trim()); }}
    >
      <input autoFocus value={nom} onChange={(e) => setNom(e.target.value)} placeholder={placeholder}
        className="rounded-lg border border-secondary-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none" />
      <button type="submit" disabled={!nom.trim()} className="p-1.5 rounded-lg text-primary-700 hover:bg-primary-50 disabled:opacity-40" aria-label="Valider">
        <Check className="w-4 h-4" />
      </button>
      <button type="button" onClick={onAnnuler} className="p-1.5 rounded-lg text-secondary-500 hover:bg-secondary-100" aria-label="Annuler">
        <X className="w-4 h-4" />
      </button>
    </form>
  );
}

export default function UnitesTab({ orgId }) {
  const referentiel = useMaintenanceReferentiel(orgId);
  const derniers = useMaintenanceDerniersLogs(orgId);
  const { saveUnit, setUnitArchived, saveTask, setTaskArchived } = useMaintenanceMutations(orgId);
  const [nouvelleUnite, setNouvelleUnite] = useState(false);
  const [uniteEnEdition, setUniteEnEdition] = useState(null);
  const [formTache, setFormTache] = useState(null); // { unitId, tache? }
  const [voirArchives, setVoirArchives] = useState(false);

  const { units = [], tasks = [] } = referentiel.data || {};
  const derniersParTache = useMemo(() => dernierLogParTache(derniers.data || []), [derniers.data]);
  const unitesVisibles = units.filter((u) => voirArchives || !u.archived_at);
  const nbArchivees = units.filter((u) => u.archived_at).length;

  /** @returns {Promise<boolean>} vrai si l'action a réussi (l'appelant ne referme qu'alors). */
  const executer = async (promesse, succes) => {
    try {
      await promesse;
      if (succes) toast.success(succes);
      return true;
    } catch (err) {
      toast.error(`Action impossible : ${err?.message || 'erreur inconnue'}`);
      return false;
    }
  };

  const creerUnite = async (name) => {
    if (await executer(saveUnit.mutateAsync({ name, sort_order: units.length + 1 }), 'Unité créée')) setNouvelleUnite(false);
  };
  const renommerUnite = async (u, name) => {
    if (await executer(saveUnit.mutateAsync({ id: u.id, name }), 'Unité renommée')) setUniteEnEdition(null);
  };

  if (referentiel.isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>;
  }
  if (referentiel.isError) return <div className="card text-red-700">Impossible de charger les unités.</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {nouvelleUnite ? (
          <NomEditable placeholder="Nom de l'unité (ex. Presse 2)" onValider={creerUnite} onAnnuler={() => setNouvelleUnite(false)} />
        ) : (
          <button type="button" onClick={() => setNouvelleUnite(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
            <Plus className="w-4 h-4" /> Nouvelle unité
          </button>
        )}
        {nbArchivees > 0 && (
          <label className="inline-flex items-center gap-2 text-sm text-secondary-600">
            <input type="checkbox" checked={voirArchives} onChange={(e) => setVoirArchives(e.target.checked)} />
            Afficher les unités archivées ({nbArchivees})
          </label>
        )}
      </div>

      {unitesVisibles.length === 0 && (
        <div className="card text-secondary-600">Aucune unité. Commencez par créer une machine, une ligne ou un poste.</div>
      )}

      {unitesVisibles.map((u) => {
        const taches = tasks.filter((t) => t.unit_id === u.id && (voirArchives || !t.archived_at));
        return (
          <section key={u.id} className={`card space-y-3 ${u.archived_at ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {uniteEnEdition === u.id ? (
                <NomEditable valeur={u.name} onValider={(n) => renommerUnite(u, n)} onAnnuler={() => setUniteEnEdition(null)} />
              ) : (
                <h2 className="font-semibold text-secondary-900">
                  {u.name}{u.archived_at && <span className="ml-2 text-xs font-normal text-secondary-500">archivée</span>}
                </h2>
              )}
              <div className="flex items-center gap-1">
                {!u.archived_at && (
                  <>
                    <button type="button" onClick={() => setFormTache({ unitId: u.id })}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-primary-700 hover:bg-primary-50">
                      <Plus className="w-4 h-4" /> Tâche
                    </button>
                    <button type="button" onClick={() => setUniteEnEdition(u.id)} className="p-2 rounded-lg text-secondary-500 hover:bg-secondary-100" aria-label="Renommer l'unité">
                      <Pencil className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button type="button"
                  onClick={() => executer(setUnitArchived.mutateAsync({ id: u.id, archived: !u.archived_at }), u.archived_at ? 'Unité restaurée' : 'Unité archivée')}
                  className="p-2 rounded-lg text-secondary-500 hover:bg-secondary-100"
                  aria-label={u.archived_at ? "Restaurer l'unité" : "Archiver l'unité"} title={u.archived_at ? 'Restaurer' : 'Archiver'}>
                  {u.archived_at ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {taches.length === 0 ? (
              <p className="text-sm text-secondary-500">Aucune tâche.</p>
            ) : (
              <ul className="divide-y divide-secondary-100">
                {taches.map((t) => (
                  <li key={t.id} className={`py-2 flex items-center justify-between gap-3 ${t.archived_at ? 'opacity-60' : ''}`}>
                    <div>
                      <p className="text-secondary-900">{t.label}{t.archived_at && <span className="ml-2 text-xs text-secondary-500">archivée</span>}</p>
                      <p className="text-sm text-secondary-500">{decrireFrequence(t)}{t.instructions ? ` · ${t.instructions}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {!t.archived_at && (
                        <button type="button" onClick={() => setFormTache({ unitId: u.id, tache: t })}
                          className="p-2 rounded-lg text-secondary-500 hover:bg-secondary-100" aria-label="Modifier la tâche">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      <button type="button"
                        onClick={() => executer(setTaskArchived.mutateAsync({ id: t.id, archived: !t.archived_at }), t.archived_at ? 'Tâche restaurée' : 'Tâche archivée')}
                        className="p-2 rounded-lg text-secondary-500 hover:bg-secondary-100"
                        aria-label={t.archived_at ? 'Restaurer la tâche' : 'Archiver la tâche'} title={t.archived_at ? 'Restaurer' : 'Archiver'}>
                        {t.archived_at ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {formTache && (
        <TacheForm
          key={formTache.tache?.id || `nouvelle-${formTache.unitId}`}
          open
          onOpenChange={(v) => { if (!v) setFormTache(null); }}
          tache={formTache.tache}
          unitId={formTache.unitId}
          dernierLog={formTache.tache ? derniersParTache.get(formTache.tache.id) : null}
          onEnregistrer={(task) => saveTask.mutateAsync(task)}
        />
      )}
    </div>
  );
}
