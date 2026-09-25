// src/apps/maintenance/components/HistoriqueTab.jsx
// Journal filtrable (période, unité, tâche, opérateur, statut) + export du registre PDF
// sur ces mêmes filtres. Les bornes de période sont des jours PARIS : la requête prend une
// marge d'un jour de chaque côté, le filtre exact se fait sur jourParis(done_at).
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, FileDown } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useMaintenanceReferentiel, useMaintenanceLogs } from '@hooks/useMaintenance';
import { jourParis, ajouterJours } from '@/lib/maintenance/echeances';
import { FormField, TextInput, SelectInput } from '@apps/artisan/components/FormFields';
import { telechargerRegistre } from '../lib/registreExport';

const DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export default function HistoriqueTab({ orgId }) {
  const { settings } = useOrgSettings();
  const aujourdhui = jourParis(new Date());
  const [f, setF] = useState({ du: ajouterJours(aujourdhui, -30), au: aujourdhui, unitId: null, taskId: null, operatorId: null, status: null });
  const [export_, setExport] = useState(false);
  const maj = (cle) => (v) => setF((p) => ({ ...p, [cle]: v, ...(cle === 'unitId' ? { taskId: null } : {}) }));

  const filtresRequete = useMemo(() => ({
    depuis: `${ajouterJours(f.du, -1)}T00:00:00Z`,
    jusqua: `${ajouterJours(f.au, 1)}T23:59:59Z`,
    unitId: f.unitId || undefined,
    taskId: f.taskId || undefined,
    operatorId: f.operatorId || undefined,
    status: f.status || undefined,
  }), [f]);

  const referentiel = useMaintenanceReferentiel(orgId);
  const logs = useMaintenanceLogs(orgId, filtresRequete);
  const { units = [], tasks = [], operators = [] } = referentiel.data || {};
  const prenom = useMemo(() => new Map(operators.map((o) => [o.id, o.first_name])), [operators]);
  const tacheParId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const uniteParId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  const lignes = useMemo(() => (logs.data || []).filter((l) => {
    const j = jourParis(l.done_at);
    return j >= f.du && j <= f.au;
  }), [logs.data, f.du, f.au]);

  const periodeInvalide = f.du > f.au;

  const exporter = async () => {
    setExport(true);
    try {
      await telechargerRegistre({
        settings,
        units: f.unitId ? units.filter((u) => u.id === f.unitId) : units,
        tasks,
        operators,
        logs: lignes,
        du: f.du,
        au: f.au,
      });
    } catch (err) {
      toast.error(`Export du registre impossible : ${err?.message || 'erreur inconnue'}`);
    } finally {
      setExport(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card grid sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        <FormField label="Du"><TextInput type="date" value={f.du} onChange={maj('du')} /></FormField>
        <FormField label="Au"><TextInput type="date" value={f.au} onChange={maj('au')} /></FormField>
        <FormField label="Unité">
          <SelectInput value={f.unitId} onChange={maj('unitId')} placeholder="Toutes"
            options={units.map((u) => ({ value: u.id, label: u.archived_at ? `${u.name} (archivée)` : u.name }))} />
        </FormField>
        <FormField label="Tâche">
          <SelectInput value={f.taskId} onChange={maj('taskId')} placeholder="Toutes"
            options={tasks.filter((t) => !f.unitId || t.unit_id === f.unitId).map((t) => ({ value: t.id, label: t.label }))} />
        </FormField>
        <FormField label="Opérateur">
          <SelectInput value={f.operatorId} onChange={maj('operatorId')} placeholder="Tous"
            options={operators.map((o) => ({ value: o.id, label: o.first_name }))} />
        </FormField>
        <FormField label="Statut">
          <SelectInput value={f.status} onChange={maj('status')} placeholder="Tous"
            options={[{ value: 'done', label: 'Fait' }, { value: 'not_done', label: 'Pas pu faire' }]} />
        </FormField>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-secondary-600">
          {periodeInvalide ? 'La date de début est après la date de fin.' : `${lignes.length} réalisation${lignes.length > 1 ? 's' : ''}`}
          {(logs.data?.length || 0) >= 5000 && ' — liste tronquée à 5 000 lignes, réduisez la période.'}
        </p>
        <button type="button" onClick={exporter} disabled={export_ || periodeInvalide || lignes.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
          {export_ ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          Exporter le registre PDF
        </button>
      </div>

      {(referentiel.isLoading || logs.isLoading) && (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>
      )}
      {(referentiel.isError || logs.isError) && <div className="card text-red-700">Impossible de charger le journal.</div>}

      {!logs.isLoading && lignes.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-secondary-50 text-left text-secondary-500">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Unité</th>
                <th className="px-4 py-2 font-medium">Tâche</th>
                <th className="px-4 py-2 font-medium">Statut</th>
                <th className="px-4 py-2 font-medium">Opérateur</th>
                <th className="px-4 py-2 font-medium">Commentaire</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-100">
              {lignes.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2 whitespace-nowrap">{DATE_HEURE.format(new Date(l.done_at))}</td>
                  <td className="px-4 py-2">{uniteParId.get(l.unit_id)?.name || '—'}</td>
                  <td className="px-4 py-2">{tacheParId.get(l.task_id)?.label || '—'}</td>
                  <td className={`px-4 py-2 whitespace-nowrap ${l.status === 'not_done' ? 'text-amber-700 font-medium' : ''}`}>
                    {l.status === 'not_done' ? 'Pas pu faire' : 'Fait'}
                  </td>
                  <td className="px-4 py-2">{prenom.get(l.operator_id) || '?'}</td>
                  <td className="px-4 py-2 text-secondary-600">{l.comment || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
